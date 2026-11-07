# Host tests for tide_jedi.py, through tide_runner.snippet like the app calls it.
# Needs jedi and parso next to tide_runner.py (fetched by npm install).
import json
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python"))
import tide_runner  # noqa: E402

try:
    import jedi  # noqa: F401
except ImportError:
    jedi = None

UTIL = '''def add(a: int, b: int) -> int:
    """Adds two numbers."""
    return a + b


class Counter:
    """Counts things."""

    def __init__(self, start=0):
        self.value = start

    def bump(self):
        self.value += 1
'''

MAIN = '''from util import add, Counter

total = add(1, 2)
c = Counter()
c.bump()
print(add(total, 3))
'''


@unittest.skipIf(jedi is None, "jedi isn't fetched (run npm install)")
class JediTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="tide-jedi-")
        self.write("util.py", UTIL)
        self.write("main.py", MAIN)
        self.next = 0

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, rel, content):
        path = os.path.join(self.root, "projects", "p", rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)

    def send(self, params):
        reply = json.loads(tide_runner.snippet("#tide-tool\n" + json.dumps({"method": "jedi", "params": params})))
        if "error" in reply:
            raise RuntimeError(reply["error"])
        return reply["result"]

    def call(self, method, content, offset, path="main.py", **extra):
        self.next += 1
        args = {"root": self.root, "project": "p", "path": path, "content": content, "offset": offset, **extra}
        reply = self.send({"op": "call", "id": f"t{self.next}", "method": method, "args": args, "wait": 200})
        deadline = time.monotonic() + 30
        while not reply["done"]:
            self.assertLess(time.monotonic(), deadline, "timed out")
            reply = self.send({"op": "poll", "id": f"t{self.next}", "wait": 200})
        return reply["value"]

    def test_completes_members_with_signatures(self):
        text = MAIN + "c.bu"
        result = self.call("complete", text, len(text))
        self.assertEqual(result["from"], len(text) - 2)
        self.assertIn({"label": "bump", "type": "method", "detail": "()"}, result["items"])

    def test_completes_names_from_other_files_and_the_stdlib(self):
        text = "import util\nutil.a"
        labels = [i["label"] for i in self.call("complete", text, len(text))["items"]]
        self.assertIn("add", labels)
        text = "import os\nos.path.joi"
        self.assertIn("join", [i["label"] for i in self.call("complete", text, len(text))["items"]])

    def test_completes_packages_from_pylibs(self):
        self.write(".pylibs/fancy/__init__.py", "def sparkle():\n    pass\n")
        text = "import fancy\nfancy.sp"
        self.assertIn("sparkle", [i["label"] for i in self.call("complete", text, len(text))["items"]])

    def test_hover_shows_signature_and_docstring(self):
        result = self.call("hover", MAIN, MAIN.index("add(1"))
        self.assertEqual(result["text"], "def add(a: int, b: int) -> int\n\nAdds two numbers.")
        self.assertEqual((result["from"], result["to"]), (MAIN.index("add(1"), MAIN.index("add(1") + 3))
        self.assertEqual(self.call("hover", MAIN, MAIN.index("total"))["text"], "total: int")
        self.assertIsNone(self.call("hover", MAIN, MAIN.index("from")))

    def test_definition_in_another_file(self):
        self.assertEqual(self.call("definition", MAIN, MAIN.index("add(1")), [
            {"path": "util.py", "line": 1, "column": 5, "preview": "def add(a: int, b: int) -> int:"},
        ])
        # Outside the project (the stdlib) there's nothing to open.
        self.assertEqual(self.call("definition", "import os\nos.getcwd()", 13), [])

    def test_references_across_files(self):
        refs = self.call("references", MAIN, MAIN.index("add(1"))
        self.assertEqual([(r["path"], r["line"]) for r in refs], [("main.py", 1), ("main.py", 3), ("main.py", 6), ("util.py", 1)])

    def test_rename_across_files_with_offsets(self):
        # An emoji before the name: offsets are UTF-16 like the app's.
        text = "s = '🙂'\n" + MAIN
        at = len(text[: text.index("add(1")].encode("utf-16-le")) // 2
        files = self.call("rename", text, at, newName="plus")
        by_path = {f["path"]: f["edits"] for f in files}
        self.assertEqual(set(by_path), {"main.py", "util.py"})

        def apply(src, edits):
            units = src.encode("utf-16-le")
            for e in sorted(edits, key=lambda e: -e["from"]):
                units = units[: e["from"] * 2] + e["insert"].encode("utf-16-le") + units[e["to"] * 2:]
            return units.decode("utf-16-le")

        self.assertEqual(apply(text, by_path["main.py"]), text.replace("add", "plus"))
        self.assertEqual(apply(UTIL, by_path["util.py"]), UTIL.replace("def add", "def plus"))
        with self.assertRaises(RuntimeError):
            self.call("rename", MAIN, MAIN.index("add(1"), newName="not valid")

    def test_rename_in_a_closed_crlf_file(self):
        # util.py isn't open, so jedi reads it from disk; its offsets must count
        # the \r\n the app's copy of the file still has.
        crlf = UTIL.replace("\n", "\r\n") + "print(add(1, 1))\r\n"
        path = os.path.join(self.root, "projects", "p", "util.py")
        with open(path, "w", newline="") as f:
            f.write(crlf)
        main = MAIN.replace("\n", "\r\n")
        files = self.call("rename", main, main.index("add(1"), newName="plus")
        by_path = {f["path"]: f["edits"] for f in files}

        def apply(src, edits):
            for e in sorted(edits, key=lambda e: -e["from"]):
                src = src[: e["from"]] + e["insert"] + src[e["to"]:]
            return src

        with open(path, newline="") as f:
            raw = f.read()
        self.assertEqual(apply(raw, by_path["util.py"]), crlf.replace("add", "plus"))
        self.assertEqual(apply(main, by_path["main.py"]), main.replace("add", "plus"))
        refs = self.call("references", main, main.index("add(1"))
        util_refs = [r for r in refs if r["path"] == "util.py"]
        self.assertEqual([(r["line"], r["column"], r["preview"]) for r in util_refs], [(1, 5, "def add(a: int, b: int) -> int:"), (14, 7, "print(add(1, 1))")])

    def test_cancel_drops_a_job(self):
        self.send({"op": "call", "id": "slow", "method": "references", "args": {
            "root": self.root, "project": "p", "path": "main.py", "content": MAIN, "offset": 0}, "wait": 0})
        self.send({"op": "cancel", "id": "slow"})
        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            self.send({"op": "poll", "id": "slow", "wait": 0})
        # The worker carries on with the next one.
        text = "import util\nutil.a"
        self.assertIn("add", [i["label"] for i in self.call("complete", text, len(text))["items"]])

    def test_cancel_interrupts_a_running_job(self):
        import tide_jedi

        started = []

        def spin(_args):
            started.append(True)
            while True:
                pass

        tide_jedi._METHODS["spin"] = spin
        grace, tide_jedi.GRACE_S = tide_jedi.GRACE_S, 0
        try:
            self.send({"op": "call", "id": "spin", "method": "spin", "args": {}, "wait": 0})
            deadline = time.monotonic() + 5
            while not started and time.monotonic() < deadline:
                time.sleep(0.01)
            self.send({"op": "cancel", "id": "spin"})
            text = "import util\nutil.a"
            self.assertIn("add", [i["label"] for i in self.call("complete", text, len(text))["items"]])
        finally:
            del tide_jedi._METHODS["spin"]
            tide_jedi.GRACE_S = grace


if __name__ == "__main__":
    unittest.main()
