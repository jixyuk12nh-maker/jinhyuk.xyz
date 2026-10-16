import io
import unittest

from frontend.diagnostics import LuaRuntimeError
from pipeline import run_source

def run(source):
    out = io.StringIO()
    run_source(source, "phase6.lua", out)
    return out.getvalue()

class Phase6CompatibilityTests(unittest.TestCase):
    def test_modulo_uses_floor_semantics(self):
        self.assertEqual(run("print(10 % 3)\nprint(-10 % 3)\nprint(10 % -3)\n"), "1\n2\n-2\n")

    def test_exponentiation(self):
        self.assertEqual(run("print(2 ^ 3)\nprint(2 ^ 3 ^ 2)\n"), "8\n512\n")

    def test_floor_division(self):
        self.assertEqual(run("print(7 // 2)\nprint(-7 // 2)\n"), "3\n-4\n")

    def test_unary_minus_precedence(self):
        self.assertEqual(run("print(-2 ^ 2)\nprint((-2) ^ 2)\n"), "-4\n4\n")

    def test_string_length_is_utf8_bytes(self):
        self.assertEqual(run('print(#"abc")\nprint(#"한")\n'), "3\n3\n")

    def test_table_sequence_length(self):
        self.assertEqual(run('local t = {"a", "b", "c"}\nprint(#t)\n'), "3\n")

    def test_method_call_passes_self(self):
        src = '''local item = {value = 10}
item.add = function(self, n)
    return self.value + n
end
print(item:add(5))
'''
        self.assertEqual(run(src), "15\n")

    def test_arithmetic_rejects_non_numbers(self):
        with self.assertRaisesRegex(LuaRuntimeError, "숫자에만"):
            run("print('x' % 2)\n")

if __name__ == "__main__":
    unittest.main()
