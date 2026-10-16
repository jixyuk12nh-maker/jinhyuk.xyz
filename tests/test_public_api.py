import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from bytecode import Chunk, Instr, Op, Proto, UpvalueDesc, decode_chunk, encode_chunk, verify_chunk
from compiler import generate
from frontend import CompileError, parse, tokenize
from vm import LuaTable, VM


class PublicApiTests(unittest.TestCase):
    def test_package_exports_are_available(self):
        self.assertTrue(callable(generate))
        self.assertTrue(callable(parse))
        self.assertTrue(callable(tokenize))
        self.assertTrue(callable(verify_chunk))
        self.assertIsNotNone(VM)
        self.assertIsNotNone(LuaTable)
        self.assertIsNotNone(Chunk)
        self.assertIsNotNone(Proto)
        self.assertIsNotNone(Instr)
        self.assertIsNotNone(UpvalueDesc)
        self.assertIsNotNone(Op)

    def test_cli_rejects_invalid_seed_without_traceback(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.lua"
            output = Path(temp) / "out.lua"
            source.write_text("print(1)", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-m", "cli", "pack", str(source), str(output), "not-a-number"],
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("잘못된 인수", result.stderr)
            self.assertNotIn("Traceback", result.stderr)

    def test_cli_reports_unwritable_output_without_traceback(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.lua"
            source.write_text("print(1)", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, "-m", "cli", "pack", str(source), temp, "1"],
                text=True,
                capture_output=True,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("파일을 읽거나 쓸 수 없습니다", result.stderr)
            self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
