import io
import unittest

from frontend.diagnostics import CompileError
from pipeline import run_source

def run(source):
    out = io.StringIO()
    run_source(source, "features.lua", out)
    return out.getvalue()

class LuaFeatureTests(unittest.TestCase):
    def test_varargs_and_select(self):
        self.assertEqual(run('local function f(...) return select("#", ...), ... end\nprint(f(1, nil, 3))'),
                         "3\t1\tnil\t3\n")

    def test_multiple_returns_and_assignment(self):
        self.assertEqual(run("local function two() return 1, 2 end\nlocal a, b, c = two()\nprint(a, b, c)"),
                         "1\t2\tnil\n")
        self.assertEqual(run("local function two() return 1, 2 end\nprint(two(), two())"), "1\t1\t2\n")
        self.assertEqual(run("local function two() return 1, 2 end\nprint((two()))"), "1\n")
        self.assertEqual(run("local a, b = 1\nprint(a, b)\na, b = b, a\nprint(a, b)"), "1\tnil\nnil\t1\n")

    def test_zero_results(self):
        self.assertEqual(run("local function f() end\nprint(f())\nprint((f()))"), "\nnil\n")

    def test_table_constructor_tail_expansion(self):
        self.assertEqual(run("local function f(...) return {...} end\nlocal t = f(4, 5, 6)\nprint(#t, t[3])"),
                         "3\t6\n")
        self.assertEqual(run("local u = {0, (function() return 7, 8 end)()}\nprint(#u, u[2])"), "3\t7\n")

    def test_generic_for_with_pairs_and_ipairs(self):
        self.assertEqual(run("local t = {10, 20, x = 30}\nlocal n = 0\nfor k, v in pairs(t) do n = n + 1 end\nprint(n)"),
                         "3\n")
        self.assertEqual(run('for i, v in ipairs({"a", "b"}) do print(i, v) end'), "1\ta\n2\tb\n")

    def test_generic_for_closures_capture_each_iteration(self):
        src = ('local fs = {}\n'
               'for i, v in ipairs({"a", "b"}) do fs[i] = function() return v end end\n'
               'print(fs[1](), fs[2]())')
        self.assertEqual(run(src), "a\tb\n")

    def test_method_and_dotted_function_definitions(self):
        self.assertEqual(run("local obj = {n = 1}\nfunction obj:inc(d) self.n = self.n + (d or 1) return self end\n"
                             "obj:inc(4)\nprint(obj.n)"), "5\n")
        self.assertEqual(run("local a = {b = {}}\nfunction a.b.f(x) return x * 2 end\nprint(a.b.f(21))"), "42\n")

    def test_goto_and_labels(self):
        self.assertEqual(run("for i = 1, 5 do\n if i % 2 == 0 then goto continue end\n print(i)\n ::continue::\nend"),
                         "1\n3\n5\n")
        self.assertEqual(run("local i = 0\n::top::\ni = i + 1\nif i < 3 then goto top end\nprint(i)"), "3\n")

    def test_goto_undefined_and_duplicate_labels_are_rejected(self):
        with self.assertRaisesRegex(CompileError, "찾을 수 없습니다"):
            run("goto nowhere")
        with self.assertRaisesRegex(CompileError, "중복"):
            run("::a:: ::a::")

    def test_long_strings_and_escapes(self):
        self.assertEqual(run("print([[a\nb]], [==[x]]y]==])"), "a\nb\tx]]y\n")
        self.assertEqual(run('print("\\65\\x42\\67\\z\n    D")'), "ABCD\n")

    def test_hex_literals(self):
        self.assertEqual(run("print(0xff, 0x10 + 1)"), "255\t17\n")

    def test_vararg_outside_vararg_function_is_rejected(self):
        with self.assertRaisesRegex(CompileError, "가변 인자"):
            run("local function f() return ... end")

    def test_pcall_catches_lua_errors(self):
        self.assertEqual(run('print(pcall(function() error("boom") end))'), "false\tboom\n")
        self.assertEqual(run("print(pcall(function() return 5 end))"), "true\t5\n")

    def test_standard_library_subset(self):
        self.assertEqual(run('local t = {}\ntable.insert(t, "a") table.insert(t, "b")\n'
                             'print(table.concat(t, ","), #t, table.remove(t))'), "a,b\t2\tb\n")
        self.assertEqual(run('print(("x"):rep(3), string.upper("abc"), string.sub("hello", 2, -2))'),
                         "xxx\tABC\tell\n")
        self.assertEqual(run("print(math.floor(3.7), math.max(1, 9, 4), tonumber(\"0x10\"))"), "3\t9\t16\n")
        self.assertEqual(run('print(select(-1, "a", "b"), type(print), type(nil))'), "b\tfunction\tnil\n")

    def test_do_block_scopes_locals(self):
        self.assertEqual(run("local x = 1\ndo local x = 5 print(x) end\nprint(x)\n"), "5\n1\n")

if __name__ == "__main__":
    unittest.main()
