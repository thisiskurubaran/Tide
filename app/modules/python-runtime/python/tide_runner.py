# Runs user scripts for the app. Shared by Android (Chaquopy) and iOS
# (embedded CPython). The native side starts a thread per run and calls run()
# on it; feed(), eof() and kill() may be called from any other thread.
import builtins
import ctypes
import errno
import functools
import inspect
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
import types
from collections.abc import Mapping

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
        # Working folder of a run that joined another; None for the first run,
        # which uses the process's real cwd. See _vcwd().
        self.cwd = None
        # os.environ values this run sees instead of the shared ones (None = unset).
        self.env = None
        # sys.stdout/stderr/stdin as this run assigned them (contextlib.redirect_stdout,
        # `sys.stdout = f`); missing means the run's own stream. See _Sys.
        self.streams = {}
        # This run's __main__ module(s) while its script runs (see _MainModule).
        self.main_stack = []
        # Set once the run has ended: threads it started no longer belong to it.
        self.ended = False


# Which run the current thread belongs to: for output, input and listening ports.
_current = threading.local()
_socket_listen = socket.socket.listen
_thread_start = threading.Thread.start


_NO_TASK = object()


def _start_thread(self, *args, **kwargs):
    # Threads a script starts (servers, executors, threading.Timer) belong to its
    # run, so their print() goes to the right terminal. A thread started from such
    # a thread (a request thread from serve_forever() on a background thread) is too.
    self._tide_run = _run_of_thread()
    return _thread_start(self, *args, **kwargs)


threading.Thread.start = _start_thread


def _run_of_thread():
    run = getattr(_current, "run", None)
    if run is not None:
        return run
    # A task handed to a pooled thread belongs to the run that submitted it.
    run = getattr(_current, "task", _NO_TASK)
    if run is _NO_TASK:
        run = getattr(threading.current_thread(), "_tide_run", None)
    # A thread (a pool worker, a daemon) outliving its run falls back to the host.
    return None if run is None or run.ended else run


def _in_run(fn, run):
    """`fn` wrapped to run as part of `run` on whichever thread calls it."""

    @functools.wraps(fn)
    def task(*args, **kwargs):
        previous = getattr(_current, "task", _NO_TASK)
        _current.task = run
        try:
            return fn(*args, **kwargs)
        finally:
            if previous is _NO_TASK:
                del _current.task
            else:
                _current.task = previous

    return task


def _patch_executor():
    """ThreadPoolExecutor keeps its worker threads across runs (asyncio's
    default executor, a module-level pool): each task belongs to the run that
    submitted it, not to the run that happened to start the thread."""
    try:
        from concurrent.futures import thread as futures_thread
    except ImportError:
        return
    submit = futures_thread.ThreadPoolExecutor.submit
    if getattr(submit, "_tide", False):
        return

    @functools.wraps(submit)
    def wrapper(self, fn, /, *args, **kwargs):
        # InterpreterPoolExecutor (3.14+) sends fn to another interpreter; leave it be.
        if _runs and callable(fn) and not any(c.__name__ == "InterpreterPoolExecutor" for c in type(self).__mro__):
            fn = _in_run(fn, _run_of_thread())
        return submit(self, fn, *args, **kwargs)

    wrapper._tide = True
    futures_thread.ThreadPoolExecutor.submit = wrapper


_patch_executor()


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


class _Discard(io.TextIOBase):
    """What a run that set sys.stdout = None writes to (print() is then a no-op)."""

    def writable(self):
        return True

    def readable(self):
        return True

    def write(self, text):
        return len(text)

    def read(self, size=-1):
        return ""

    def readline(self, size=-1):
        return ""


_UNSET = object()
# sys.stdout and friends as threads outside any run (the host) assigned them
# while the proxies were installed.
_host_streams = {}
_sysdict = sys.__dict__


