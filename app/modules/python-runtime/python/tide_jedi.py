# Python IntelliSense with Jedi, in the app's own interpreter. Requests come
# through tide_tools ("jedi" method) and run one at a time on a long-lived
# worker thread, so jedi is imported once and its parse caches stay warm.
#
# The native snippet() call holds the runtime's queue (and on iOS blocks
# writes to running scripts), so calls never wait long: "call" queues a job
# and waits briefly, "poll" waits a little more, "cancel" drops or interrupts
# it. Nothing here writes to sys.stdout or sys.stderr, which may belong to a
# running script.
import ctypes
import keyword
import os
import queue
import re
import sys
import tempfile
import threading
import time
import warnings

_HERE = os.path.dirname(os.path.abspath(__file__))
MAX_COMPLETIONS = 200
# Signatures for completion details cost a lookup each; stop after this long.
DETAIL_BUDGET_S = 0.1
MAX_DOC = 2000
# A cancelled job runs on this long before it's interrupted: the first requests
# on a phone are slow, and finishing them warms jedi's caches for the next.
GRACE_S = 3
# Folders jedi shouldn't walk when searching the project for references.
IGNORE_FOLDERS = (".pylibs", "node_modules", ".git")
_TYPES = {
    "module": "namespace",
    "class": "class",
    "instance": "variable",
    "function": "function",
    "param": "variable",
    "path": "text",
    "keyword": "keyword",
    "property": "property",
    "statement": "variable",
}


class Cancelled(BaseException):
    """Raised in the worker to stop a job; BaseException so jedi's handlers don't swallow it."""


class _Job:
    def __init__(self, job_id, method, args):
        self.id = job_id
        self.method = method
        self.args = args
        self.done = threading.Event()
        self.result = None
        self.error = None
        self.cancelled = False
        self.interrupted = False
        self.created = time.monotonic()
        self.started = None


_jobs = {}
_queue = queue.Queue()
_lock = threading.Lock()
_current = None
_worker = None
_jedi = None
_projects = {}


def _load():
    global _jedi
    if _jedi is None:
        warnings.filterwarnings("ignore", module=r"(jedi|parso)(\.|$)")
        import jedi
        from jedi.inference import references

        # The default ~/.cache isn't writable in the app's sandbox.
        jedi.settings.cache_directory = os.path.join(tempfile.gettempdir(), "tide-jedi")
        references._IGNORE_FOLDERS = tuple(references._IGNORE_FOLDERS) + IGNORE_FOLDERS
        _jedi = jedi
    return _jedi


def _loop():
    global _current
    while True:
        try:
            job = _queue.get()
            # Importing jedi takes seconds on a phone; it isn't interrupted, a request is.
            _load()
            with _lock:
                if job.cancelled:
                    continue
                _current = job
                job.started = time.monotonic()
            try:
                job.result = _METHODS[job.method](job.args)
            except Cancelled:
                raise
            except Exception as e:  # noqa: BLE001 - reported to the app
                job.error = f"{type(e).__name__}: {e}"
            with _lock:
                _current = None
            job.done.set()
        except Cancelled:
            # An interrupted job leaves half-built inference state behind.
            with _lock:
                _current = None
            try:
                _load().cache.clear_time_caches(True)
            except Exception:  # noqa: BLE001
                pass


def _ensure_worker():
    global _worker
    if _worker is None or not _worker.is_alive():
        _worker = threading.Thread(target=_loop, name="tide-jedi", daemon=True)
        _worker.start()


def _wait(job, wait_ms):
    if not job.done.wait(max(0, min(wait_ms, 1000)) / 1000):
        return {"done": False}
    with _lock:
        _jobs.pop(job.id, None)
    if job.error is not None:
        raise RuntimeError(job.error)
    return {"done": True, "value": job.result}


def _prune():
    # Jobs the app stopped asking about (it reloaded, say).
    now = time.monotonic()
    for job_id, job in list(_jobs.items()):
        if now - job.created > 120:
            job.cancelled = True
            _jobs.pop(job_id, None)


def cancel(job_id):
    with _lock:
        job = _jobs.pop(job_id, None)
        if job is None:
            return
        job.cancelled = True
    _reap()


def _reap():
    # Called on every request, so a cancelled job is stopped soon after its grace runs out.
    with _lock:
        job = _current
        if job is None or not job.cancelled or job.interrupted or _worker is None:
            return
        if time.monotonic() - job.started < GRACE_S:
            return
        job.interrupted = True
        ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(_worker.ident), ctypes.py_object(Cancelled))


