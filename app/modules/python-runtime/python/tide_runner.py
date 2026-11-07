# Runs user scripts for the app. Shared by Android (Chaquopy) and iOS
# (embedded CPython). The native side starts a thread per run and calls run()
# on it; feed(), eof() and kill() may be called from any other thread.
import builtins
import ctypes
import errno
import functools
import io
import json
import os
import queue
import runpy
import socket
import stat as _stat
import sys
import threading
import traceback

_KILL = object()
_runs = {}
_lock = threading.Lock()


# The app runs a script under the debugger by passing these first (see
# pythonRunner.ts), and sends debugger commands as stdin with a prefix.
_DEBUG_ARG = "--tide-debug"
_ENV_ARG = "--tide-env"
_DEBUG_PREFIX = "\x00tide-debug:"


class _Run:
    def __init__(self):
        self.queue = queue.Queue()
        self.ident = threading.get_ident()
        self.killed = False
        self.debugger = None
        self.emit = None
        self.run_id = None
        self.stdout = None
        self.stderr = None
        self.stdin = None
        # Set once run() is cleaning up, so kill() no longer interrupts it.
        self.finishing = False
        # sys.argv for this run's threads; None means the proxy's own list (the first run's).
        self.argv = None
        # Working folder for a run that joined in a folder other than the process's
        # real cwd; None means the real one. See _vcwd().
        self.cwd = None
        # os.environ values this run sees instead of the shared ones (None = unset).
        self.env = None


# Which run the current thread belongs to: for output, input and listening ports.
_current = threading.local()
_socket_listen = socket.socket.listen
_thread_start = threading.Thread.start


def _start_thread(self, *args, **kwargs):
    # Threads a script starts (servers, executors) belong to its run, so their
    # print() goes to the right terminal. A thread started from such a thread
    # (a request thread from serve_forever() on a background thread) is too.
    self._tide_run = _run_of_thread()
    return _thread_start(self, *args, **kwargs)


threading.Thread.start = _start_thread


def _run_of_thread():
    run = getattr(_current, "run", None)
    if run is None:
        run = getattr(threading.current_thread(), "_tide_run", None)
    return run


def _listen(self, *args):
    result = _socket_listen(self, *args)
    run = _run_of_thread()
    if run is None:
        # A server thread the script started: with one run going, it is that one's.
        with _lock:
            active = list(_runs.values())
        run = active[0] if len(active) == 1 else None
    if run is not None and run.emit is not None:
        try:
            port = self.getsockname()[1]
        except OSError:
            port = None
        if isinstance(port, int):
            # The terminal offers a preview of the port (see pythonRunner.ts).
            run.emit(run.run_id, "port", json.dumps({"port": port, "open": True}))
    return result


socket.socket.listen = _listen


class _Output(io.TextIOBase):
    def __init__(self, emit, run_id, kind):
        self._emit = emit
        self._id = run_id
        self._kind = kind

    @property
    def encoding(self):
        return "utf-8"

    def writable(self):
        return True

    def isatty(self):
        return False

    def write(self, text):
        if text:
            self._emit(self._id, self._kind, str(text))
        return len(text)


class _Input(io.TextIOBase):
    """stdin fed from the app. Blocking reads release the GIL (queue.get)."""

    def __init__(self, run):
        self._run = run
        self._buf = ""
        self._eof = False

    @property
    def encoding(self):
        return "utf-8"

    def readable(self):
        return True

    def isatty(self):
        return False

    def _fill(self):
        chunk = self._run.queue.get()
        if chunk is _KILL:
            raise KeyboardInterrupt
        if chunk is None:
            self._eof = True
        else:
            self._buf += chunk

    def readline(self, size=-1):
        while "\n" not in self._buf and not self._eof:
            self._fill()
        end = self._buf.find("\n") + 1 or len(self._buf)
        if size is not None and size >= 0:
            end = min(end, size)
        line, self._buf = self._buf[:end], self._buf[end:]
        return line

    def read(self, size=-1):
        while not self._eof and (size is None or size < 0 or len(self._buf) < size):
            self._fill()
        if size is None or size < 0:
            size = len(self._buf)
        text, self._buf = self._buf[:size], self._buf[size:]
        return text

    def __iter__(self):
        return self

    def __next__(self):
        line = self.readline()
        if not line:
            raise StopIteration
        return line