class _ThreadStream:
    """Installed once as sys.stdout/stderr/stdin. Runs share one interpreter on
    different threads, so each call goes to the stream of the run the calling
    thread belongs to, and to the interpreter's own stream otherwise."""

    def __init__(self, name):
        self._name = name
        self.original = _sysdict.get(name)

    def target(self):
        override = getattr(_current, "streams", None)  # snippet() capturing output
        if override is not None:
            return override
        run = _run_of_thread()
        if run is not None:
            # What the run assigned (redirect_stdout), else its own stream.
            stream = run.streams.get(self._name, _UNSET)
            if stream is _UNSET:
                stream = getattr(run, self._name, None)
                if stream is not None:
                    return stream
            elif stream is not None:
                return stream
            else:
                return _Discard()
        stream = _host_streams.get(self._name, _UNSET)
        if stream is not _UNSET:
            return stream if stream is not None else _Discard()
        return self.original

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
        current = _sysdict.get(name)
        if current is not proxy:
            if not _runs:
                # Nothing is running, so whatever is there is the host's own stream.
                proxy.original = current
                _host_streams.pop(name, None)
            # Straight into the module's dict: print() and input() read it there.
            _sysdict[name] = proxy


def _stream_property(name):
    # Assigning sys.stdout (`sys.stdout = f`, contextlib.redirect_stdout) is
    # per run: print() and input() read sys's dict, which keeps the proxy, and
    # the proxy sends the assigning run's output to what it assigned. Other
    # runs, and the host, keep theirs. Reading sys.stdout gives back what the
    # run assigned, so redirect_stdout can restore it.
    def get(self):
        run = _run_of_thread()
        slot = run.streams if run is not None else _host_streams
        value = slot.get(name, _UNSET)
        return _sysdict.get(name) if value is _UNSET else value

    def set(self, value):
        proxy = _streams[name]
        run = _run_of_thread()
        if run is None and _sysdict.get(name) is not proxy:
            _sysdict[name] = value  # proxies not installed: as usual
            return
        slot = run.streams if run is not None else _host_streams
        if value is proxy:
            slot.pop(name, None)
        else:
            slot[name] = value

    def delete(self):
        raise AttributeError(name)

    return property(get, set, delete)


class _Sys(types.ModuleType):
    """sys's class while tide_runner is loaded (see _stream_property)."""


for _name in ("stdout", "stderr", "stdin"):
    setattr(_Sys, _name, _stream_property(_name))
del _name

try:
    sys.__class__ = _Sys
except TypeError:  # pragma: no cover - an interpreter that refuses: assignments stay global
    pass


# ---- per-run views of process-wide state ----
#
# cwd, os.environ and sys.argv belong to the whole process, but runs overlap
# (a server plus a client script, a notebook, `PORT=9000 python x.py`). The
# first run really sets them; every run that joins it (even in the same folder
# with no variables of its own) gets its own view through these proxies, keyed
# by the run the calling thread belongs to:
#  - sys.argv is a list whose operations go to the calling run's list.
#  - os.environ (and os.environb) look up the run's overlay first (its
#    variables, and the pre-run value of any variable only the first run set).
#  - A joiner gets a virtual cwd: os.getcwd(), os.chdir(), os.fchdir(), open(),
#    the os.* path functions (and so os.path, pathlib, glob, shutil) and
#    sqlite3.connect() resolve relative paths against it, like runcwd.js does
#    for Node workers.
#  - subprocess (and os.system) start a joiner's children in its folder with
#    its environment, unless the call gives cwd= or env=.
# What can't be redirected: C code that opens relative paths itself or calls
# getenv() sees the real cwd and the process environment (the first run's),
# os.posix_spawn() children start in the real cwd, and os.putenv() changes
# the process environment (it is put back when the last run ends).
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


_real = {"getcwd": os.getcwd, "getcwdb": os.getcwdb, "chdir": os.chdir, "stat": os.stat, "open": io.open, "scandir": os.scandir}
_DIR_FDS = ("dir_fd", "src_dir_fd", "dst_dir_fd")


def _lookup(module, name):
    """Unpickles a replacement as whatever the module holds now."""
    return getattr(sys.modules.get(module) or __import__(module), name)


