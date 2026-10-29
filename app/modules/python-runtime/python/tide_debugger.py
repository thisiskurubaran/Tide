# The Debugger extension for Python: bdb from the standard library, driven by
# the app. Events go out through emit(run_id, "debug", json); commands come in
# through tide_runner.feed() on another thread. Only files under the
# Documents root (the user's projects) are traced line by line, so library
# code runs at full speed and stepping skips over it.
import bdb
import json
import os
import queue
import reprlib

_KILL = object()
_MAX_ITEMS = 200

_repr = reprlib.Repr()
_repr.maxstring = 200
_repr.maxother = 200
_repr.maxlist = _repr.maxtuple = _repr.maxdict = _repr.maxset = 20

_LEAVES = (str, bytes, bytearray, int, float, complex, bool, type(None))


def _expandable(value):
    if isinstance(value, _LEAVES) or callable(value) and not isinstance(value, type):
        return False
    if isinstance(value, (dict, list, tuple, set, frozenset)):
        return len(value) > 0
    return hasattr(value, "__dict__") and not isinstance(value, type(os))


def _children(value):
    if isinstance(value, dict):
        return [(repr(k), v) for k, v in list(value.items())[:_MAX_ITEMS]]
    if isinstance(value, (list, tuple)):
        return [(str(i), v) for i, v in enumerate(value[:_MAX_ITEMS])]
    if isinstance(value, (set, frozenset)):
        return [(str(i), v) for i, v in enumerate(list(value)[:_MAX_ITEMS])]
    return [(k, v) for k, v in list(vars(value).items())[:_MAX_ITEMS] if not k.startswith("__")]


def _visible(name, value):
    # Scopes hide dunder names and imported modules, which are noise when debugging a script.
    return not (name.startswith("__") and name.endswith("__")) and not isinstance(value, type(os))