class _ThreadStream:
    """Installed once as sys.stdout/stderr/stdin. Runs share one interpreter on
    different threads, so each call goes to the stream of the run the calling
    thread belongs to, and to the interpreter's own stream otherwise."""

    def __init__(self, name):
        self._name = name
        self.original = getattr(sys, name)

    def target(self):
        override = getattr(_current, "streams", None)  # snippet() capturing output
        if override is not None:
            return override
        run = _run_of_thread()
        stream = getattr(run, self._name, None) if run is not None else None
        return stream if stream is not None else self.original

    def __getattr__(self, attr):
        return getattr(self.target(), attr)

    def __iter__(self):
        return iter(self.target())

    def __next__(self):
        return next(self.target())


_streams = {name: _ThreadStream(name) for name in ("stdout", "stderr", "stdin")}


def _install_streams():
    """Puts the proxies in place. Called with _lock held."""
    for name, proxy in _streams.items():
        current = getattr(sys, name)
        if current is not proxy:
            if not _runs:
                # Nothing is running, so whatever is there is the host's own stream.
                proxy.original = current
            setattr(sys, name, proxy)


# ---- per-run views of process-wide state ----
#
# cwd, os.environ and sys.argv belong to the whole process, but runs overlap
# (a server plus a client script, a notebook, `PORT=9000 python x.py`). The
# first run really sets them; a run that joins it gets its own view through
# these proxies, keyed by the run the calling thread belongs to:
#  - sys.argv is a list whose operations go to the calling run's list.
#  - os.environ looks up the run's overlay first (its variables, and the
#    pre-run value of any variable only the first run set).
#  - A joiner in another folder gets a virtual cwd: os.getcwd(), os.chdir(),
#    open(), the os.* path functions (and so os.path, pathlib, glob, shutil)
#    and sqlite3.connect() resolve relative paths against it, like
#    runcwd.js does for Node workers. C code that opens relative paths itself
#    and subprocess still see the real cwd.
# Threads outside any run (the host, snippet()) see the real state.


def _vcwd():
    run = _run_of_thread()
    return None if run is None else run.cwd


def _abs(path, cwd):
    """`path` made absolute against a run's virtual cwd; fds and others untouched."""
    if isinstance(path, int):
        return path
    try:
        p = os.fspath(path)
    except TypeError:
        return path
    if isinstance(p, bytes):
        return os.path.join(os.fsencode(cwd), p) if p and not p.startswith(b"/") else path
    return os.path.join(cwd, p) if p and not p.startswith("/") else path


_real = {"getcwd": os.getcwd, "getcwdb": os.getcwdb, "chdir": os.chdir, "stat": os.stat, "open": io.open}
_DIR_FDS = ("dir_fd", "src_dir_fd", "dst_dir_fd")


def _path_function(fn, names, default_cwd):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        run = _run_of_thread()
        cwd = None if run is None else run.cwd
        # Paths relative to a dir_fd are left alone, like the real call would.
        if cwd is not None and not any(kwargs.get(k) is not None for k in _DIR_FDS):
            args = list(args)
            for i, name in enumerate(names):
                if name is None:
                    continue
                if i < len(args):
                    args[i] = _abs(args[i], cwd)
                elif name in kwargs:
                    kwargs[name] = _abs(kwargs[name], cwd)
            if default_cwd and not args and "path" not in kwargs:
                args = [cwd]
        return fn(*args, **kwargs)

    return wrapper


def _getcwd():
    cwd = _vcwd()
    return _real["getcwd"]() if cwd is None else cwd


def _getcwdb():
    cwd = _vcwd()
    return _real["getcwdb"]() if cwd is None else os.fsencode(cwd)


