"""Phase 1 tests: input loading, limits, and error reporting."""

import os
import tempfile
import unittest

from cli import __main__ as cli
from cli.checks import load_source
from cli.limits import MAX_INPUT_BYTES
from frontend.diagnostics import CompileError

class LoadSourceTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, name: str, data: bytes) -> str:
        path = os.path.join(self.dir, name)
        with open(path, "wb") as f:
            f.write(data)
        return path

    def test_reads_valid_utf8(self):
        path = self._write("ok.lua", "local a = 10\nprint(a)\n".encode("utf-8"))
        self.assertEqual(load_source(path), "local a = 10\nprint(a)\n")

    def test_missing_file_reports_location(self):
        path = os.path.join(self.dir, "missing.lua")
        with self.assertRaises(CompileError) as ctx:
            load_source(path)
        self.assertEqual(str(ctx.exception), f"{path}:1:1 — 파일을 찾을 수 없습니다")

    def test_oversized_input_is_rejected(self):
        path = self._write("big.lua", b"a" * (MAX_INPUT_BYTES + 1))
        with self.assertRaises(CompileError) as ctx:
            load_source(path)
        self.assertIn("입력이 너무 큽니다", ctx.exception.cause)

    def test_input_at_limit_is_accepted(self):
        path = self._write("edge.lua", b"a" * MAX_INPUT_BYTES)
        self.assertEqual(len(load_source(path)), MAX_INPUT_BYTES)

    def test_invalid_utf8_reports_line_and_column(self):
        
        path = self._write("bad.lua", b"local a\nab\xff\n")
        with self.assertRaises(CompileError) as ctx:
            load_source(path)
        self.assertEqual(ctx.exception.location.line, 2)
        self.assertEqual(ctx.exception.location.column, 3)
        self.assertIn("UTF-8", ctx.exception.cause)

class CliTests(unittest.TestCase):
    def test_usage_on_wrong_arguments(self):
        self.assertEqual(cli.main([]), 2)
        self.assertEqual(cli.main(["build", "x.lua"]), 2)

    def test_check_returns_zero_for_valid_file(self):
        with tempfile.NamedTemporaryFile(suffix=".lua", delete=False) as f:
            f.write(b"print(1)\n")
            path = f.name
        try:
            self.assertEqual(cli.main(["check", path]), 0)
        finally:
            os.unlink(path)

    def test_check_returns_one_for_missing_file(self):
        self.assertEqual(cli.main(["check", "/nonexistent/none.lua"]), 1)

if __name__ == "__main__":
    unittest.main()