class _Replacement(staticmethod):
    """A replacement for a builtin (open, os.stat, ...). A plain Python function
    stored as a class attribute (`opener = open`) would turn into a bound
    method and get the instance as its first argument; builtins don't, and
    neither does this: its __get__ gives itself back.

    It otherwise passes for the original: name, doc and signature (through
    __wrapped__, so inspect.signature, help() and mock's autospec check calls
    against it), inspect.isroutine(), typing.get_type_hints() ({} like a
    builtin), copy/deepcopy (itself, like a builtin) and pickle (by name, back
    to this replacement). inspect.isbuiltin() is False."""

    def __init__(self, fn, original, where=None):
        # A copy, so the module's own function keeps its name.
        fn = types.FunctionType(fn.__code__, fn.__globals__, fn.__name__, fn.__defaults__, fn.__closure__)
        functools.update_wrapper(fn, original)
        super().__init__(fn)  # copies __name__, __doc__... and sets __wrapped__ = fn
        self._original = original
        self._where = where or (getattr(original, "__module__", None), original.__name__)
        self.__annotations__ = {}
        for attr in ("__text_signature__", "__self__"):
            if hasattr(original, attr):
                setattr(self, attr, getattr(original, attr))

    def __get__(self, obj, cls=None):
        return self

    def __repr__(self):
        return repr(self._original)

    def __copy__(self):
        return self

    def __deepcopy__(self, memo):
        return self

    def __reduce__(self):
        return _lookup, self._where


def _path_function(fn, names, default_cwd):
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
            if default_cwd:
                # No path, or None, means the cwd.
                if not args and kwargs.get("path") is None:
                    kwargs.pop("path", None)
                    args = [cwd]
                elif args and args[0] is None:
                    args[0] = cwd

        return fn(*args, **kwargs)

    return _Replacement(wrapper, fn, ("os", fn.__name__))


class _DirEntry:
    """A DirEntry from scanning a run's virtual cwd: everything comes from the
    real entry (scanned through the absolute path) except `path`, which is
    built from the path the caller passed, as os.scandir() itself does.
    pathlib and glob rely on that: they cut the given path's length off it.

    os.DirEntry can't be subclassed or made, so this reports it as __class__:
    isinstance(entry, os.DirEntry) holds, as shutil (copyfile's named-pipe
    check, copytree) and others expect. type(entry) is still this class. It is
    only used for relative paths scanned in a joined run's virtual cwd."""

    __slots__ = ("_entry", "path")

    __class__ = property(lambda self: os.DirEntry)

    def __init__(self, entry, path):
        self._entry = entry
        self.path = path

    name = property(lambda self: self._entry.name)

    def inode(self):
        return self._entry.inode()

    def is_dir(self, *, follow_symlinks=True):
        return self._entry.is_dir(follow_symlinks=follow_symlinks)

    def is_file(self, *, follow_symlinks=True):
        return self._entry.is_file(follow_symlinks=follow_symlinks)

    def is_symlink(self):
        return self._entry.is_symlink()

    def is_junction(self):
        return self._entry.is_junction()

    def stat(self, *, follow_symlinks=True):
        return self._entry.stat(follow_symlinks=follow_symlinks)

    def __fspath__(self):
        return self.path

    def __repr__(self):
        return f"<DirEntry {self.name!r}>"

    def __class_getitem__(cls, item):
        return os.DirEntry[item]


class _ScandirIterator:
    """os.scandir()'s iterator for a virtual cwd: yields _DirEntry objects."""

    def __init__(self, it, given):
        self._it = it
        self._given = given

    def __iter__(self):
        return self

    def __next__(self):
        entry = next(self._it)
        return _DirEntry(entry, os.path.join(self._given, entry.name))

    def close(self):
        self._it.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._it.close()
        return False


def _scandir(path=None):
    run = _run_of_thread()
    cwd = None if run is None else run.cwd
    if cwd is None or isinstance(path, int):
        return _real["scandir"]() if path is None else _real["scandir"](path)
    given = "." if path is None else os.fspath(path)  # TypeError like scandir
    real = _abs(given, cwd)
    if real is given:  # absolute (or empty, which fails as it would anyway)
        return _real["scandir"](path)
    try:
        it = _real["scandir"](real)
    except OSError as e:
        if e.filename == real:
            e.filename = given if path is None else path  # as given, like scandir
        raise
    return _ScandirIterator(it, given)


def _getcwd():
    cwd = _vcwd()
    return _real["getcwd"]() if cwd is None else cwd


def _getcwdb():
    cwd = _vcwd()
    return _real["getcwdb"]() if cwd is None else os.fsencode(cwd)