def _chdir(path):
    run = _run_of_thread()
    if run is None or run.cwd is None or isinstance(path, int):
        return _real["chdir"](path)
    target = os.path.normpath(_abs(path, run.cwd))
    if isinstance(target, bytes):
        target = os.fsdecode(target)
    if not _stat.S_ISDIR(_real["stat"](target).st_mode):  # FileNotFoundError like chdir
        raise NotADirectoryError(errno.ENOTDIR, os.strerror(errno.ENOTDIR), path)
    run.cwd = target


@functools.wraps(io.open)
def _open(file, *args, **kwargs):
    cwd = _vcwd()
    if cwd is not None:
        file = _abs(file, cwd)
    return _real["open"](file, *args, **kwargs)


def _install_cwd_functions():
    one, two = ("path",), ("src", "dst")
    specs = {name: one for name in (
        "access", "chmod", "chown", "lchown", "lchmod", "chflags", "lchflags", "lstat", "stat",
        "mkdir", "mkfifo", "mknod", "open", "pathconf", "readlink", "remove", "unlink", "rmdir",
        "statvfs", "truncate", "utime", "getxattr", "setxattr", "removexattr",
    )}
    specs.update({"rename": two, "replace": two, "link": two, "symlink": (None, "dst")})
    # A symlink's target is stored verbatim: relative to the link, not the cwd.
    defaults = {"listdir": one, "scandir": one, "listxattr": one}
    replaced = {}
    for name, names in [*specs.items(), *defaults.items()]:
        fn = getattr(os, name, None)
        if fn is not None:
            replaced[fn] = _path_function(fn, names, name in defaults)
            setattr(os, name, replaced[fn])
    replaced[os.getcwd], replaced[os.getcwdb], replaced[os.chdir] = _getcwd, _getcwdb, _chdir
    os.getcwd, os.getcwdb, os.chdir = _getcwd, _getcwdb, _chdir
    # `os.stat in os.supports_dir_fd` and friends keep answering for the wrappers.
    for group in ("supports_dir_fd", "supports_fd", "supports_follow_symlinks", "supports_effective_ids"):
        supported = getattr(os, group, None)
        if isinstance(supported, set):
            supported.update(w for f, w in replaced.items() if f in supported)
    builtins.open = io.open = _open


_install_cwd_functions()


def _patch_sqlite():
    """sqlite3.connect() opens relative paths in C, against the real cwd."""
    try:
        import sqlite3
    except ImportError:
        return
    if getattr(sqlite3.connect, "_tide", False):
        return
    connect = sqlite3.connect

    @functools.wraps(connect)
    def wrapper(database, *args, **kwargs):
        cwd = _vcwd()
        if cwd is not None and not kwargs.get("uri"):
            name = os.fspath(database) if isinstance(database, (str, bytes, os.PathLike)) else database
            if name not in (":memory:", b":memory:", "", b""):
                database = _abs(name, cwd)
        return connect(database, *args, **kwargs)

    wrapper._tide = True
    sqlite3.connect = sqlite3.dbapi2.connect = wrapper


class _ThreadEnviron(os._Environ):
    """os.environ's class while tide_runner is loaded: a joined run's overlay
    wins over the process environment for that run's threads."""

    def __getitem__(self, key):
        overlay = _env_overlay()
        if overlay is not None and key in overlay:
            value = overlay[key]
            if value is None:
                raise KeyError(key)
            return value
        return super().__getitem__(key)

    def __setitem__(self, key, value):
        overlay = _env_overlay()
        if overlay is None:
            return super().__setitem__(key, value)
        self.encodekey(key), self.encodevalue(value)  # same errors as the real one
        overlay[key] = value

    def __delitem__(self, key):
        overlay = _env_overlay()
        if overlay is None:
            return super().__delitem__(key)
        if key not in self:
            raise KeyError(key)
        overlay[key] = None

    def __iter__(self):
        overlay = _env_overlay()
        if overlay is None:
            yield from super().__iter__()
            return
        for key in list(super().__iter__()):
            if key not in overlay:
                yield key
        for key, value in list(overlay.items()):
            if value is not None:
                yield key

    def __len__(self):
        if _env_overlay() is None:
            return super().__len__()
        return sum(1 for _ in self)

    def __repr__(self):
        if _env_overlay() is None:
            return super().__repr__()
        return f"environ({dict(self)!r})"


