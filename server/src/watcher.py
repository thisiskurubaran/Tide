# Runs inside the session container. Polls /workspace for file changes and
# /proc/net for listening ports, printing one JSON object per line.
#
# The first line is a snapshot of the workspace, taken as the poll baseline so
# nothing that changes after it is missed (the server reconciles the app's init
# against it while this keeps running):
#   {"type": "snapshot", "files": {path: [sha1, mode]}, "owned": [path, ...]}
# "owned" lists paths the container keeps to itself: files over MAX_BYTES and
# symlinks (never followed, never overwritten from the app).
# Then "file" (with the permission bits as "mode"), "delete", "skipped" (became
# owned) and "ports" messages as things change.
#
# With --read PATH... it prints the "file" (or "skipped" / "delete") message for
# each path and exits.
import base64, hashlib, json, os, stat, sys, time

ROOT = os.environ.get("TIDE_WATCH_ROOT", "/workspace")  # override for tests only
# Keep in step with SyncSkipDir and SyncRootSkipDir in shared/protocol.ts (a
# server test checks). SKIP_DIRS are skipped at any depth, ROOT_SKIP_DIRS only
# as top-level folders (src/features/coverage/ is source).
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".pylibs", ".venv",
    ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache", ".angular", ".expo",
    ".gradle", ".dart_tool", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox",
    ".nyc_output",
}
ROOT_SKIP_DIRS = {"venv", ".cache", "coverage", "target"}
MAX_BYTES = 2 * 1024 * 1024  # SyncLimits maxBytes in shared/protocol.ts
INTERVAL = 0.5

def signature(full, st):
    # What a change is detected by. tar writes set mtime in whole seconds, so
    # mtime and size alone miss a second same-size write within one second;
    # ctime_ns (bumped by every write, chmod and rename) and the inode don't.
    if stat.S_ISLNK(st.st_mode):
        try:
            return ("link", os.readlink(full))
        except OSError:
            return None
    if stat.S_ISREG(st.st_mode):
        return (st.st_mtime_ns, st.st_ctime_ns, st.st_size, st.st_ino, st.st_mode & 0o7777)
    return None

def owned(meta):
    return meta[0] == "link" or meta[2] > MAX_BYTES

def scan():
    seen = {}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        keep = []
        at_root = dirpath == ROOT
        for d in dirnames:
            if d in SKIP_DIRS or (at_root and d in ROOT_SKIP_DIRS):
                continue
            full = os.path.join(dirpath, d)
            if os.path.islink(full):
                # os.walk doesn't descend into folder symlinks; the container owns them.
                try:
                    meta = signature(full, os.lstat(full))
                except OSError:
                    meta = None
                if meta:
                    seen[os.path.relpath(full, ROOT)] = meta
                continue
            keep.append(d)
        dirnames[:] = keep
        for name in filenames:
            full = os.path.join(dirpath, name)
            try:
                meta = signature(full, os.lstat(full))
            except OSError:
                continue
            if meta:
                seen[os.path.relpath(full, ROOT)] = meta
    return seen

def ports():
    found = set()
    for table in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            with open(table) as f:
                next(f)
                for line in f:
                    cols = line.split()
                    if cols[3] == "0A":  # LISTEN
                        found.add(int(cols[1].rsplit(":", 1)[1], 16))
        except OSError:
            pass
    return sorted(found)

def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def report(path, meta):
    if owned(meta):
        # Too big to sync, or a symlink: the container's copy wins, so the app
        # must stop sending (and init must stop overwriting) its copy.
        emit({"type": "skipped", "path": path})
        return
    try:
        with open(os.path.join(ROOT, path), "rb") as f:
            data = f.read(MAX_BYTES + 1)
    except OSError:
        return
    if len(data) > MAX_BYTES:
        emit({"type": "skipped", "path": path})
        return
    emit({"type": "file", "path": path, "data": base64.b64encode(data).decode(), "mode": meta[4]})

def file_hash(path):
    h = hashlib.sha1()
    with open(os.path.join(ROOT, path), "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()

if len(sys.argv) > 1 and sys.argv[1] == "--read":
    for path in sys.argv[2:]:
        full = os.path.join(ROOT, path)
        try:
            meta = signature(full, os.lstat(full))
        except OSError:
            meta = None
        if meta is None:
            emit({"type": "delete", "path": path})
        else:
            report(path, meta)
    sys.exit(0)

before = scan()
files = {}
for path, meta in list(before.items()):
    if owned(meta):
        continue
    try:
        files[path] = [file_hash(path), meta[4]]
    except OSError:
        del before[path]  # reported as new once it is readable
emit({"type": "snapshot", "files": files, "owned": sorted(p for p, m in before.items() if owned(m))})

last_ports = None
while True:
    time.sleep(INTERVAL)
    now = scan()
    for path, meta in now.items():
        if before.get(path) != meta:
            report(path, meta)
    for path in before.keys() - now.keys():
        emit({"type": "delete", "path": path})
    before = now
    p = ports()
    if p != last_ports:
        emit({"type": "ports", "ports": p})
        last_ports = p
