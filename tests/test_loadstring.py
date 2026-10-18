import io
import unittest

from frontend.diagnostics import LuaRuntimeError
from pipeline import run_source


def run(source):
    out = io.StringIO()
    run_source(source, "load.lua", out)
    return out.getvalue()


class LoadstringTests(unittest.TestCase):
    def test_returns_callable_function(self):
        self.assertEqual(run('local f = loadstring("return 1 + 2")\nprint(f())'), "3\n")

    def test_chunk_runs_with_side_effects_and_globals(self):
        self.assertEqual(run('loadstring("x = 10 print(x * 2)")()\nprint(x)'), "20\n10\n")

    def test_nested_closures_resolve_in_loaded_chunk(self):
        src = ('local g = loadstring("local function mk(n) return function() n = n + 1 return n end end '
               'local c = mk(5) c() return c()")\nprint(g())')
        self.assertEqual(run(src), "7\n")

    def test_syntax_error_returns_nil_and_message(self):
        self.assertEqual(run('local f, msg = loadstring("return +")\nprint(f, type(msg))'), "nil\tstring\n")

    def test_chunk_name_argument_is_accepted(self):
        self.assertEqual(run('print(loadstring("return 5", "=mine")())'), "5\n")

    def test_runtime_error_inside_loaded_chunk_propagates_to_pcall(self):
        self.assertEqual(run('print(pcall(loadstring("error(\'boom\')")))'), "false\tboom\n")

    def test_loaded_chunk_has_access_to_stdlib(self):
        self.assertEqual(run('print(loadstring("return string.upper(\'ab\')")())'), "AB\n")


class LoadTests(unittest.TestCase):
    def test_reader_pieces_are_concatenated(self):
        src = ('local parts = {"return ", "\'hi\'", " .. \'!\'"}\nlocal i = 0\n'
               'print(load(function() i = i + 1 return parts[i] end)())')
        self.assertEqual(run(src), "hi!\n")

    def test_empty_reader_loads_empty_chunk(self):
        self.assertEqual(run("print(type(load(function() return nil end)))"), "function\n")

    def test_non_function_reader_is_error(self):
        with self.assertRaises(LuaRuntimeError):
            run('load("return 1")')

    def test_reader_returning_non_string_is_reported(self):
        self.assertEqual(run("local f, msg = load(function() return 1 end)\nprint(f, type(msg))"),
                         "nil\tstring\n")


if __name__ == "__main__":
    unittest.main()
