# Host tests for the Python debugger (tide_debugger.py), driven like the app does.
import json
import time
import unittest

from test_tide_runner import Harness, tide_runner

PREFIX = "\x00tide-debug:"

SCRIPT = """items = [1, 2, 3]
def total(values):
    s = 0
    for v in values:
        s += v
    return s
t = total(items)
print("total", t)
"""


class DebugHarness(Harness):
    def events(self, run_id):
        with self.lock:
            return [json.loads(t) for i, k, t in self.output if i == run_id and k == "debug"]

    def next_event(self, run_id, kind, after, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            evs = self.events(run_id)
            for n, e in enumerate(evs[after:], after):
                if e["event"] == kind:
                    return n + 1, e
            time.sleep(0.01)
        raise AssertionError(f"no {kind} event; got {self.events(run_id)!r} stderr {self.text(run_id, 'stderr')!r}")

    def send(self, run_id, **cmd):
        tide_runner.feed(run_id, PREFIX + json.dumps(cmd))


class DebuggerTest(unittest.TestCase):
    def setUp(self):
        self.h = DebugHarness()

    def tearDown(self):
        # A failed assertion would leave the run paused and the test process unable to exit.
        tide_runner.kill("d")

    def start(self, script, breakpoints, rid="d"):
        self.h.file("projects/p/main.py", script)
        config = json.dumps({"breakpoints": {"projects/p/main.py": breakpoints}})
        return self.h.start(rid, "projects/p/main.py", ["--tide-debug", config, "arg1"])

    def test_breakpoint_variables_evaluate_and_stepping(self):
        thread, result = self.start(SCRIPT + "import sys\nprint(sys.argv[1:])\n", [5])
        seen, stopped = self.h.next_event("d", "stopped", 0)
        self.assertEqual(stopped["reason"], "breakpoint")
        self.assertEqual([(f["name"], f["file"], f["line"]) for f in stopped["frames"]], [("total", "projects/p/main.py", 5), ("<module>", "projects/p/main.py", 7)])

        local = stopped["frames"][0]["scopes"][0]
        self.h.send("d", cmd="variables", ref=local["ref"], req=1)
        seen, vars_ = self.h.next_event("d", "variables", seen)
        by_name = {v["name"]: v for v in vars_["variables"]}
        self.assertEqual(by_name["s"], {"name": "s", "value": "0", "type": "int", "ref": 0})
        self.assertEqual(by_name["values"]["value"], "[1, 2, 3]")
        self.h.send("d", cmd="variables", ref=by_name["values"]["ref"], req=2)
        seen, items = self.h.next_event("d", "variables", seen)
        self.assertEqual([v["value"] for v in items["variables"]], ["1", "2", "3"])

        self.h.send("d", cmd="evaluate", expression="v * 10", frame=0, req=3)
        seen, ev = self.h.next_event("d", "evaluated", seen)
        self.assertEqual(ev["result"]["value"], "10")
        self.h.send("d", cmd="evaluate", expression="nope", frame=0, req=4)
        seen, ev = self.h.next_event("d", "evaluated", seen)
        self.assertIn("NameError", ev["error"])

        self.h.send("d", cmd="stepOver")
        seen, stopped = self.h.next_event("d", "stopped", seen)
        self.assertEqual(stopped["frames"][0]["line"], 4)
        # Otherwise the rest of the loop stops at line 5 again before total returns.
        self.h.send("d", cmd="setBreakpoints", file="projects/p/main.py", lines=[])
        self.h.send("d", cmd="stepOut")
        seen, stopped = self.h.next_event("d", "stopped", seen)
        self.assertEqual(stopped["frames"][0]["name"], "<module>")
        self.h.send("d", cmd="continue")
        thread.join(5)
        self.assertEqual(result["value"], (0, False))
        self.assertEqual(self.h.text("d"), "total 6\n['arg1']\n")

    def test_step_into_a_function(self):
        thread, result = self.start(SCRIPT, [7])
        seen, stopped = self.h.next_event("d", "stopped", 0)
        self.assertEqual(stopped["frames"][0]["line"], 7)
        self.h.send("d", cmd="stepInto")
        seen, stopped = self.h.next_event("d", "stopped", seen)
        self.assertEqual((stopped["frames"][0]["name"], stopped["frames"][0]["line"]), ("total", 3))
        self.h.send("d", cmd="continue")
        thread.join(5)
        self.assertEqual(result["value"], (0, False))

    def test_runs_freely_without_breakpoints(self):
        thread, result = self.start(SCRIPT, [])
        thread.join(5)
        self.assertEqual(result["value"], (0, False))
        self.assertEqual(self.h.events("d"), [])

    def test_breakpoints_added_while_running_and_pause(self):
        script = "import time\ni = 0\nwhile True:\n    i += 1\n    time.sleep(0.001)\n"
        thread, result = self.start(script, [])
        time.sleep(0.2)
        self.h.send("d", cmd="setBreakpoints", file="projects/p/main.py", lines=[4])
        seen, stopped = self.h.next_event("d", "stopped", 0)
        self.assertEqual((stopped["reason"], stopped["frames"][0]["line"]), ("breakpoint", 4))
        self.h.send("d", cmd="setBreakpoints", file="projects/p/main.py", lines=[])
        self.h.send("d", cmd="continue")
        seen, _ = self.h.next_event("d", "resumed", seen)
        time.sleep(0.1)
        self.h.send("d", cmd="pause")
        seen, stopped = self.h.next_event("d", "stopped", seen)
        self.assertEqual(stopped["reason"], "pause")
        # Stopping while paused ends the run like Ctrl-C.
        tide_runner.kill("d")
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(result["value"], (130, True))

    def test_exceptions_report_a_traceback(self):
        thread, result = self.start("def f():\n    raise ValueError('bad')\nf()\n", [])
        thread.join(5)
        self.assertEqual(result["value"], (1, False))
        self.assertIn("ValueError: bad", self.h.text("d", "stderr"))
        self.assertNotIn("bdb", self.h.text("d", "stderr"))

    def test_input_still_works(self):
        thread, result = self.start("name = input()\nprint('hi', name)\n", [2])
        # Input fed before the run exists is dropped.
        while "d" not in tide_runner._runs:
            time.sleep(0.01)
        tide_runner.feed("d", "ada\n")
        seen, stopped = self.h.next_event("d", "stopped", 0)
        self.assertEqual(stopped["frames"][0]["line"], 2)
        self.h.send("d", cmd="continue")
        thread.join(5)
        self.assertEqual(self.h.text("d"), "hi ada\n")


if __name__ == "__main__":
    unittest.main()