def _fd_path(fd):
    """The absolute path of an open directory, or None if it can't be told."""
    candidates = []
    try:
        candidates.append(os.readlink(f"/proc/self/fd/{fd}"))  # Linux, Android
    except OSError:
        pass
    try:
        import fcntl

        if hasattr(fcntl, "F_GETPATH"):  # macOS, iOS
            buf = fcntl.fcntl(fd, fcntl.F_GETPATH, bytes(1025))
            candidates.append(os.fsdecode(buf.split(b"\0", 1)[0]))
    except (ImportError, OSError):
        pass
    st = os.fstat(fd)
    for path in candidates:
        if not path.startswith("/"):
            continue
        try:
            real = _real["stat"](path)
        except OSError:
            continue
        # Same directory, not one renamed or replaced since it was opened.
        if (real.st_dev, real.st_ino) == (st.st_dev, st.st_ino):
            return path
    return None


def _chdir_fd(run, fd):
    st = os.fstat(fd)  # OSError (EBADF) like fchdir
    if not _stat.S_ISDIR(st.st_mode):
        raise NotADirectoryError(errno.ENOTDIR, os.strerror(errno.ENOTDIR))
    path = _fd_path(fd)
    if path is None:
        # Never move the real cwd: it belongs to the run that started first.
        raise OSError(errno.ENOTSUP, "can't change this run's folder to a file descriptor whose path is unknown")
    run.cwd = os.path.normpath(path)


def _chdir(path):
    run = _run_of_thread()
    if run is None or run.cwd is None:
        return _real["chdir"](path)
    if isinstance(path, int):
        return _chdir_fd(run, path)
    target = os.path.normpath(_abs(path, run.cwd))
    if isinstance(target, bytes):
        target = os.fsdecode(target)
    if not _stat.S_ISDIR(_real["stat"](target).st_mode):  # FileNotFoundError like chdir
        raise NotADirectoryError(errno.ENOTDIR, os.strerror(errno.ENOTDIR), path)
    run.cwd = target


def _fchdir(fd):
    run = _run_of_thread()
    if run is None or run.cwd is None:
        return _real["fchdir"](fd)
    if not isinstance(fd, int):
        fd = fd.fileno()  # anything with fileno(), like the real one
    return _chdir_fd(run, fd)


def _system(command):
    """os.system() for a joined run: the shell starts in its folder with its environment."""
    run = _run_of_thread()
    if run is None or (run.cwd is None and run.env is None):
        return _real["system"](command)
    import subprocess

    code = subprocess.call(command, shell=True)
    # A wait status, like os.system: exit code << 8, or the signal number.
    return -code if code < 0 else code << 8


def _open(file, *args, **kwargs):
    cwd = _vcwd()
    if cwd is not None:
        file = _abs(file, cwd)
    return _real["open"](file, *args, **kwargs)


# os functions whose first argument is a path (those missing here are skipped).
_PATH_FUNCTIONS = (
    "access", "chmod", "chown", "lchown", "lchmod", "chflags", "lchflags", "lstat", "stat",
    "mkdir", "mkfifo", "mknod", "open", "pathconf", "readlink", "remove", "unlink", "rmdir",
    "statvfs", "truncate", "utime", "getxattr", "setxattr", "removexattr",
    # 3.15 on Linux/Android (also in supports_dir_fd/fd/follow_symlinks).
    "statx",
    # Only the program's path: posix_spawn can't start the child in another folder.
    "posix_spawn",
)


def _install_cwd_functions():
    one, two = ("path",), ("src", "dst")
    specs = {name: one for name in _PATH_FUNCTIONS}
    specs.update({"rename": two, "replace": two, "link": two, "symlink": (None, "dst")})
    # A symlink's target is stored verbatim: relative to the link, not the cwd.
    defaults = {"listdir": one, "listxattr": one}
    replaced = {}
    for name, names in [*specs.items(), *defaults.items()]:
        fn = getattr(os, name, None)
        if fn is not None:
            replaced[fn] = _path_function(fn, names, name in defaults)
            setattr(os, name, replaced[fn])
    own = [("getcwd", _getcwd), ("getcwdb", _getcwdb), ("chdir", _chdir), ("scandir", _scandir)]
    for name, fn in (("fchdir", _fchdir), ("system", _system)):
        if hasattr(os, name):
            _real[name] = getattr(os, name)
            own.append((name, fn))
    for name, fn in own:
        replaced[_real[name]] = _Replacement(fn, _real[name], ("os", name))
        setattr(os, name, replaced[_real[name]])
    # `os.stat in os.supports_dir_fd` and friends keep answering for the wrappers.
    for group in ("supports_dir_fd", "supports_fd", "supports_follow_symlinks", "supports_effective_ids"):
        supported = getattr(os, group, None)
        if isinstance(supported, set):
            supported.update(w for f, w in replaced.items() if f in supported)
    # glob (and so pathlib's glob) keeps os.scandir and os.lstat in class
    # attributes; if it was imported before us, point those at the wrappers.
    glob_module = sys.modules.get("glob")
    for cls in vars(glob_module).values() if glob_module is not None else ():
        if isinstance(cls, type):
            for attr, value in list(vars(cls).items()):
                if isinstance(value, staticmethod) and value.__func__ in replaced:
                    setattr(cls, attr, staticmethod(replaced[value.__func__]))
    builtins.open = io.open = _Replacement(_open, _real["open"], ("builtins", "open"))


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