class Debugger(bdb.Bdb):
    def __init__(self, emit, run_id, root, breakpoints):
        super().__init__()
        self._emit = emit
        self._id = run_id
        self._root = os.path.abspath(root)
        self._commands = queue.Queue()
        self._handles = {}
        self._frames = []
        self._started = False
        self._paused = False
        self._pause_requested = False
        for file, lines in (breakpoints or {}).items():
            self._set_breakpoints(file, lines)

    # ---- talking to the app ----

    def _send(self, event):
        self._emit(self._id, "debug", json.dumps(event))

    def command(self, raw):
        """Called from the thread that feeds the run."""
        cmd = json.loads(raw)
        kind = cmd.get("cmd")
        # These work whether or not the script is paused.
        if kind == "setBreakpoints":
            self._set_breakpoints(cmd["file"], cmd["lines"])
        elif kind == "pause":
            if not self._paused:
                self._pause_requested = True
        elif self._paused:
            self._commands.put(cmd)
        elif kind == "variables":
            self._send({"event": "variables", "req": cmd["req"], "variables": []})
        elif kind == "evaluate":
            self._send({"event": "evaluated", "req": cmd["req"], "error": "The program is running"})

    def kill(self):
        self._commands.put(_KILL)

    def _set_breakpoints(self, file, lines):
        path = os.path.join(self._root, file)
        self.clear_all_file_breaks(self.canonic(path))
        for line in lines:
            # Lines without code are refused by bdb; the editor still shows them.
            self.set_break(path, int(line))

    # ---- tracing ----

    def _is_user(self, filename):
        # "<frozen runpy>" and the like aren't files; abspath would put them under the cwd.
        return os.path.isabs(filename) and filename.startswith(self._root + os.sep)

    def dispatch_call(self, frame, arg):
        if self.botframe is None:
            self.botframe = frame.f_back
            return self.trace_dispatch
        # Line events only for the user's files, but always for them, so
        # breakpoints added while running and pause requests take effect.
        return self.trace_dispatch if self._is_user(frame.f_code.co_filename) else None

    def stop_here(self, frame):
        if self._pause_requested and self._is_user(frame.f_code.co_filename):
            return True
        return super().stop_here(frame)

    def _continue(self):
        # bdb's set_continue stops tracing when there are no breakpoints,
        # which would ignore breakpoints set later.
        self._set_stopinfo(self.botframe, None, -1)

    def user_line(self, frame):
        if not self._started:
            # The first line of the script: run until a breakpoint.
            self._started = True
            self._continue()
            if not (self._pause_requested or self.break_here(frame)):
                return
        if not self._is_user(frame.f_code.co_filename):
            return
        if self._pause_requested:
            reason = "pause"
            self._pause_requested = False
        elif self.get_break(self.canonic(frame.f_code.co_filename), frame.f_lineno):
            reason = "breakpoint"
        else:
            reason = "step"
        self._interact(frame, reason)

    def _interact(self, frame, reason):
        stack, top = self.get_stack(frame, None)
        self._frames = [f for f, _ in reversed(stack[: top + 1]) if self._is_user(f.f_code.co_filename)]
        self._handles = {}
        self._paused = True
        self._send({"event": "stopped", "reason": reason, "frames": [self._frame(f) for f in self._frames]})
        try:
            while True:
                cmd = self._commands.get()
                if cmd is _KILL:
                    raise KeyboardInterrupt
                kind = cmd["cmd"]
                if kind == "variables":
                    self._send({"event": "variables", "req": cmd["req"], "variables": self._variables(cmd["ref"])})
                elif kind == "evaluate":
                    self._send(self._evaluate(cmd))
                elif kind == "continue":
                    self._continue()
                    break
                elif kind == "stepOver":
                    self.set_next(frame)
                    break
                elif kind == "stepInto":
                    self.set_step()
                    break
                elif kind == "stepOut":
                    self.set_return(frame)
                    break
        finally:
            self._paused = False
            self._handles = {}
        self._send({"event": "resumed"})

    # ---- what the app shows ----

    def _handle(self, target):
        ref = len(self._handles) + 1
        self._handles[ref] = target
        return ref

    def _frame(self, f):
        rel = os.path.relpath(os.path.abspath(f.f_code.co_filename), self._root).replace(os.sep, "/")
        scopes = [{"name": "Locals", "ref": self._handle(("locals", f))}]
        if f.f_locals is not f.f_globals:
            scopes.append({"name": "Globals", "ref": self._handle(("globals", f))})
        return {"name": f.f_code.co_name, "file": rel, "line": f.f_lineno, "column": 1, "scopes": scopes}

    def _variable(self, name, value):
        try:
            text = _repr.repr(value)
        except Exception as e:  # noqa: BLE001 - a broken __repr__ shouldn't stop debugging
            text = f"<repr failed: {e}>"
        ref = self._handle(("value", value)) if _expandable(value) else 0
        return {"name": name, "value": text, "type": type(value).__name__, "ref": ref}

    def _variables(self, ref):
        target = self._handles.get(ref)
        if target is None:
            return []
        kind, obj = target
        if kind == "locals":
            items = [(k, v) for k, v in obj.f_locals.items() if _visible(k, v)]
        elif kind == "globals":
            items = [(k, v) for k, v in obj.f_globals.items() if _visible(k, v)]
        else:
            items = _children(obj)
        return [self._variable(k, v) for k, v in items[:_MAX_ITEMS]]

    def _evaluate(self, cmd):
        index = cmd.get("frame", 0)
        if not 0 <= index < len(self._frames):
            return {"event": "evaluated", "req": cmd["req"], "error": "No such frame"}
        f = self._frames[index]
        try:
            value = eval(cmd["expression"], f.f_globals, f.f_locals)  # noqa: S307 - the user's own debug console
        except Exception as e:  # noqa: BLE001 - shown in the debug console
            return {"event": "evaluated", "req": cmd["req"], "error": f"{type(e).__name__}: {e}"}
        return {"event": "evaluated", "req": cmd["req"], "result": self._variable(cmd["expression"], value)}

    def run_script(self, func):
        self.runcall(func)
