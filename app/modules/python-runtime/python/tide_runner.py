# Shared by Android (Chaquopy) and iOS (embedded CPython). Phase 0 only needs
# captured output; Phase 5 replaces this with streaming stdout/stderr/stdin.
import io
import sys
import traceback


def run(code):
    buf = io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = buf
    try:
        exec(compile(code, "<tide>", "exec"), {"__name__": "__main__"})
    except BaseException:
        traceback.print_exc()
    finally:
        sys.stdout, sys.stderr = old_out, old_err
    return buf.getvalue()


def version():
    return sys.version
