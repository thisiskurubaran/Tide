# Runs user scripts for the app. Shared by Android (Chaquopy) and iOS
# (embedded CPython). The native side starts a thread per run and calls run()
# on it; feed(), eof() and kill() may be called from any other thread.
import ctypes
import io
import json
import os
import queue
import runpy
import sys
import threading
import traceback

_KILL = object()
_runs = {}
_lock = threading.Lock()


# The app runs a script under the debugger by passing these first (see
# pythonRunner.ts), and sends debugger commands as stdin with a prefix.
_DEBUG_ARG = "--tide-debug"
_DEBUG_PREFIX = "\x00tide-debug:"


class _Run:
    def __init__(self):
        self.queue = queue.Queue()
        self.ident = threading.get_ident()
        self.killed = False
        self.debugger = None


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
    if args and args[0] == _DEBUG_ARG:
        from tide_debugger import Debugger

        config = json.loads(args[1])
        args = list(args[2:])
        state.debugger = Debugger(emit, run_id, purge_root or os.path.dirname(entry), config.get("breakpoints"))
    with _lock:
        _runs[run_id] = state

    out = _Output(emit, run_id, "stdout")
    err = _Output(emit, run_id, "stderr")
    saved = (sys.stdout, sys.stderr, sys.stdin, sys.argv, list(sys.path), os.getcwd())
    sys.stdout, sys.stderr, sys.stdin = out, err, _Input(state)
    sys.argv = [entry, *args]
    sys.path[0:0] = [os.path.dirname(entry), *extra_paths]

    code = 0
    try:
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
        with _lock:
            _runs.pop(run_id, None)
        sys.stdout, sys.stderr, sys.stdin, sys.argv, sys.path[:], cwd_before = saved
        try:
            os.chdir(cwd_before)
        except OSError:
            pass
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
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = buf
    try:
        exec(compile(code, "<tide>", "exec"), {"__name__": "__main__"})
    except BaseException:  # noqa: BLE001
        traceback.print_exc()
    finally:
        sys.stdout, sys.stderr = old_out, old_err
    return buf.getvalue()
