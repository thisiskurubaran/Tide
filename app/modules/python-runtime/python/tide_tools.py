# Format & Lint for Python files, in the app's own interpreter: pyflakes for
# warnings and autopep8 for formatting (both fetched next to this file on
# install). The app calls handle() through tide_runner.snippet with a JSON
# request and gets JSON back; nothing here touches sys.stdout, which may
# belong to a running script.
import ast
import json


def _lint(source, filename):
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as e:
        line = e.lineno or 1
        column = (e.offset or 1)
        return [{"line": line, "column": column, "severity": "error", "message": f"SyntaxError: {e.msg}"}]
    from pyflakes import checker, messages

    errors = (messages.UndefinedName, messages.UndefinedLocal, messages.UndefinedExport, messages.ReturnOutsideFunction,
              messages.YieldOutsideFunction, messages.ContinueOutsideLoop, messages.BreakOutsideLoop,
              messages.DuplicateArgument, messages.TooManyExpressionsInStarredAssignment, messages.TwoStarredExpressions)
    found = checker.Checker(tree, filename=filename)
    out = []
    for m in sorted(found.messages, key=lambda m: (m.lineno, m.col)):
        out.append({
            "line": m.lineno,
            # pyflakes columns are 0-based.
            "column": m.col + 1,
            "severity": "error" if isinstance(m, errors) else "warning",
            "message": m.message % m.message_args,
        })
    return out


def _format(source):
    import autopep8

    return autopep8.fix_code(source, options={"max_line_length": 100})


def handle(raw):
    req = json.loads(raw)
    try:
        method = req.get("method")
        params = req.get("params") or {}
        if method == "lint":
            result = _lint(params["content"], params.get("path", "<file>"))
        elif method == "format":
            result = _format(params["content"])
        else:
            raise ValueError(f"unknown method {method}")
        return json.dumps({"result": result})
    except Exception as e:  # noqa: BLE001 - reported to the app
        return json.dumps({"error": f"{type(e).__name__}: {e}"})
