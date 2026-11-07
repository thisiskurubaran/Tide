# Host tests for tide_runner.py: `python3 -m unittest discover -s tests`.
import json
import os
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
import tide_runner  # noqa: E402


class Harness:
    def __init__(self):
        self.root = tempfile.mkdtemp(prefix="tide-py-")
        self.output = []
        self.lock = threading.Lock()

    def file(self, rel, content):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        return path

    def emit(self, run_id, kind, text):
        with self.lock:
            self.output.append((run_id, kind, text))

    def text(self, run_id, kind="stdout"):
        with self.lock:
            return "".join(t for i, k, t in self.output if i == run_id and k == kind)

    def start(self, run_id, rel, args=()):
        result = {}

        def target():
            result["value"] = tide_runner.run(self.emit, run_id, os.path.join(self.root, rel), self.root, list(args), purge_root=self.root)

        thread = threading.Thread(target=target)
        thread.start()
        return thread, result

    def run(self, run_id, rel, args=()):
        thread, result = self.start(run_id, rel, args)
        thread.join(10)
        assert not thread.is_alive(), "run did not finish"
        return result["value"]

    def wait_for(self, run_id, text, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            if text in self.text(run_id):
                return
            time.sleep(0.01)
        raise AssertionError(f"never saw {text!r}; got {self.text(run_id)!r}")


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.h = Harness()

    def test_runs_as_main_with_argv_and_cwd(self):
        self.h.file("app/main.py", "import os, sys\nif __name__ == '__main__':\n    print(sys.argv[1:], os.path.basename(os.getcwd()))\n")
        self.assertEqual(self.h.run("r1", "app/main.py", ["a", "b"]), (0, False))
        self.assertEqual(self.h.text("r1"), f"['a', 'b'] {os.path.basename(self.h.root)}\n")

    def test_env_is_set_for_the_run_and_restored(self):
        os.environ.pop("TIDE_TEST_KEY", None)
        os.environ["TIDE_TEST_KEEP"] = "before"
        self.h.file("env.py", "import os\nprint(os.environ['TIDE_TEST_KEY'], os.environ['TIDE_TEST_KEEP'], __import__('sys').argv[1:])\n")
        env = json.dumps({"TIDE_TEST_KEY": "secret", "TIDE_TEST_KEEP": "during"})
        self.assertEqual(self.h.run("r1", "env.py", ["--tide-env", env, "x"]), (0, False))
        self.assertEqual(self.h.text("r1"), "secret during ['x']\n")
        self.assertNotIn("TIDE_TEST_KEY", os.environ)
        self.assertEqual(os.environ["TIDE_TEST_KEEP"], "before")

    def test_input_reads_fed_lines(self):
        self.h.file("ask.py", "name = input('Name? ')\nprint(f'Hi {name}')\n")
        thread, result = self.h.start("r1", "ask.py")
        self.h.wait_for("r1", "Name? ")
        tide_runner.feed("r1", "Ada\n")
        thread.join(5)
        self.assertEqual(result["value"], (0, False))
        self.assertEqual(self.h.text("r1"), "Name? Hi Ada\n")

    def test_eof_ends_reading(self):
        self.h.file("cat.py", "import sys\nprint(repr(sys.stdin.read()))\n")
        thread, result = self.h.start("r1", "cat.py")
        time.sleep(0.1)
        tide_runner.feed("r1", "one\ntwo")
        tide_runner.eof("r1")
        thread.join(5)
        self.assertEqual(self.h.text("r1"), "'one\\ntwo'\n")

    def test_kill_interrupts_a_busy_loop(self):
        self.h.file("loop.py", "print('spin', flush=True)\nwhile True:\n    pass\n")
        thread, result = self.h.start("r1", "loop.py")
        self.h.wait_for("r1", "spin")
        tide_runner.kill("r1")
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(result["value"], (130, True))
        self.assertIn("KeyboardInterrupt", self.h.text("r1", "stderr"))

    def test_kill_interrupts_a_waiting_input(self):
        self.h.file("ask.py", "input('> ')\n")
        thread, result = self.h.start("r1", "ask.py")
        self.h.wait_for("r1", "> ")
        tide_runner.kill("r1")
        thread.join(5)
        self.assertEqual(result["value"], (130, True))

    def test_traceback_points_at_the_user_file_and_line(self):
        self.h.file("lib/helper.py", "def boom():\n    x = 1\n    raise ValueError('bad value')\n")
        self.h.file("main.py", "import sys, os\nsys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))\nimport helper\nhelper.boom()\n")
        self.assertEqual(self.h.run("r1", "main.py"), (1, False))
        err = self.h.text("r1", "stderr")
        self.assertIn(f'File "{self.h.root}/main.py", line 4, in <module>', err)
        self.assertIn(f'File "{self.h.root}/lib/helper.py", line 3, in boom', err)
        self.assertIn("ValueError: bad value", err)
        self.assertNotIn("runpy", err)
        self.assertNotIn("tide_runner", err)

    def test_paths_inside_a_project_are_shown_from_the_project_root(self):
        self.h.file("projects/demo/src/main.py", "def f():\n    1 / 0\nf()\n")
        self.h.run("r1", "projects/demo/src/main.py")
        err = self.h.text("r1", "stderr")
        self.assertIn('File "/src/main.py", line 3, in <module>', err)
        self.assertIn('File "/src/main.py", line 2, in f', err)
        self.assertNotIn(self.h.root, err)

    def test_syntax_errors_show_the_line(self):
        self.h.file("bad.py", "print('ok')\ndef broken(:\n")
        self.assertEqual(self.h.run("r1", "bad.py")[0], 1)
        err = self.h.text("r1", "stderr")
        self.assertIn("bad.py", err)
        self.assertIn("line 2", err)
        self.assertIn("SyntaxError", err)

    def test_sys_exit_codes(self):
        self.h.file("e0.py", "import sys\nsys.exit()\n")
        self.h.file("e3.py", "raise SystemExit(3)\n")
        self.h.file("emsg.py", "import sys\nsys.exit('fatal: nope')\n")
        self.assertEqual(self.h.run("a", "e0.py"), (0, False))
        self.assertEqual(self.h.run("b", "e3.py"), (3, False))
        self.assertEqual(self.h.run("c", "emsg.py"), (1, False))
        self.assertEqual(self.h.text("c", "stderr"), "fatal: nope\n")

    def test_edits_to_project_modules_are_picked_up(self):
        self.h.file("util.py", "VALUE = 1\n")
        self.h.file("main.py", "import util\nprint(util.VALUE)\n")
        self.h.run("r1", "main.py")
        self.h.file("util.py", "VALUE = 2\n")
        self.h.run("r2", "main.py")
        self.assertEqual(self.h.text("r1"), "1\n")
        self.assertEqual(self.h.text("r2"), "2\n")

    def test_reports_listening_ports(self):
        import json

        self.h.file("server.py", "import socket\ns = socket.socket()\ns.bind(('127.0.0.1', 0))\ns.listen()\nprint(s.getsockname()[1])\ns.close()\n")
        self.assertEqual(self.h.run("r1", "server.py"), (0, False))
        ports = [json.loads(t) for i, k, t in self.h.output if k == "port"]
        self.assertEqual(ports, [{"port": int(self.h.text("r1")), "open": True}])

    def test_reports_ports_from_server_threads(self):
        import json

        code = "import socket, threading\ndef serve():\n    s = socket.socket()\n    s.bind(('127.0.0.1', 0))\n    s.listen()\n    s.close()\nt = threading.Thread(target=serve)\nt.start()\nt.join()\n"
        self.h.file("threaded.py", code)
        self.assertEqual(self.h.run("r2", "threaded.py"), (0, False))
        self.assertEqual(len([t for i, k, t in self.h.output if k == "port" and i == "r2"]), 1)

    def test_restores_interpreter_state(self):
        # sys.stdout and friends are thread-aware proxies, installed once.
        with tide_runner._lock:
            tide_runner._install_streams()
        before = (sys.stdout, sys.stderr, sys.stdin, list(sys.argv), list(sys.path), os.getcwd())
        self.h.file("main.py", "import os, sys\nsys.path.append('/x')\nos.chdir('/')\nsys.stdout = None\n")
        self.h.run("r1", "main.py")
        self.assertEqual((sys.stdout, sys.stderr, sys.stdin, list(sys.argv), list(sys.path), os.getcwd()), before)
        # Outside a run the proxies write to the host's own streams.
        self.assertIs(sys.stdout.target(), tide_runner._streams["stdout"].original)

    def test_overlapping_runs_keep_their_own_output_and_input(self):
        # a waits for input while b runs to the end; neither sees the other's output.
        self.h.file("a.py", "import threading\nprint('a1')\nname = input()\nt = threading.Thread(target=lambda: print('a-thread', name))\nt.start(); t.join()\n")
        self.h.file("b.py", "import sys\nprint('b1')\nprint('b-err', file=sys.stderr)\n")
        thread_a, result_a = self.h.start("a", "a.py")
        self.h.wait_for("a", "a1")
        self.assertEqual(self.h.run("b", "b.py"), (0, False))
        tide_runner.feed("a", "x\n")
        thread_a.join(10)
        self.assertEqual(result_a["value"], (0, False))
        self.assertEqual(self.h.text("a"), "a1\na-thread x\n")
        self.assertEqual(self.h.text("b"), "b1\n")
        self.assertEqual(self.h.text("b", "stderr"), "b-err\n")

    def test_overlapping_runs_in_another_folder_are_refused(self):
        cwd_before = os.getcwd()
        self.h.file("p1/wait.py", "import os\ninput()\nopen('out.txt', 'w').write('1')\nprint(os.path.basename(os.getcwd()))\n")
        self.h.file("p2/main.py", "print('should not run')\n")
        self.h.file("p1/join.py", "import os\nprint('joined', os.path.basename(os.getcwd()))\n")
        result = {}
        p1 = os.path.join(self.h.root, "p1")

        def target():
            result["value"] = tide_runner.run(self.h.emit, "a", os.path.join(p1, "wait.py"), p1, [])

        thread = threading.Thread(target=target)
        thread.start()
        time.sleep(0.2)
        p2 = os.path.join(self.h.root, "p2")
        self.assertEqual(tide_runner.run(self.h.emit, "b", os.path.join(p2, "main.py"), p2, []), (1, False))
        self.assertIn("Another Python program is running", self.h.text("b", "stderr"))
        self.assertEqual(self.h.text("b"), "")
        # A run in the same folder joins it, and leaving doesn't undo the first run's state.
        self.assertEqual(tide_runner.run(self.h.emit, "c", os.path.join(p1, "join.py"), p1, []), (0, False))
        self.assertEqual(self.h.text("c"), "joined p1\n")
        tide_runner.feed("a", "\n")
        thread.join(10)
        self.assertEqual(result["value"], (0, False))
        self.assertEqual(self.h.text("a"), "p1\n")
        self.assertTrue(os.path.exists(os.path.join(p1, "out.txt")))
        self.assertEqual(os.getcwd(), cwd_before)


if __name__ == "__main__":
    unittest.main()