def handle(params):
    op = params.get("op")
    job_id = str(params.get("id"))
    _reap()
    if op == "call":
        if params.get("method") not in _METHODS:
            raise ValueError(f"unknown method {params.get('method')}")
        job = _Job(job_id, params["method"], params.get("args") or {})
        with _lock:
            _prune()
            _jobs[job_id] = job
        _ensure_worker()
        _queue.put(job)
        return _wait(job, params.get("wait", 0))
    if op == "poll":
        with _lock:
            job = _jobs.get(job_id)
        if job is None:
            raise RuntimeError("request was cancelled")
        return _wait(job, params.get("wait", 0))
    if op == "cancel":
        cancel(job_id)
        return None
    raise ValueError(f"unknown op {op}")


# ---- Positions ----
# The app counts in UTF-16 code units, jedi in code points; they differ only
# for characters outside the BMP (emoji), so the conversion is skipped otherwise.


def _u16(s):
    return len(s.encode("utf-16-le")) // 2


def _cp_index(s, u16):
    """Code point index of a UTF-16 offset into s."""
    if s.isascii():
        return min(u16, len(s))
    n = 0
    for i, ch in enumerate(s):
        if n >= u16:
            return i
        n += 2 if ord(ch) > 0xFFFF else 1
    return len(s)


def _position(text, offset):
    """1-based line and 0-based code point column of a UTF-16 offset, as jedi wants."""
    i = _cp_index(text, offset)
    line = text.count("\n", 0, i) + 1
    start = text.rfind("\n", 0, i) + 1
    return line, i - start


def _lines(text):
    """Lines with their line breaks kept, split where jedi (parso) splits them:
    at \r\n, \r and \n. Keeping the breaks lets _offset count \r\n as the two
    characters the app's copy of the file has."""
    return re.split(r"(?<=\n)|(?<=\r)(?!\n)", text)


def _offset(lines, line, column):
    """UTF-16 offset of jedi's (line, column)."""
    before = sum(_u16(l) for l in lines[: line - 1])
    return before + _u16(lines[line - 1][:column]) if line - 1 < len(lines) else before


# ---- Projects and files ----


class _Request:
    def __init__(self, args):
        self.root = os.path.abspath(args["root"])
        self.dir = os.path.join(self.root, "projects", args["project"])
        self.path = os.path.join(self.dir, *args["path"].split("/"))
        self.text = args["content"]
        self.offset = args.get("offset", 0)
        self._files = {self.path: _lines(self.text)}

    def script(self):
        jedi = _load()
        project = _projects.get(self.dir)
        if project is None:
            project = jedi.Project(self.dir, sys_path=self._sys_path(), smart_sys_path=True)
            _projects[self.dir] = project
        return jedi.Script(self.text, path=self.path, project=project, environment=jedi.InterpreterEnvironment())

    def _sys_path(self):
        # The project, then pip's packages, then the interpreter's own paths:
        # not this folder (jedi, the tools) or anything a running script added.
        def own(p):
            p = os.path.abspath(p)
            return p == _HERE or p.startswith((_HERE + os.sep, self.root + os.sep))

        rest = [p for p in sys.path if p and not own(p)]
        return [self.dir, os.path.join(self.dir, ".pylibs"), *rest]

    def position(self):
        return _position(self.text, self.offset)

    def rel(self, path):
        """Project-relative path with '/', or None outside the project."""
        if path is None:
            return None
        path = os.path.abspath(str(path))
        if not path.startswith(self.dir + os.sep):
            return None
        return os.path.relpath(path, self.dir).replace(os.sep, "/")

    def lines(self, path):
        path = os.path.abspath(str(path))
        if path not in self._files:
            try:
                # newline="" keeps \r\n: edits are offsets into the file as the
                # app reads it, so universal newlines would shift every line.
                with open(path, encoding="utf-8", newline="") as f:
                    self._files[path] = _lines(f.read())
            except (OSError, UnicodeDecodeError):
                self._files[path] = []
        return self._files[path]

    def location(self, name):
        rel = self.rel(name.module_path)
        if rel is None or name.line is None:
            return None
        lines = self.lines(name.module_path)
        text = lines[name.line - 1] if name.line - 1 < len(lines) else ""
        return {"path": rel, "line": name.line, "column": _u16(text[: name.column]) + 1, "preview": text.strip()[:200]}

    def word(self):
        """UTF-16 span of the identifier at the offset."""
        i = _cp_index(self.text, self.offset)
        start, end = i, i
        while start > 0 and (self.text[start - 1].isalnum() or self.text[start - 1] == "_"):
            start -= 1
        while end < len(self.text) and (self.text[end].isalnum() or self.text[end] == "_"):
            end += 1
        return self.text[start:end], _u16(self.text[:start]), _u16(self.text[:end])


