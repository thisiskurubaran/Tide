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

    def start(self, run_id, rel, args=(), cwd="", env=None):
        result = {}
        if env is not None:
            args = ["--tide-env", json.dumps(env), *args]

        def target():
            result["value"] = tide_runner.run(self.emit, run_id, os.path.join(self.root, rel), os.path.join(self.root, cwd), list(args), purge_root=self.root)

        thread = threading.Thread(target=target)
        thread.start()
        return thread, result

    def run(self, run_id, rel, args=(), cwd="", env=None):
        thread, result = self.start(run_id, rel, args, cwd, env)
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
        path = self.h.file("util.py", "VALUE = 2\n")
        # A cached .pyc is checked against the source's mtime (in seconds) and size.
        os.utime(path, (time.time() + 5, time.time() + 5))
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


    def assert_idle(self):
        self.assertIsNone(tide_runner._shared)
        self.assertEqual(tide_runner._runs, {})

    def test_a_joined_run_ending_keeps_the_first_runs_modules_and_argv(self):
        # The server keeps state in a module; a client joins and exits.
        self.h.file("db.py", "items = []\n")
        self.h.file("server.py", "import sys, db\ndb.items.append('s')\ninput()\nimport db as again\nprint(again is db, again.items, sys.argv[1:])\n")
        self.h.file("client.py", "import sys, db\ndb.items.append('c')\nprint(sys.argv[1:], sys.argv[0].endswith('client.py'), len(sys.argv))\n")
        thread, result = self.h.start("s", "server.py", ["--port", "1"])
        time.sleep(0.2)
        self.assertEqual(self.h.run("c", "client.py", ["x"]), (0, False))
        self.assertEqual(self.h.text("c"), "['x'] True 2\n")
        tide_runner.feed("s", "\n")
        thread.join(10)
        self.assertEqual(result["value"], (0, False))
        self.assertEqual(self.h.text("s"), "True ['s', 'c'] ['--port', '1']\n")
        # Once the last run ends the project's modules are dropped and argv is the host's.
        self.assertNotIn("db", sys.modules)
        self.assertIsNot(sys.argv, tide_runner._argv)
        self.assert_idle()

    def test_threads_started_from_script_threads_keep_the_run(self):
        code = (
            "import threading\n"
            "def inner():\n    print('inner')\n"
            "def outer():\n    t = threading.Thread(target=inner)\n    t.start()\n    t.join()\n"
            "t = threading.Thread(target=outer)\nt.start()\nt.join()\n"
        )
        self.h.file("nested.py", code)
        self.assertEqual(self.h.run("r1", "nested.py"), (0, False))
        self.assertEqual(self.h.text("r1"), "inner\n")

    def test_threading_http_server_request_logs_reach_the_run(self):
        code = (
            "import threading, urllib.request\n"
            "from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler\n"
            "class H(BaseHTTPRequestHandler):\n"
            "    def do_GET(self):\n"
            "        print('handled', self.path)\n"
            "        self.send_response(200)\n        self.end_headers()\n        self.wfile.write(b'ok')\n"
            "s = ThreadingHTTPServer(('127.0.0.1', 0), H)\n"
            "threading.Thread(target=s.serve_forever, daemon=True).start()\n"
            "print(urllib.request.urlopen(f'http://127.0.0.1:{s.server_address[1]}/hi').read())\n"
            "s.shutdown()\n"
        )
        self.h.file("web.py", code)
        self.assertEqual(self.h.run("r1", "web.py"), (0, False))
        self.assertIn("handled /hi\n", self.h.text("r1"))
        self.assertIn("b'ok'\n", self.h.text("r1"))
        self.assertIn('"GET /hi HTTP/1.1" 200', self.h.text("r1", "stderr"))

    def test_runs_in_a_subfolder_and_with_other_env_join_a_running_project(self):
        cwd_before = os.getcwd()
        os.environ.pop("TIDE_PORT", None)
        os.environ.pop("TIDE_ONLY_SERVER", None)
        self.h.file("projects/demo/root.txt", "root")
        self.h.file("projects/demo/nb/data.txt", "data")
        self.h.file(
            "projects/demo/server.py",
            "import os\nprint('up', flush=True)\ninput()\n"
            "print(os.path.basename(os.getcwd()), open('root.txt').read(), os.environ['TIDE_PORT'], os.environ['TIDE_ONLY_SERVER'])\n",
        )
        # Like a notebook cell: runs in the notebook's folder.
        self.h.file(
            "projects/demo/nb/cell.py",
            "import os, pathlib, glob, threading\n"
            "print(os.path.basename(os.getcwd()), open('data.txt').read(), pathlib.Path('data.txt').read_text())\n"
            "print(os.path.abspath('x') == os.path.join(os.getcwd(), 'x'), pathlib.Path('data.txt').resolve().parent.name)\n"
            "print(sorted(os.listdir()), glob.glob('*.txt'), os.path.exists('data.txt'), os.path.exists('root.txt'))\n"
            "with open('out.txt', 'w') as f:\n    f.write('cell')\n"
            "os.makedirs('made/deep', exist_ok=True)\n"
            "os.chdir('..')\n"
            "t = threading.Thread(target=lambda: print(os.path.basename(os.getcwd()), open('root.txt').read()))\n"
            "t.start(); t.join()\n"
            "print(os.environ.get('TIDE_PORT'), os.environ.get('TIDE_ONLY_SERVER'), 'TIDE_PORT' in os.environ)\n",
        )
        self.h.file(
            "projects/demo/client.py",
            "import os, threading\nos.environ['TIDE_SET_BY_CLIENT'] = '1'\n"
            "t = threading.Thread(target=lambda: print(os.getenv('TIDE_PORT'), dict(os.environ).get('TIDE_PORT'), os.environ.get('TIDE_SET_BY_CLIENT')))\n"
            "t.start(); t.join()\n",
        )
        project = os.path.join(self.h.root, "projects", "demo")
        thread, result = self.h.start("s", "projects/demo/server.py", cwd="projects/demo", env={"TIDE_PORT": "8000", "TIDE_ONLY_SERVER": "yes"})
        self.h.wait_for("s", "up")
        self.assertEqual(self.h.run("nb", "projects/demo/nb/cell.py", cwd="projects/demo/nb", env={"TIDE_PORT": "8000"}), (0, False), self.h.text("nb", "stderr"))
        self.assertEqual(
            self.h.text("nb"),
            "nb data data\nTrue nb\n['cell.py', 'data.txt'] ['data.txt'] True False\ndemo root\n8000 None True\n",
        )
        with open(os.path.join(project, "nb", "out.txt")) as f:
            self.assertEqual(f.read(), "cell")
        self.assertTrue(os.path.isdir(os.path.join(project, "nb", "made", "deep")))
        # `PORT=9000 python client.py` from the project root.
        self.assertEqual(self.h.run("c", "projects/demo/client.py", cwd="projects/demo", env={"TIDE_PORT": "9000", "TIDE_ONLY_SERVER": "yes"}), (0, False))
        self.assertEqual(self.h.text("c"), "9000 9000 1\n")
        self.assertNotIn("TIDE_SET_BY_CLIENT", os.environ)
        # The server still has its own folder and environment.
        self.assertEqual(os.environ["TIDE_PORT"], "8000")
        tide_runner.feed("s", "\n")
        thread.join(10)
        self.assertEqual(result["value"], (0, False))
        self.assertEqual(self.h.text("s"), "up\ndemo root 8000 yes\n")
        self.assertNotIn("TIDE_PORT", os.environ)
        self.assertNotIn("TIDE_ONLY_SERVER", os.environ)
        self.assertEqual(os.getcwd(), cwd_before)
        self.assert_idle()

    def test_runs_in_another_project_are_refused_with_what_to_do(self):
        self.h.file("projects/one/wait.py", "input()\n")
        self.h.file("projects/two/main.py", "print('should not run')\n")
        thread, result = self.h.start("a", "projects/one/wait.py", cwd="projects/one")
        time.sleep(0.2)
        self.assertEqual(self.h.run("b", "projects/two/main.py", cwd="projects/two"), (1, False))
        err = self.h.text("b", "stderr")
        self.assertIn(os.path.join(self.h.root, "projects", "one"), err)
        self.assertIn("stop it first", err)
        self.assertIn("then run this again", err)
        self.assertEqual(self.h.text("b"), "")
        tide_runner.feed("a", "\n")
        thread.join(10)
        self.assertEqual(result["value"], (0, False))
        self.assert_idle()

    def test_bad_env_is_refused_without_changing_anything(self):
        os.environ.pop("TIDE_GOOD", None)
        self.h.file("main.py", "print('ran')\n")
        self.assertEqual(self.h.run("r1", "main.py", env={"TIDE_GOOD": "1", "TIDE_BAD": "a\x00b"}), (1, False))
        self.assertIn("ValueError", self.h.text("r1", "stderr"))
        self.assertEqual(self.h.text("r1"), "")
        self.assertNotIn("TIDE_GOOD", os.environ)
        self.assert_idle()
        # The next run is not stuck behind it.
        self.assertEqual(self.h.run("r2", "main.py"), (0, False))
        self.assertEqual(self.h.text("r2"), "ran\n")

    def test_kill_does_nothing_once_the_run_is_finishing(self):
        state = tide_runner._Run()
        state.finishing = True
        tide_runner._runs["fin"] = state
        try:
            tide_runner.kill("fin")
        finally:
            del tide_runner._runs["fin"]
        self.assertFalse(state.killed)
        self.assertTrue(state.queue.empty())

    def test_an_interrupt_sent_as_the_run_finishes_does_not_skip_cleanup(self):
        import ctypes

        # A kill() that got past its check just before run() started cleaning up.
        real = tide_runner._drop_interrupt

        def late_kill(state):
            # Raised at the next bytecode, inside run()'s cleanup.
            ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(state.ident), ctypes.py_object(KeyboardInterrupt))
            real(state)

        self.h.file("main.py", "print('ok')\n")
        tide_runner._drop_interrupt = late_kill
        try:
            self.assertEqual(self.h.run("r1", "main.py", env={"TIDE_LATE": "1"}), (0, False))
        finally:
            tide_runner._drop_interrupt = real
        self.assert_idle()
        self.assertNotIn("TIDE_LATE", os.environ)

    def test_kills_at_any_moment_never_leave_shared_state_behind(self):
        cwd_before = os.getcwd()
        self.h.file("short.py", "total = 0\nfor i in range(20000):\n    total += i\nprint(total)\n")
        for i in range(60):
            thread, result = self.h.start(f"k{i}", "short.py", env={"TIDE_K": str(i)})
            time.sleep((i % 12) * 0.0005)
            tide_runner.kill(f"k{i}")
            thread.join(10)
            self.assertFalse(thread.is_alive())
            self.assertIn(result["value"][0], (0, 130))
            self.assert_idle()
        self.assertNotIn("TIDE_K", os.environ)
        self.assertEqual(os.getcwd(), cwd_before)

    def test_a_joined_run_in_a_subfolder_lists_directories_like_a_lone_run(self):
        self.h.file("projects/x/wait.py", "print('up', flush=True)\ninput()\n")
        self.h.file("projects/x/sub/a.py", "")
        self.h.file("projects/x/sub/t/f.txt", "f")
        self.h.file("projects/x/sub/t/deep/d.py", "")
        self.h.file(
            "projects/x/sub/ls.py",
            "import glob, os, shutil\nfrom pathlib import Path\n"
            "def show(label, value):\n    print(label, sorted(map(str, value)))\n"
            "show('rglob', Path().rglob('*.py'))\n"
            "show('glob', Path('.').glob('*'))\n"
            "show('iterdir', Path().iterdir())\n"
            "show('iterdir_t', Path('t').iterdir())\n"
            "show('walk', (str(d) for d, _, _ in Path('t').walk()))\n"
            "with os.scandir('t') as it:\n    show('scandir', ((e.path, e.name, e.is_dir(), e.is_file(), os.fspath(e)) for e in it))\n"
            "show('scandir_dot', (e.path for e in os.scandir()))\n"
            "show('scandir_bytes', (e.path for e in os.scandir(b't')))\n"
            "show('glob.glob', glob.glob('**/*', recursive=True))\n"
            "show('glob_root', glob.glob('*', root_dir='t'))\n"
            "show('os.walk', (d for d, _, _ in os.walk('t')))\n"
            "show('fwalk', (d for d, _, _, _ in os.fwalk('t')))\n"
            "show('listdir', os.listdir('t') + os.listdir() + os.listdir(None))\n"
            "shutil.rmtree('copy', ignore_errors=True)\nshutil.copytree('t', 'copy')\n"
            "show('copytree', glob.glob('copy/**', recursive=True))\nshutil.rmtree('copy')\n"
            "try:\n    os.scandir('missing')\nexcept FileNotFoundError as e:\n    print('missing', e.filename)\n",
        )
        self.assertEqual(self.h.run("lone", "projects/x/sub/ls.py", cwd="projects/x/sub"), (0, False), self.h.text("lone", "stderr"))
        thread, result = self.h.start("w", "projects/x/wait.py", cwd="projects/x")
        self.h.wait_for("w", "up")
        try:
            self.assertEqual(self.h.run("joined", "projects/x/sub/ls.py", cwd="projects/x/sub"), (0, False), self.h.text("joined", "stderr"))
        finally:
            tide_runner.feed("w", "\n")
            thread.join(10)
        self.assertEqual(result["value"], (0, False))
        lone = self.h.text("lone")
        self.assertIn("iterdir_t ['t/deep', 't/f.txt']", lone)
        self.assertIn("rglob ['a.py', 'ls.py', 't/deep/d.py']", lone)
        self.assertEqual(self.h.text("joined"), lone)
        self.assert_idle()

    def test_replaced_functions_stay_unbound_as_class_attributes(self):
        self.h.file("projects/y/wait.py", "print('up', flush=True)\ninput()\n")
        self.h.file("projects/y/sub/n.txt", "n")
        self.h.file(
            "projects/y/sub/cls.py",
            "import os, sys\n"
            "class C:\n    opener = open\n    stat = os.stat\n    listdir = os.listdir\n    scandir = os.scandir\n    getcwd = os.getcwd\n"
            "c = C()\nprint(c.opener('n.txt').read(), c.stat('n.txt').st_size, sorted(c.listdir()), sorted(e.path for e in c.scandir()), os.path.basename(c.getcwd()))\n"
            "sys.argv[1:] = ['bb', 'a', 'ccc']\nsys.argv.sort(key=len)\nprint(sys.argv[:3])\n",
        )
        thread, result = self.h.start("w", "projects/y/wait.py", cwd="projects/y")
        self.h.wait_for("w", "up")
        try:
            self.assertEqual(self.h.run("c", "projects/y/sub/cls.py", cwd="projects/y/sub"), (0, False), self.h.text("c", "stderr"))
        finally:
            tide_runner.feed("w", "\n")
            thread.join(10)
        self.assertEqual(self.h.text("c"), "n 1 ['cls.py', 'n.txt'] ['./cls.py', './n.txt'] sub\n['a', 'bb', 'ccc']\n")
        self.assert_idle()

    # ---- shared helpers for runs that join a waiting one ----

    def with_waiting_run(self, project, body, env=None):
        """Starts projects/<project>/wait.py (which prints its cwd and a few
        things once fed a line), runs body(), then lets it finish."""
        self.h.file(
            f"projects/{project}/wait.py",
            "import os, sys\nprint('up', flush=True)\ninput()\n"
            "print('after', os.path.basename(os.getcwd()), os.environ.get('TIDE_J'), 'HOST_VAR' in os.environ, sys.argv[1:])\n",
        )
        thread, result = self.h.start("w", f"projects/{project}/wait.py", ["w-arg"], cwd=f"projects/{project}", env=env)
        self.h.wait_for("w", "up")
        try:
            body()
        finally:
            tide_runner.feed("w", "\n")
            thread.join(10)
        self.assertEqual(result["value"], (0, False), self.h.text("w", "stderr"))
        return self.h.text("w")

    def joined(self, run_id, project, code, rel="j.py", **kw):
        self.h.file(f"projects/{project}/{rel}", code)
        cwd = f"projects/{project}/{os.path.dirname(rel)}".rstrip("/")
        value = self.h.run(run_id, f"projects/{project}/{rel}", cwd=cwd, **kw)
        self.assertEqual(value, (0, False), self.h.text(run_id, "stderr"))
        return self.h.text(run_id)

    # 1, 13: os.environ in a joined run

    def test_environ_clear_and_friends_in_a_joined_run_only_change_its_view(self):
        os.environ["HOST_VAR"] = "keep"
        os.environ.pop("TIDE_J", None)
        real_clear = os._Environ.__dict__.get("clear")

        def clear_315(self):  # what 3.15's os._Environ.clear does where _clearenv exists
            for key in list(self._data):
                os.unsetenv(key)
            self._data.clear()

        os._Environ.clear = clear_315
        code = (
            "import os\n"
            "c = os.environ.copy(); print(type(c).__name__, 'HOST_VAR' in c)\n"
            "print(os.environ.setdefault('TIDE_J', 'sd'), os.environ.pop('TIDE_J'), os.environ.pop('nope', 'd'))\n"
            "os.environ |= {'TIDE_J': 'ior'}; print((os.environ | {'x': '1'})['TIDE_J'], ({'y': '2'} | os.environ)['y'])\n"
            "k, v = os.environ.popitem(); print(k not in os.environ)\n"
            "os.environ.clear(); print(len(os.environ), dict(os.environ), os.getenv('HOST_VAR'))\n"
            "for bad in ({'a=b': '1'}, {'': '1'}, {'a\\0': '1'}, {'a': 'b\\0'}):\n"
            "    try:\n        os.environ.update(bad)\n    except ValueError as e:\n        print('ValueError', e)\n"
            "for bad in ((1, 'v'), ('k', 2)):\n"
            "    try:\n        os.environ[bad[0]] = bad[1]\n    except TypeError:\n        print('TypeError')\n"
            "os.environb[b'TIDE_J'] = b'bytes'; print(os.environ['TIDE_J'], os.getenvb(b'TIDE_J'))\n"
        )
        try:
            out = self.with_waiting_run("envj", lambda: self.assertEqual(
                self.joined("j", "envj", code),
                "dict True\nsd sd d\nior 2\nTrue\n0 {} None\n"
                "ValueError illegal environment variable name\nValueError illegal environment variable name\n"
                "ValueError embedded null byte\nValueError embedded null byte\nTypeError\nTypeError\nbytes b'bytes'\n",
            ))
        finally:
            if real_clear is None:
                del os._Environ.clear
            else:
                os._Environ.clear = real_clear
        self.assertEqual(out, "up\nafter envj None True ['w-arg']\n")
        self.assertEqual(os.environ.get("HOST_VAR"), "keep")
        self.assertIn("PATH", os.environ)
        self.assertNotIn("TIDE_J", os.environ)
        self.assert_idle()

    # 2: sys.stdout assignment is per run

    def test_redirect_stdout_in_one_run_does_not_capture_another_runs_output(self):
        host_stdout = sys.stdout
        self.h.file("projects/b/loop.py", "import time\nprint('up', flush=True)\nfor i in range(30):\n    print('tick', i)\n    time.sleep(0.01)\n")
        self.h.file(
            "projects/b/cap.py",
            "import io, contextlib, sys, time, threading\nbuf = io.StringIO()\n"
            "with contextlib.redirect_stdout(buf):\n    print('mine')\n"
            "    t = threading.Thread(target=lambda: print('my thread')); t.start(); t.join()\n    time.sleep(0.2)\n"
            "print('captured', buf.getvalue().count('tick'), repr(buf.getvalue()))\n"
            # Left assigned: it only lasts until this run ends.
            "f = io.StringIO()\nsys.stdout = f\nprint('to f')\nsys.stderr.write(f.getvalue())\n",
        )
        thread, _ = self.h.start("l", "projects/b/loop.py", cwd="projects/b")
        self.h.wait_for("l", "up")
        self.assertEqual(self.h.run("cap", "projects/b/cap.py", cwd="projects/b"), (0, False), self.h.text("cap", "stderr"))
        thread.join(5)
        self.assertEqual(self.h.text("cap"), "captured 0 'mine\\nmy thread\\n'\n")
        self.assertEqual(self.h.text("cap", "stderr"), "to f\n")
        self.assertEqual(self.h.text("l").count("tick"), 30)
        self.assertIs(sys.stdout, host_stdout)
        self.assert_idle()

    # 3: chdir(fd) / fchdir in a joined run

    def test_chdir_to_a_descriptor_in_a_joined_run_moves_only_its_folder(self):
        cwd_before = os.getcwd()
        self.h.file("projects/fd/sub/x.txt", "x")
        code = (
            "import os\nfd = os.open('sub', os.O_RDONLY)\nos.chdir(fd)\nprint(os.path.basename(os.getcwd()), os.listdir())\n"
            "os.chdir('..')\nos.fchdir(fd)\nprint(os.path.basename(os.getcwd()))\nos.close(fd)\n"
            "f = os.open('x.txt', os.O_RDONLY)\ntry:\n    os.fchdir(f)\nexcept NotADirectoryError:\n    print('not a dir')\n"
        )
        out = self.with_waiting_run("fd", lambda: self.assertEqual(self.joined("j", "fd", code), "sub ['x.txt']\nsub\nnot a dir\n"))
        self.assertEqual(out, "up\nafter fd None False ['w-arg']\n")
        self.assertEqual(os.getcwd(), cwd_before)

    def test_chdir_to_a_descriptor_whose_path_is_unknown_is_refused(self):
        cwd_before = os.getcwd()
        real = tide_runner._fd_path
        tide_runner._fd_path = lambda fd: None
        try:
            code = "import os\nfd = os.open('.', os.O_RDONLY)\ntry:\n    os.fchdir(fd)\nexcept OSError as e:\n    print(type(e).__name__, os.path.basename(os.getcwd()))\n"
            out = self.with_waiting_run("fd2", lambda: self.assertEqual(self.joined("j", "fd2", code, rel="sub/j.py"), "OSError sub\n"))
        finally:
            tide_runner._fd_path = real
        self.assertEqual(out, "up\nafter fd2 None False ['w-arg']\n")
        self.assertEqual(os.getcwd(), cwd_before)

    # 4: the whole environment comes back

    def test_a_lone_runs_environment_changes_are_all_undone(self):
        os.environ["TIDE_DEL"] = "was"
        os.environ["TIDE_UNSET"] = "was"
        os.environ.pop("TIDE_NEW", None)
        before = tide_runner._c_environ()
        self.h.file(
            "envall.py",
            "import os\nos.environ['TIDE_NEW'] = '1'\ndel os.environ['TIDE_DEL']\n"
            "os.putenv('TIDE_PUT', 'p')\nos.unsetenv('TIDE_UNSET')\nos.environ['PATH'] = '/nowhere'\n",
        )
        self.assertEqual(self.h.run("e", "envall.py"), (0, False), self.h.text("e", "stderr"))
        self.assertEqual(tide_runner._c_environ(), before)
        self.assertEqual(os.environ["TIDE_DEL"], "was")
        self.assertNotIn("TIDE_NEW", os.environ)
        self.assertEqual(dict(os.environ._data), before)
        self.assert_idle()

    # 5: replacements pass for the builtins they replace

    def test_replaced_functions_behave_like_the_builtins(self):
        import copy
        import inspect
        import pickle
        import pydoc
        import typing
        from unittest import mock

        for fn in (open, os.stat, os.listdir, os.getcwd, os.scandir, os.chdir):
            self.assertTrue(inspect.isroutine(fn), fn)
            self.assertIs(copy.copy(fn), fn)
            self.assertIs(copy.deepcopy([fn])[0], fn)
            self.assertIs(pickle.loads(pickle.dumps(fn)), fn)
            self.assertEqual(typing.get_type_hints(fn), {})
        self.assertEqual(str(inspect.signature(os.stat)), "(path, *, dir_fd=None, follow_symlinks=True)")
        self.assertTrue(str(inspect.signature(open)).startswith("(file, mode='r'"))
        self.assertIn("open(", pydoc.render_doc(open, renderer=pydoc.plaintext))
        self.assertEqual((open.__name__, os.stat.__name__, repr(os.stat)), ("open", "stat", "<built-in function stat>"))
        with mock.patch("os.listdir", autospec=True) as listdir:
            listdir.return_value = ["x"]
            self.assertEqual(os.listdir("."), ["x"])
            with self.assertRaises(TypeError):
                os.listdir(".", 1, 2, 3)
            listdir.assert_called_with(".")
        spec = mock.create_autospec(open)
        spec("f")
        with self.assertRaises(TypeError):
            spec("f", nope=1)

        class C:
            opener = open
            stat = os.stat

        self.assertIs(C.opener, open)
        self.assertEqual(C().stat(".").st_mode, os.stat(".").st_mode)

    # 6: os.DirEntry

    def test_scandir_entries_in_a_joined_run_are_direntries(self):
        self.h.file("projects/de/sub/t/f.txt", "f")
        code = (
            "import os, shutil\nos.mkfifo('t/pipe')\n"
            "print(sorted((e.name, isinstance(e, os.DirEntry)) for e in os.scandir('t')))\n"
            "for e in os.scandir('t'):\n    if e.name == 'pipe':\n"
            "        try:\n            shutil.copyfile(e, 'out')\n        except shutil.SpecialFileError as err:\n            print(err)\n"
        )
        if not hasattr(os, "mkfifo"):
            self.skipTest("no mkfifo")
        self.with_waiting_run("de", lambda: self.assertEqual(
            self.joined("j", "de", code, rel="sub/j.py"), "[('f.txt', True), ('pipe', True)]\n`t/pipe` is a named pipe\n"
        ))

    # 7: statx

    def test_statx_is_wrapped_where_it_exists(self):
        self.assertIn("statx", tide_runner._PATH_FUNCTIONS)
        if not hasattr(os, "statx"):
            return  # 3.15 on Linux/Android only
        self.assertIsInstance(os.statx, tide_runner._Replacement)
        self.h.file("projects/sx/sub/f.txt", "abc")
        code = "import os\nprint(os.statx('f.txt', os.STATX_SIZE).stx_size)\n"
        self.with_waiting_run("sx", lambda: self.assertEqual(self.joined("j", "sx", code, rel="sub/j.py"), "3\n"))

    # 8: __main__ per run

    def test_overlapping_runs_each_have_their_own_main_module(self):
        host_main = sys.modules["__main__"]
        host_type = type(host_main)
        script = (
            "import pickle, sys, unittest, __main__\n"
            "class P:\n    tag = '{tag}'\n"
            "class T(unittest.TestCase):\n    def test_{tag}(self):\n        pass\n"
            "print('up', flush=True)\ninput()\n"
            "print(pickle.loads(pickle.dumps(P())).tag, __main__.P is P, sys.modules['__main__'].__file__.endswith('{tag}.py'))\n"
            "r = unittest.main(exit=False, argv=['x'], verbosity=0).result\n"
            "print('tests', r.testsRun, [t for t in vars(__main__) if t.startswith('T')])\n"
        )
        self.h.file("projects/mm/a.py", script.format(tag="a"))
        self.h.file("projects/mm/b.py", script.format(tag="b"))
        ta, ra = self.h.start("a", "projects/mm/a.py", cwd="projects/mm")
        self.h.wait_for("a", "up")
        tb, rb = self.h.start("b", "projects/mm/b.py", cwd="projects/mm")
        self.h.wait_for("b", "up")
        tide_runner.feed("a", "\n")
        ta.join(10)
        tide_runner.feed("b", "\n")
        tb.join(10)
        self.assertEqual(ra["value"], (0, False), self.h.text("a", "stderr"))
        self.assertEqual(rb["value"], (0, False), self.h.text("b", "stderr"))
        self.assertEqual(self.h.text("a"), "up\na True True\ntests 1 ['T']\n")
        self.assertEqual(self.h.text("b"), "up\nb True True\ntests 1 ['T']\n")
        self.assertIs(sys.modules["__main__"], host_main)
        self.assertIs(type(host_main), host_type)
        self.assert_idle()

    # 9: a joiner in the same folder, with no env, is still isolated

    def test_a_joiner_in_the_same_folder_with_no_env_is_isolated(self):
        cwd_before = os.getcwd()
        os.environ.pop("TIDE_J", None)
        self.h.file("projects/same/sub/x", "")
        code = "import os\nos.chdir('sub')\nos.environ['TIDE_J'] = 'joiner'\nprint(os.path.basename(os.getcwd()), os.environ['TIDE_J'])\n"
        out = self.with_waiting_run("same", lambda: self.assertEqual(self.joined("j", "same", code), "sub joiner\n"))
        self.assertEqual(out, "up\nafter same None False ['w-arg']\n")
        self.assertEqual(os.getcwd(), cwd_before)
        self.assertNotIn("TIDE_J", os.environ)

    # 10: pooled threads belong to the run that submitted the task

    def test_pool_tasks_belong_to_the_submitting_run_and_threads_are_released(self):
        self.h.file("projects/pool/pools.py", "from concurrent.futures import ThreadPoolExecutor\npool = ThreadPoolExecutor(1)\n")
        code = (
            "import pools, threading\nimport time\n"
            "pools.pool.submit(print, 'task from {tag}').result()\n"
            "t = threading.Timer(0.01, print, ['timer {tag}']); t.start(); t.join()\n"
        )

        def body():
            self.assertEqual(self.joined("a", "pool", code.format(tag="a"), rel="a.py"), "task from a\ntimer a\n")
            workers = [t for t in threading.enumerate() if t.name.startswith("ThreadPoolExecutor")]
            self.assertTrue(workers)
            self.assertTrue(all(getattr(t, "_tide_run", None) is None for t in workers))
            self.assertEqual(self.joined("b", "pool", code.format(tag="b"), rel="b.py"), "task from b\ntimer b\n")

        self.with_waiting_run("pool", body)
        self.assertNotIn("task from b", self.h.text("a"))
        self.assert_idle()

    # 11: child processes of a joined run

    def test_a_joined_runs_child_processes_get_its_folder_and_environment(self):
        os.environ.pop("TIDE_SUB", None)
        code = (
            "import os, subprocess, sys\n"
            "r = subprocess.run([sys.executable, '-c', 'import os; print(os.path.basename(os.getcwd()), os.environ.get(\"TIDE_SUB\"))'], capture_output=True, text=True)\n"
            "print(r.stdout.strip())\n"
            "r = subprocess.run('pwd', shell=True, cwd='..', capture_output=True, text=True)\nprint(os.path.basename(r.stdout.strip()))\n"
            "print(os.system('echo \"$TIDE_SUB\" > out.txt'), open('out.txt').read().strip(), os.system('exit 3'))\n"
        )
        self.with_waiting_run("cp", lambda: self.assertEqual(
            self.joined("j", "cp", code, rel="sub/j.py", env={"TIDE_SUB": "x"}), "sub x\ncp\n0 x 768\n"
        ))
        self.assertTrue(os.path.exists(os.path.join(self.h.root, "projects/cp/sub/out.txt")))

    # 12: argv list operations in a joined run

    def test_list_operations_on_a_joined_runs_argv(self):
        code = (
            "import sys\na = sys.argv\n"
            "print(([0] + a)[1:], (a + a)[2:], a == a, a == list(a), a != a, a < a + ['z'], [*a][1:], (2 * a)[2:], a[1] == 'j1', len(a))\n"
            "print(['x'] + ['y'] == ['x', 'y'], tuple(a)[1:], 'j1' in a, list(reversed(a))[0])\n"
        )
        self.h.file("projects/argv/j.py", code)

        def body():
            self.assertEqual(self.h.run("j", "projects/argv/j.py", ["j1"], cwd="projects/argv"), (0, False), self.h.text("j", "stderr"))

        self.with_waiting_run("argv", body)
        self.assertEqual(
            self.h.text("j"),
            "['%s', 'j1'] ['%s', 'j1'] True True False True ['j1'] ['%s', 'j1'] True 2\nTrue ('j1',) True j1\n"
            % ((os.path.join(self.h.root, "projects/argv/j.py"),) * 3),
        )

    # 14: malformed arguments

    def test_malformed_tide_arguments_are_reported_and_leave_nothing_set(self):
        self.h.file("main.py", "print('ran')\n")
        entry = os.path.join(self.h.root, "main.py")
        for args in (["--tide-env", "{nope"], ["--tide-env"], ["--tide-env", "[1]"], ["--tide-debug", "nope"], ["--tide-debug", "[]"]):
            self.h.output.clear()
            self.assertEqual(tide_runner.run(self.h.emit, "bad", entry, self.h.root, list(args)), (1, False), args)
            self.assertIsNone(getattr(tide_runner._current, "run", None))
            self.assertEqual(self.h.text("bad"), "")
            self.assertIn("Error", self.h.text("bad", "stderr"))
            self.assert_idle()
        self.assertEqual(self.h.run("ok", "main.py"), (0, False))
        self.assertEqual(self.h.text("ok"), "ran\n")


if __name__ == "__main__":
    unittest.main()
