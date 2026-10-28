# Runs inside the session container. Polls /workspace for file changes and
# /proc/net for listening ports, printing one JSON object per line.
import base64, json, os, sys, time

ROOT = "/workspace"
SKIP_DIRS = {"node_modules", ".git", "__pycache__", ".pylibs", ".venv", ".cache"}
MAX_BYTES = 2 * 1024 * 1024
INTERVAL = 0.5

def scan():
    seen = {}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            full = os.path.join(dirpath, name)
            try:
                st = os.stat(full)
            except OSError:
                continue
            seen[os.path.relpath(full, ROOT)] = (st.st_mtime_ns, st.st_size)
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

before = scan()
last_ports = None
while True:
    time.sleep(INTERVAL)
    now = scan()
    for path, meta in now.items():
        if before.get(path) == meta:
            continue
        if meta[1] > MAX_BYTES:
            continue
        try:
            with open(os.path.join(ROOT, path), "rb") as f:
                data = base64.b64encode(f.read()).decode()
        except OSError:
            continue
        emit({"type": "file", "path": path, "data": data})
    for path in before.keys() - now.keys():
        emit({"type": "delete", "path": path})
    before = now
    p = ports()
    if p != last_ports:
        emit({"type": "ports", "ports": p})
        last_ports = p