# ---- Methods ----


def _signature(name):
    try:
        sigs = name.get_signatures()
    except Exception:  # noqa: BLE001 - a missing detail is fine
        return None
    return sigs[0].to_string() if sigs else None


def _in_class(name):
    try:
        return name.parent().type == "class"
    except Exception:  # noqa: BLE001
        return False


def _complete(args):
    req = _Request(args)
    line, column = req.position()
    completions = req.script().complete(line, column)[:MAX_COMPLETIONS]
    word, start, _ = req.word()
    typed = word[: _cp_index(word, req.offset - start)]
    deadline = time.monotonic() + DETAIL_BUDGET_S
    items = []
    for c in completions:
        kind = _TYPES.get(c.type, "text")
        if kind == "function" and _in_class(c):
            kind = "method"
        item = {"label": c.name, "type": kind}
        if kind in ("function", "method", "class") and time.monotonic() < deadline:
            sig = _signature(c)
            if sig and sig.startswith(c.name):
                item["detail"] = sig[len(c.name):]
        items.append(item)
    return {"from": req.offset - _u16(typed), "items": items}


def _hover(args):
    req = _Request(args)
    word, start, end = req.word()
    if not word or keyword.iskeyword(word):
        return None
    line, column = req.position()
    script = req.script()
    names = script.infer(line, column) or script.goto(line, column)
    if not names:
        return None
    n = names[0]
    doc = ""
    if n.type in ("function", "class"):
        sig = _signature(n) or n.name
        head = ("class " if n.type == "class" else "def ") + sig
        doc = n.docstring(raw=True)
    elif n.type == "module":
        head = f"module {n.name}"
        doc = n.docstring(raw=True)
    elif n.type == "instance":
        # Every type it may have, e.g. "x: int | str".
        kinds = list(dict.fromkeys(m.name for m in names if m.type == "instance"))
        head = f"{word}: {' | '.join(kinds)}"
    else:
        head = n.description
    doc = doc.strip()
    if len(doc) > MAX_DOC:
        doc = doc[:MAX_DOC].rstrip() + "…"
    return {"text": f"{head}\n\n{doc}" if doc else head, "from": start, "to": end}


def _definition(args):
    req = _Request(args)
    line, column = req.position()
    names = req.script().goto(line, column, follow_imports=True)
    out = [req.location(n) for n in names]
    return [loc for loc in out if loc]


def _references(args):
    req = _Request(args)
    line, column = req.position()
    names = req.script().get_references(line, column, include_builtins=False, scope="project")
    out = [loc for loc in (req.location(n) for n in names) if loc]
    out.sort(key=lambda loc: (loc["path"] != req.rel(req.path), loc["path"], loc["line"], loc["column"]))
    return out


def _rename(args):
    req = _Request(args)
    new = args["newName"]
    if not new.isidentifier() or keyword.iskeyword(new):
        raise ValueError(f"{new} is not a valid Python name")
    old, _, _ = req.word()
    if not old:
        raise ValueError("Put the cursor on a name first")
    line, column = req.position()
    names = req.script().get_references(line, column, include_builtins=False, scope="project")
    files = {}
    for n in names:
        rel = req.rel(n.module_path)
        # Installed packages aren't the user's to rename in.
        if rel is None or rel.startswith(".pylibs/") or n.line is None:
            continue
        lines = req.lines(n.module_path)
        text = lines[n.line - 1] if n.line - 1 < len(lines) else ""
        # Only the name itself; a module's own reference points at its first line.
        if text[n.column: n.column + len(old)] != old:
            continue
        start = _offset(lines, n.line, n.column)
        edit = {"from": start, "to": start + _u16(old), "insert": new}
        edits = files.setdefault(rel, [])
        if edit not in edits:
            edits.append(edit)
    if not files:
        raise ValueError(f"Can't rename {old}")
    return [{"path": p, "edits": sorted(e, key=lambda x: x["from"])} for p, e in files.items()]


_METHODS = {
    "complete": _complete,
    "hover": _hover,
    "definition": _definition,
    "references": _references,
    "rename": _rename,
}