def _env_key(environ, key):
    """The encoded key, with putenv()'s errors for one the real environ rejects."""
    k = environ.encodekey(key)  # TypeError for a non-str key
    if isinstance(k, bytes):
        if b"\0" in k:
            raise ValueError("embedded null byte")
        if not k or b"=" in k:
            raise ValueError("illegal environment variable name")
    return k


def _env_value(environ, value):
    v = environ.encodevalue(value)  # TypeError for a non-str value
    if isinstance(v, bytes) and b"\0" in v:
        raise ValueError("embedded null byte")
    return v


class _ThreadEnviron(os._Environ):
    """os.environ's class while tide_runner is loaded: a joined run's overlay
    wins over the process environment for that run's threads. Every method
    that reads or changes the mapping goes through the overlay (os._Environ's
    own clear() calls _clearenv() on 3.15, which would empty the process's)."""

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
        _env_key(self, key), _env_value(self, value)  # same errors as the real one
        overlay[key] = value

    def __delitem__(self, key):
        overlay = _env_overlay()
        if overlay is None:
            return super().__delitem__(key)
        _env_key(self, key)
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

    def __contains__(self, key):
        try:
            self[key]
        except KeyError:
            return False
        return True

    def get(self, key, default=None):
        try:
            return self[key]
        except KeyError:
            return default

    def __repr__(self):
        if _env_overlay() is None:
            return super().__repr__()
        return f"environ({dict(self)!r})"

    def copy(self):
        return dict(self)

    def setdefault(self, key, value):
        if key not in self:
            self[key] = value
        return self[key]

    def pop(self, key, *default):
        if len(default) > 1:
            raise TypeError(f"pop expected at most 2 arguments, got {1 + len(default)}")
        try:
            value = self[key]
        except KeyError:
            if default:
                return default[0]
            raise
        del self[key]
        return value

    def popitem(self):
        for key in self:
            value = self[key]
            del self[key]
            return key, value
        raise KeyError("popitem(): environment is empty")

    def clear(self):
        overlay = _env_overlay()
        if overlay is None:
            return super().clear()
        for key in list(self):
            overlay[key] = None

    def update(self, other=(), /, **kwds):
        if isinstance(other, Mapping):
            for key in other:
                self[key] = other[key]
        elif hasattr(other, "keys"):
            for key in other.keys():
                self[key] = other[key]
        else:
            for key, value in other:
                self[key] = value
        for key, value in kwds.items():
            self[key] = value

    def __ior__(self, other):
        self.update(other)
        return self

    def __or__(self, other):
        if not isinstance(other, Mapping):
            return NotImplemented
        new = dict(self)
        new.update(other)
        return new

    def __ror__(self, other):
        if not isinstance(other, Mapping):
            return NotImplemented
        new = dict(other)
        new.update(self)
        return new