def _env_overlay():
    run = _run_of_thread()
    return None if run is None else run.env


def _env_set(key, value):
    """Sets (or with None, unsets) a variable for the whole process."""
    # The base class's methods, so a joined run's overlay can't get in the way.
    if value is None:
        try:
            os._Environ.__delitem__(os.environ, key)
        except KeyError:
            pass
    else:
        os._Environ.__setitem__(os.environ, key, value)


os.environ.__class__ = _ThreadEnviron


class _ThreadArgv(list):
    """Installed as sys.argv during runs. Its own items are the first run's
    argv (so C code reading the list directly sees a lone run's argv exactly);
    a joined run's threads read and change their own list instead. A script
    that assigns sys.argv itself replaces it for every run until the next run
    starts or the last one ends."""

    __hash__ = None

    def __reduce_ex__(self, protocol):
        return list, (list(self),)


def _argv_target(proxy):
    run = _run_of_thread()
    own = None if run is None else run.argv
    return proxy if own is None else own


def _argv_method(name):
    base = getattr(list, name)
    returns_self = name in ("__iadd__", "__imul__")

    def method(self, *args):
        result = base(_argv_target(self), *args)
        return self if returns_self else result

    method.__name__ = name
    return method


for _name in (
    "__getitem__", "__setitem__", "__delitem__", "__len__", "__iter__", "__reversed__",
    "__contains__", "__add__", "__iadd__", "__mul__", "__rmul__", "__imul__", "__eq__", "__ne__",
    "__lt__", "__le__", "__gt__", "__ge__", "__repr__", "append", "extend", "insert", "pop",
    "remove", "index", "count", "clear", "sort", "reverse", "copy",
):
    setattr(_ThreadArgv, _name, _argv_method(_name))
del _name

_argv = _ThreadArgv()


# Overlapping runs in one project share the interpreter: the first sets the
# real cwd, os.environ and sys.argv, later ones join it with their own views
# (above). Runs in another project are refused: sys.modules is shared, so their
# main.py, db.py... would be the other project's. The state from before the
# first run is put back, and project modules dropped, when the last one ends.
_shared = None  # {"scope", "count", "cwd", "argv", "path", "env", "purge"} while runs are active


def _scope(cwd, purge_root):
    # <root>/projects/<name>/... -> the project folder; otherwise the folder itself.
    if purge_root:
        root = os.path.abspath(purge_root)
        parts = os.path.relpath(cwd, root).split(os.sep)
        if len(parts) >= 2 and parts[0] == "projects":
            return os.path.join(root, parts[0], parts[1])
    return cwd


def _refusal(scope):
    return (
        f"Another Python program is running in {scope}; stop it first.\n"
        "To run this one, stop the other (Ctrl-C or the stop button in the terminal running it), "
        "then run this again. Python programs share one interpreter, so programs from different "
        "projects can't run at the same time; ones in the same project can.\n"
    )


def _check_env(env):
    for key, value in env.items():
        if not isinstance(key, str) or not isinstance(value, str) or not key or "=" in key or "\0" in key + value:
            raise ValueError(f"invalid environment variable {key!r}")


