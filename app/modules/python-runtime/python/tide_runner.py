# Runs user scripts for the app. Shared by Android (Chaquopy) and iOS
# (embedded CPython). The native side starts a thread per run and calls run()
# on it; feed(), eof() and kill() may be called from any other thread.
import ctypes
import io
import json
import os
import queue
import runpy
import socket
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


# Which run the current thread belongs to: for output, input and listening ports.
_current = threading.local()
_socket_listen = socket.socket.listen
_thread_start = threading.Thread.start


def _start_thread(self, *args, **kwargs):
    # Threads a script starts (servers, executors) belong to its run, so their
    # print() goes to the right terminal.
    self._tide_run = getattr(_current, "run", None)
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


# cwd, os.environ, sys.argv and sys.path belong to the whole process, so runs
# that overlap must agree on them: a second run in the same folder with the same
# environment joins the first (a server plus a client script), one in another
# folder is refused instead of moving the first run's files. The state from
# before the first run is put back when the last one ends.
_shared = None  # {"key", "count", "cwd", "argv", "path", "env"} while runs are active


def _enter_shared(cwd, env):
    """Returns (error message or None, whether this run is the first)."""
    global _shared
    key = (os.path.abspath(cwd), tuple(sorted(env.items())))
    if _shared is not None:
        if _shared["key"] != key:
            return (
                f"Another Python program is running in {_shared['key'][0]}; stop it first.\n"
                "(Python programs share one interpreter, so ones in different folders or with "
                "different environment variables can't run at the same time.)\n"
            ), False
        _shared["count"] += 1
        return None, False
    saved_env = {k: os.environ.get(k) for k in env}
    _shared = {"key": key, "count": 1, "cwd": os.getcwd(), "argv": sys.argv, "path": list(sys.path), "env": saved_env}
    os.environ.update(env)
    return None, True


def _leave_shared(own_paths):
    """Called with _lock held when a run that entered ends."""
    global _shared
    _shared["count"] -= 1
    if _shared["count"] > 0:
        # Others still run: take out only this run's sys.path entries.
        for p in own_paths:
            try:
                sys.path.remove(p)
            except ValueError:
                pass
        return
    saved, _shared = _shared, None
    sys.argv = saved["argv"]
    sys.path[:] = saved["path"]
    for k, v in saved["env"].items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        os.chdir(saved["cwd"])
    except OSError:
        pass
    # A script that replaced sys.stdout and friends doesn't break the next run.
    for name, proxy in _streams.items():
        setattr(sys, name, proxy)


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


def run(emit, run_id, entry, cwd, args, extra_paths=(), purge_root=None):
    """Runs `entry` as __main__ and returns (exit code, killed).

    emit(run_id, "stdout" | "stderr", text) receives output. Modules loaded
    from under `purge_root` are dropped afterwards so the next run sees edits.
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
        refused, first = _enter_shared(cwd, env)
        if refused is None:
            _install_streams()
            _runs[run_id] = state
    if refused is not None:
        _current.run = None
        err.write(refused)
        return 1, False

    sys.argv = [entry, *args]
    own_paths = [os.path.dirname(entry), *extra_paths]
    sys.path[0:0] = own_paths

    code = 0
    try:
        if first:
            # Runs that join an active one are already there (and must not undo
            # an os.chdir() the first run's script made).
            os.chdir(cwd)
        if state.debugger:
            state.debugger.run_script(lambda: runpy.run_path(entry, run_name="__main__"))
        else:
            runpy.run_path(entry, run_name="__main__")
    except SystemExit as e:
        code = _exit_code(e.code, err)
    except KeyboardInterrupt:
        err.write("KeyboardInterrupt\n")
        code = 130
    except BaseException as e:  # noqa: BLE001 - every error is reported to the user
        _print_error(e, entry, err, _project_dir(entry, purge_root))
        code = 1
    finally:
        _current.run = None
        with _lock:
            _runs.pop(run_id, None)
            _leave_shared(own_paths)
        if purge_root:
            root = os.path.abspath(purge_root) + os.sep
            for name, module in list(sys.modules.items()):
                path = getattr(module, "__file__", None) or ""
                if path.startswith(root):
                    del sys.modules[name]
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
    state = _runs.get(run_id)
    if not state:
        return
    state.killed = True
    # Wakes a blocked input() or a paused debugger; the async exception covers running code.
    state.queue.put(_KILL)
    if state.debugger:
        state.debugger.kill()
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