class _ThreadEnvironB(_ThreadEnviron):
    """os.environb's class: the same per-run view, with bytes keys and values."""

    def __getitem__(self, key):
        if _env_overlay() is None:
            return os._Environ.__getitem__(self, key)
        try:
            return os.fsencode(os.environ[os.fsdecode(self.encodekey(key))])
        except KeyError:
            raise KeyError(key) from None

    def __setitem__(self, key, value):
        if _env_overlay() is None:
            return os._Environ.__setitem__(self, key, value)
        _env_key(self, key), _env_value(self, value)
        os.environ[os.fsdecode(key)] = os.fsdecode(value)

    def __delitem__(self, key):
        if _env_overlay() is None:
            return os._Environ.__delitem__(self, key)
        _env_key(self, key)
        try:
            del os.environ[os.fsdecode(key)]
        except KeyError:
            raise KeyError(key) from None

    def __iter__(self):
        if _env_overlay() is None:
            yield from os._Environ.__iter__(self)
            return
        for key in os.environ:
            yield os.fsencode(key)

    def __len__(self):
        if _env_overlay() is None:
            return os._Environ.__len__(self)
        return len(os.environ)

    def __repr__(self):
        if _env_overlay() is None:
            return os._Environ.__repr__(self)
        return f"environ({dict(self)!r})"

    def clear(self):
        if _env_overlay() is None:
            return os._Environ.clear(self)
        os.environ.clear()


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
if isinstance(getattr(os, "environb", None), os._Environ):
    os.environb.__class__ = _ThreadEnvironB


def _c_environ():
    """The process environment as C code sees it ({bytes: bytes}), which
    os.putenv()/unsetenv() change without os.environ knowing."""
    create = getattr(os, "_create_environ", None)  # 3.14+
    if create is not None:
        try:
            return dict(create())
        except Exception:  # noqa: BLE001
            pass
    try:
        libc = ctypes.CDLL(None)
        if sys.platform in ("darwin", "ios"):
            get = ctypes.CFUNCTYPE(ctypes.POINTER(ctypes.POINTER(ctypes.c_char_p)))(("_NSGetEnviron", libc))
            entries = get()[0]
        else:
            entries = ctypes.POINTER(ctypes.c_char_p).in_dll(libc, "environ")
        result = {}
        i = 0
        while entries[i] is not None:
            key, sep, value = entries[i].partition(b"=")
            if sep:
                result.setdefault(key, value)
            i += 1
        return result
    except (OSError, AttributeError, ValueError):
        return dict(os.environ._data) if os.name == "posix" else None


def _restore_environ(saved):
    """Puts the whole process environment back as `saved` (from _c_environ())."""
    if saved is None:
        return
    current = _c_environ() or {}
    for key in current:
        if key not in saved:
            try:
                os.unsetenv(key)
            except (OSError, ValueError):
                pass
    for key, value in saved.items():
        if current.get(key) != value:
            try:
                os.putenv(key, value)
            except (OSError, ValueError):
                pass
    data = os.environ._data
    data.clear()
    data.update(saved)


class _ThreadArgv(list):
    """Installed as sys.argv during runs. Its own items are the first run's
    argv (so C code reading the list directly sees a lone run's argv exactly);
    a joined run's threads read and change their own list instead. A script
    that assigns sys.argv itself replaces it for every run until the next run
    starts or the last one ends.

    Every list operation is defined here, so it goes to the calling run's
    list, including the reflected ones ([x] + sys.argv calls __radd__, as
    Python tries a subclass's number slots before list concatenation) and
    comparisons with another proxy. What can't be redirected is C code that
    reads a list's storage directly instead of calling its methods, such as
    list.__getitem__(sys.argv, 0) or os.execv(path, sys.argv): it sees the
    first run's argv."""

    __hash__ = None

    def __reduce_ex__(self, protocol):
        return list, (list(self),)

    def __radd__(self, other):
        if not isinstance(other, list):
            return NotImplemented
        return list.__add__(_argv_unwrap(other), _argv_target(self))


def _argv_target(proxy):
    run = _run_of_thread()
    own = None if run is None else run.argv
    return proxy if own is None else own


def _argv_unwrap(value):
    # A proxy on the other side of + or == means the calling run's list too.
    return list(_argv_target(value)) if isinstance(value, _ThreadArgv) else value


def _argv_method(name):
    base = getattr(list, name)
    returns_self = name in ("__iadd__", "__imul__")

    def method(self, *args, **kwargs):
        target = _argv_target(self)
        result = base(target, *map(_argv_unwrap, args), **kwargs)
        return self if returns_self else result

    method.__name__ = method.__qualname__ = name
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