def _enter_shared(state, cwd, env, argv, purge_root):
    """Called with _lock held. Returns an error message, or None once the run
    is counted in (and its cwd, env and argv are in place)."""
    global _shared
    cwd = os.path.abspath(cwd)
    scope = _scope(cwd, purge_root)
    try:
        _check_env(env)
    except ValueError as e:
        return f"ValueError: {e}\n"
    if _shared is not None:
        if _shared["scope"] != scope:
            return _refusal(_shared["scope"])
        if not os.path.isdir(cwd):
            return f"FileNotFoundError: [Errno 2] No such file or directory: {cwd!r}\n"
        if cwd != _real["getcwd"]():
            state.cwd = cwd
        # The first run's variables this run doesn't set read as they were before it.
        overlay = {k: v for k, v in _shared["env"].items() if k not in env}
        overlay.update(env)
        state.env = overlay or None
        state.argv = list(argv)
        if sys.argv is not _argv:
            sys.argv = _argv
        _shared["count"] += 1
        if purge_root:
            _shared["purge"].add(os.path.abspath(purge_root))
        return None
    saved_env = {k: os.environ.get(k) for k in env}
    saved_cwd = _real["getcwd"]()
    try:
        for k, v in env.items():
            _env_set(k, v)
        _real["chdir"](cwd)
    except (OSError, ValueError) as e:
        for k, v in saved_env.items():
            _env_set(k, v)
        return f"{type(e).__name__}: {e}\n"
    _shared = {
        "scope": scope, "count": 1, "cwd": saved_cwd, "argv": sys.argv, "path": list(sys.path),
        "env": saved_env, "purge": {os.path.abspath(purge_root)} if purge_root else set(),
    }
    list.__init__(_argv, argv)
    sys.argv = _argv
    return None


def _leave_shared(own_paths):
    """Called with _lock held when a run that entered ends."""
    global _shared
    _shared["count"] -= 1
    if _shared["count"] > 0:
        # Others still run: take out only this run's sys.path entries, and keep
        # the modules they share (a server's in-memory state lives in them).
        for p in own_paths:
            try:
                sys.path.remove(p)
            except ValueError:
                pass
        return
    saved, _shared = _shared, None
    sys.argv = saved["argv"]
    list.clear(_argv)
    sys.path[:] = saved["path"]
    for k, v in saved["env"].items():
        try:
            _env_set(k, v)
        except (OSError, ValueError):
            pass
    try:
        _real["chdir"](saved["cwd"])
    except OSError:
        pass
    # A script that replaced sys.stdout and friends doesn't break the next run.
    for name, proxy in _streams.items():
        setattr(sys, name, proxy)
    # Modules loaded from the workspace are dropped so the next run sees edits.
    for root in saved["purge"]:
        root += os.sep
        for name, module in list(sys.modules.items()):
            path = getattr(module, "__file__", None) or ""
            if path.startswith(root):
                del sys.modules[name]


def _drop_interrupt(state):
    """Drops an interrupt kill() sent that hasn't been raised yet."""
    with _lock:
        ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(state.ident), None)


def _user_traceback(tb, entry):
    # Skip runpy and this module so the traceback starts in the user's script,
    # like `python script.py` would show it.
    while tb is not None and os.path.abspath(tb.tb_frame.f_code.co_filename) != entry:
        tb = tb.tb_next
    return tb


def _project_dir(entry, purge_root):
    # Scripts live in <root>/projects/<name>/...; tracebacks show paths from there,
    # like the shell does, instead of the long sandbox path.
    if not purge_root:
        return None
    parts = os.path.relpath(entry, purge_root).split(os.sep)
    if len(parts) > 2 and parts[0] == "projects":
        return os.path.join(os.path.abspath(purge_root), parts[0], parts[1])
    return None


def _print_error(e, entry, err, project_dir):
    text = "".join(traceback.format_exception(type(e), e, _user_traceback(e.__traceback__, entry)))
    if project_dir:
        text = text.replace(f'File "{project_dir}{os.sep}', 'File "/')
    err.write(text)


def _exit_code(code, err):
    if code is None:
        return 0
    if isinstance(code, int):
        return code
    err.write(f"{code}\n")
    return 1


def _execute(state, entry, err, purge_root):
    """Runs the script; returns its exit code."""
    try:
        if state.debugger:
            state.debugger.run_script(lambda: runpy.run_path(entry, run_name="__main__"))
        else:
            runpy.run_path(entry, run_name="__main__")
    except SystemExit as e:
        return _exit_code(e.code, err)
    except KeyboardInterrupt:
        err.write("KeyboardInterrupt\n")
        return 130
    except BaseException as e:  # noqa: BLE001 - every error is reported to the user
        _print_error(e, entry, err, _project_dir(entry, purge_root))
        return 1
    return 0


