// Runs a project's Python tests and reports each one on stdout as a line
// starting with MARK and then JSON, so test output can't be mistaken for a
// result. Uses pytest when it's installed (pip install pytest), otherwise
// unittest's discovery. Written to Documents/.tide and run with the project
// as the working directory.
export const MARK = '\u001eTIDE-TEST ';

export const PYTHON_DRIVER = String.raw`
import inspect, json, os, sys, time, traceback

MARK = "\x1eTIDE-TEST "
root = os.getcwd()
sys.path.insert(0, root)
only = sys.argv[1:]


def emit(**event):
    if event.get("message"):
        event["message"] = event["message"].replace(root + os.sep, "")
    sys.__stdout__.write(MARK + json.dumps(event) + "\n")
    sys.__stdout__.flush()


def rel(path):
    try:
        return os.path.relpath(path, root).replace(os.sep, "/")
    except ValueError:
        return path


def run_pytest(pytest):
    class Reporter:
        def pytest_runtest_logreport(self, report):
            if report.when != "call" and not (report.failed or report.skipped):
                return
            if report.when == "teardown" and not report.failed:
                return
            path, line, name = report.location
            status = "pass" if report.passed else "skip" if report.skipped else "fail"
            message = None
            if report.failed:
                message = report.longreprtext
            elif report.skipped and isinstance(report.longrepr, tuple):
                message = str(report.longrepr[2])
            emit(event="result", file=path.replace(os.sep, "/"), name=name.replace("::", " › "), status=status,
                 ms=round(report.duration * 1000, 1), line=(line or 0) + 1, message=message)

        def pytest_collectreport(self, report):
            if report.failed:
                emit(event="result", file=rel(str(report.fspath)), name="(collecting)", status="fail", ms=0, line=None,
                     message=report.longreprtext)

    args = ["-q", "-p", "no:cacheprovider", "-p", "no:faulthandler", "--continue-on-collection-errors", "--rootdir", root, *only]
    code = pytest.main(args, plugins=[Reporter()])
    emit(event="done", runner="pytest", code=int(code))


def run_unittest():
    import unittest

    class Result(unittest.TestResult):
        def startTest(self, test):
            self._start = time.perf_counter()
            super().startTest(test)

        def report(self, test, status, message=None):
            if status == "fail":
                self.failed = True
            file, line, name = None, None, test.id()
            if type(test).__name__ == "_FailedTest":
                # A module that failed to import: point at the module itself.
                module = test._testMethodName
                guess = module.replace(".", "/") + ".py"
                file = guess if os.path.exists(os.path.join(root, guess)) else None
                emit(event="result", file=file, name="(importing)", status="fail", ms=0, line=None,
                     message=str(getattr(test, "_exception", message)))
                self.failed = True
                return
            method = getattr(test, getattr(test, "_testMethodName", ""), None)
            try:
                file = rel(inspect.getsourcefile(type(test)))
                if method is not None:
                    line = inspect.getsourcelines(method)[1]
                name = f"{type(test).__name__} › {test._testMethodName}"
            except (TypeError, OSError, AttributeError):
                pass
            ms = round((time.perf_counter() - getattr(self, "_start", time.perf_counter())) * 1000, 1)
            emit(event="result", file=file, name=name, status=status, ms=ms, line=line, message=message)

        def addSuccess(self, test):
            self.report(test, "pass")

        def addFailure(self, test, err):
            self.report(test, "fail", self._exc_info_to_string(err, test))

        def addError(self, test, err):
            self.report(test, "fail", self._exc_info_to_string(err, test))

        def addSkip(self, test, reason):
            self.report(test, "skip", reason)

        def addExpectedFailure(self, test, err):
            self.report(test, "pass")

        def addUnexpectedSuccess(self, test):
            self.report(test, "fail", "Expected a failure, but the test passed")

        def addSubTest(self, test, subtest, err):
            if err is not None:
                self.report(test, "fail", self._exc_info_to_string(err, test))

    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    if only:
        for path in only:
            name = os.path.splitext(path)[0].replace("/", ".")
            suite.addTests(loader.loadTestsFromName(name))
    else:
        for pattern in ("test*.py", "*_test.py"):
            suite.addTests(loader.discover(root, pattern=pattern, top_level_dir=root))
    result = Result()
    result.failed = False
    suite.run(result)
    emit(event="done", runner="unittest", code=1 if result.failed else 0)


try:
    import pytest
except ImportError:
    pytest = None

try:
    if pytest is not None:
        run_pytest(pytest)
    else:
        run_unittest()
except SystemExit:
    raise
except BaseException:
    emit(event="crash", message=traceback.format_exc())
`;