# ---- __main__ per run ----
#
# Each run's script is a __main__ module of its own, but sys.modules is one
# dict that the interpreter itself holds (it can't be replaced by a proxy), and
# runpy would put each run's module into sys.modules['__main__'] in turn,
# leaving the wrong one there for overlapping runs (pickle, unittest.main(),
# dataclasses and typing look classes up through it) and none at the end.
# Instead, while runs are active, sys.modules['__main__'] stays the host's
# module with its class set to _MainModule: attribute access from a run's
# threads goes to that run's module, everything else to the host's own.
# runpy's _TempModule is patched so a run's '__main__' never replaces it.


def _main_of_thread():
    run = _run_of_thread()
    return run.main_stack[-1] if run is not None and run.main_stack else None


class _MainModule(types.ModuleType):
    def __getattribute__(self, name):
        target = _main_of_thread()
        if target is None:
            return types.ModuleType.__getattribute__(self, name)
        return getattr(target, name)

    def __setattr__(self, name, value):
        target = _main_of_thread()
        if target is None:
            return types.ModuleType.__setattr__(self, name, value)
        return setattr(target, name, value)

    def __delattr__(self, name):
        target = _main_of_thread()
        if target is None:
            return types.ModuleType.__delattr__(self, name)
        return delattr(target, name)

    def __dir__(self):
        target = _main_of_thread()
        return dir(target) if target is not None else types.ModuleType.__dir__(self)


def _install_main():
    """Called with _lock held as the first run starts; returns what to restore."""
    host = sys.modules.get("__main__")
    if host is None:
        # Nothing to restore but its absence; runs still get a per-run __main__.
        placeholder = _MainModule("__main__")
        sys.modules["__main__"] = placeholder
        return {"module": None, "installed": placeholder, "class": None}
    if type(host) is types.ModuleType:
        object.__setattr__(host, "__class__", _MainModule)
        return {"module": host, "installed": host, "class": types.ModuleType}
    # Some other kind of module object: leave it alone, and stand a proxy in for
    # it that forwards the host's own attribute access to it.
    proxy = _MainProxy("__main__")
    types.ModuleType.__setattr__(proxy, "_tide_host", host)
    sys.modules["__main__"] = proxy
    return {"module": host, "installed": proxy, "class": None}


class _MainProxy(_MainModule):
    def __getattribute__(self, name):
        target = _main_of_thread() or types.ModuleType.__getattribute__(self, "_tide_host")
        return getattr(target, name)

    def __setattr__(self, name, value):
        setattr(_main_of_thread() or types.ModuleType.__getattribute__(self, "_tide_host"), name, value)

    def __delattr__(self, name):
        delattr(_main_of_thread() or types.ModuleType.__getattribute__(self, "_tide_host"), name)

    def __dir__(self):
        return dir(_main_of_thread() or types.ModuleType.__getattribute__(self, "_tide_host"))


def _restore_main(saved):
    """Called with _lock held as the last run ends: the host's __main__ exactly as it was."""
    if saved["class"] is not None:
        object.__setattr__(saved["module"], "__class__", saved["class"])
    if saved["module"] is None:
        sys.modules.pop("__main__", None)
    else:
        sys.modules["__main__"] = saved["module"]


class _RunTempModule(runpy._TempModule):
    """runpy's temporary module, kept out of sys.modules for a run's '__main__'."""

    def __enter__(self):
        run = _run_of_thread()
        if run is None or self.mod_name != "__main__" or _shared is None:
            self._tide_run = None
            return super().__enter__()
        self._tide_run = run
        run.main_stack.append(self.module)
        return self

    def __exit__(self, *args):
        run = self._tide_run
        if run is None:
            return super().__exit__(*args)
        for i in range(len(run.main_stack) - 1, -1, -1):
            if run.main_stack[i] is self.module:
                del run.main_stack[i]
                break
        return None


if hasattr(runpy, "_TempModule"):
    runpy._TempModule = _RunTempModule


# ---- child processes ----