def run(emit, run_id, entry, cwd, args, extra_paths=(), purge_root=None):
    """Runs `entry` as __main__ and returns (exit code, killed).

    emit(run_id, "stdout" | "stderr", text) receives output. Modules loaded
    from under `purge_root` are dropped once no run is left, so the next run
    sees edits.
    """
    entry = os.path.abspath(entry)
    state = _Run()
    state.emit = emit
    state.run_id = run_id
    _current.run = state
    env = {}
    if args and args[0] == _ENV_ARG:
        env = json.loads(args[1])
        args = list(args[2:])
    if args and args[0] == _DEBUG_ARG:
        from tide_debugger import Debugger

        config = json.loads(args[1])
        args = list(args[2:])
        state.debugger = Debugger(emit, run_id, purge_root or os.path.dirname(entry), config.get("breakpoints"))
    out = _Output(emit, run_id, "stdout")
    err = _Output(emit, run_id, "stderr")
    state.stdout, state.stderr, state.stdin = out, err, _Input(state)
    with _lock:
        refused = _enter_shared(state, cwd, env, [entry, *args], purge_root)
        if refused is None:
            _install_streams()
            _runs[run_id] = state
    if refused is not None:
        _current.run = None
        err.write(refused)
        return 1, False

    own_paths = [os.path.dirname(entry), *extra_paths]
    code = 130
    try:
        sys.path[0:0] = own_paths
        if state.cwd is not None:
            _patch_sqlite()
        code = _execute(state, entry, err, purge_root)
    except KeyboardInterrupt:
        pass  # a kill() that landed outside the script, or while reporting its error
    finally:
        # kill() checks this flag under _lock, so from here on it sends nothing
        # more. The interrupt slot holds one exception, so at most one already
        # sent can still arrive: it is either raised here and caught, or dropped.
        # (Plain statements: entering a function could raise it outside the try.)
        state.finishing = True
        try:
            _drop_interrupt(state)
        except KeyboardInterrupt:
            pass
        with _lock:
            _runs.pop(run_id, None)
            _leave_shared(own_paths)
        _current.run = None
    return code, state.killed


def feed(run_id, data):
    state = _runs.get(run_id)
    if not state:
        return
    if data.startswith(_DEBUG_PREFIX):
        if state.debugger:
            state.debugger.command(data[len(_DEBUG_PREFIX):])
        return
    state.queue.put(data)


def eof(run_id):
    state = _runs.get(run_id)
    if state:
        state.queue.put(None)


def kill(run_id):
    """Interrupts a run with KeyboardInterrupt, like Ctrl-C in a real terminal."""
    with _lock:
        state = _runs.get(run_id)
        if not state or state.finishing:
            return
        state.killed = True
        # Wakes a blocked input() or a paused debugger; the async exception covers running code.
        state.queue.put(_KILL)
        if state.debugger:
            state.debugger.kill()
        # Under _lock, so it can't be sent once run() has started cleaning up.
        ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(state.ident), ctypes.py_object(KeyboardInterrupt))


def version():
    return sys.version


# Requests for tide_tools (Format & Lint) arrive through snippet() so the
# native modules need no new function. They return a value instead of
# capturing stdout, which may belong to a script running on another thread.
_TOOL_PREFIX = "#tide-tool\n"


def snippet(code):
    """Runs a code string and returns its output. Used by the debug screen."""
    if code.startswith(_TOOL_PREFIX):
        import tide_tools

        return tide_tools.handle(code[len(_TOOL_PREFIX):])
    buf = io.StringIO()
    # Only this thread's output is captured; runs on other threads keep theirs.
    with _lock:
        _install_streams()
    _current.streams = buf
    try:
        exec(compile(code, "<tide>", "exec"), {"__name__": "__main__"})
    except BaseException:  # noqa: BLE001
        traceback.print_exc()
    finally:
        _current.streams = None
    return buf.getvalue()