def _patch_subprocess():
    """A joined run's child processes start in its folder with its environment
    (when the call gives no cwd= or env=), as a separate process would. C code
    calling getenv() still sees the process environment (the first run's)."""
    import subprocess

    init = subprocess.Popen.__init__
    if getattr(init, "_tide", False):
        return
    signature = inspect.signature(init)

    @functools.wraps(init)
    def wrapper(self, *args, **kwargs):
        run = _run_of_thread()
        if run is None or (run.cwd is None and run.env is None):
            return init(self, *args, **kwargs)
        try:
            bound = signature.bind(self, *args, **kwargs)
        except TypeError:
            return init(self, *args, **kwargs)  # let Popen report it
        arguments = bound.arguments
        if run.cwd is not None:
            cwd = arguments.get("cwd")
            arguments["cwd"] = run.cwd if cwd is None else _abs(cwd, run.cwd)
        if run.env is not None and arguments.get("env") is None:
            arguments["env"] = dict(os.environ)  # this run's view
        return init(*bound.args, **bound.kwargs)

    wrapper._tide = True
    subprocess.Popen.__init__ = wrapper


_patch_subprocess()


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
    if not isinstance(env, dict):
        raise ValueError("the environment must be a JSON object")
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
        # Always its own folder and environment view, even when they match the
        # real ones: its chdir() and os.environ writes must not reach the others.
        state.cwd = cwd
        # The first run's variables this run doesn't set read as they were before it.
        overlay = {k: v for k, v in _shared["env"].items() if k not in env}
        overlay.update(env)
        state.env = overlay
        state.argv = list(argv)
        if sys.argv is not _argv:
            sys.argv = _argv
        _shared["count"] += 1
        if purge_root:
            _shared["purge"].add(os.path.abspath(purge_root))
        return None
    saved_env = {k: os.environ.get(k) for k in env}
    # The whole environment (with what os.putenv() set behind os.environ's
    # back), put back exactly when the last run ends.
    saved_environ = _c_environ()
    saved_cwd = _real["getcwd"]()
    try:
        for k, v in env.items():
            _env_set(k, v)
        _real["chdir"](cwd)
    except (OSError, ValueError) as e:
        _restore_environ(saved_environ)
        return f"{type(e).__name__}: {e}\n"
    _shared = {
        "scope": scope, "count": 1, "cwd": saved_cwd, "argv": sys.argv, "path": list(sys.path),
        "env": saved_env, "environ": saved_environ, "main": _install_main(),
        "purge": {os.path.abspath(purge_root)} if purge_root else set(),
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
    _restore_environ(saved["environ"])
    try:
        _real["chdir"](saved["cwd"])
    except OSError:
        pass
    _restore_main(saved["main"])
    # A script that replaced sys.stdout and friends in sys's dict doesn't break the next run.
    for name, proxy in _streams.items():
        _sysdict[name] = proxy
    # Modules loaded from the workspace are dropped so the next run sees edits.
    for root in saved["purge"]:
        root += os.sep
        for name, module in list(sys.modules.items()):
            path = getattr(module, "__file__", None) or ""
            if path.startswith(root):
                del sys.modules[name]


def _release_threads(state):
    """Threads the run started (pool workers, daemons) stop belonging to it."""
    state.ended = True
    for thread in threading.enumerate():
        if getattr(thread, "_tide_run", None) is state:
            thread._tide_run = None


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
    out = _Output(emit, run_id, "stdout")
    err = _Output(emit, run_id, "stderr")
    state.stdout, state.stderr, state.stdin = out, err, _Input(state)
    _current.run = state
    try:
        env, args = {}, list(args)
        if args and args[0] == _ENV_ARG:
            try:
                env = json.loads(args[1])
            except (IndexError, ValueError) as e:
                raise ValueError(f"bad {_ENV_ARG} argument: {e}") from None
            args = args[2:]
        if args and args[0] == _DEBUG_ARG:
            try:
                config = json.loads(args[1])
                if not isinstance(config, dict):
                    raise ValueError("expected a JSON object")
            except (IndexError, ValueError) as e:
                raise ValueError(f"bad {_DEBUG_ARG} argument: {e}") from None
            args = args[2:]
            from tide_debugger import Debugger

            state.debugger = Debugger(emit, run_id, purge_root or os.path.dirname(entry), config.get("breakpoints"))
        with _lock:
            refused = _enter_shared(state, cwd, env, [entry, *args], purge_root)
            if refused is None:
                _install_streams()
                _runs[run_id] = state
    except BaseException as e:  # noqa: BLE001 - reported; nothing is left set
        refused = f"{type(e).__name__}: {e}\n"
    if refused is not None:
        _current.run = None
        state.ended = True
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
            _release_threads(state)
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
