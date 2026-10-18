import io
import unittest

from frontend.diagnostics import LuaRuntimeError
from pipeline import run_source


def run(source):
    out = io.StringIO()
    run_source(source, "lib51.lua", out)
    return out.getvalue()


class StringFindMatchTests(unittest.TestCase):
    def test_find_plain_and_pattern(self):
        self.assertEqual(run('print(string.find("hello world", "o w"))'), "5\t7\n")
        self.assertEqual(run('print(string.find("hello world", "l+"))'), "3\t4\n")
        self.assertEqual(run('print(string.find("abc", "(b)(c)"))'), "2\t3\tb\tc\n")
        self.assertEqual(run('print(string.find("abc", "x"))'), "nil\n")

    def test_find_init_and_anchor(self):
        self.assertEqual(run('print(string.find("aaa", "a", 2))'), "2\t2\n")
        self.assertEqual(run('print(string.find("abc", "^b"))'), "nil\n")

    def test_match_captures(self):
        self.assertEqual(run('print(string.match("key=value", "(%w+)=(%w+)"))'), "key\tvalue\n")
        self.assertEqual(run('print(string.match("  trim  ", "^%s*(.-)%s*$"))'), "trim\n")
        self.assertEqual(run('print(string.match("abc", "()b()"))'), "2\t3\n")

    def test_balance_and_frontier(self):
        self.assertEqual(run('print(string.match("f(a(b)c)", "%b()"))'), "(a(b)c)\n")
        self.assertEqual(run('print(string.find("THE (quick) fox", "%f[%a]%a+", 5))'), "6\t10\n")

    def test_character_classes(self):
        self.assertEqual(run('print(string.match("a1 B_", "%u"))'), "B\n")
        self.assertEqual(run('print(string.match("x-y", "[%-]"))'), "-\n")
        self.assertEqual(run('print(string.match("abc123", "[^%a]+"))'), "123\n")

    def test_malformed_pattern_is_runtime_error(self):
        with self.assertRaises(LuaRuntimeError):
            run('string.find("x", "[a")')
        with self.assertRaises(LuaRuntimeError):
            run('string.find("x", "%")')


class StringGmatchGsubTests(unittest.TestCase):
    def test_gmatch(self):
        self.assertEqual(run('for w in string.gmatch("one two three", "%a+") do print(w) end'),
                         "one\ntwo\nthree\n")
        self.assertEqual(run('for k, v in string.gmatch("a=1, b=2", "(%w+)=(%w+)") do print(k, v) end'),
                         "a\t1\nb\t2\n")

    def test_gsub_string_replacement(self):
        self.assertEqual(run('print(string.gsub("hello world", "o", "0"))'), "hell0 w0rld\t2\n")
        self.assertEqual(run('print(string.gsub("abc", "%w", "%0%0"))'), "aabbcc\t3\n")
        self.assertEqual(run('print(string.gsub("abc", "%w", "%%"))'), "%%%\t3\n")

    def test_gsub_table_and_function(self):
        self.assertEqual(run('print(string.gsub("$a $b", "%$(%w+)", {a="x"}))'), "x $b\t2\n")
        self.assertEqual(run('print(string.gsub("1 2 3", "%d", function(d) return d * 2 end))'),
                         "2 4 6\t3\n")
        self.assertEqual(run('print(string.gsub("1 2", "%d", function(d) return nil end))'), "1 2\t2\n")

    def test_gsub_limit_and_empty_pattern(self):
        self.assertEqual(run('print(string.gsub("aaa", "a", "b", 2))'), "bba\t2\n")
        self.assertEqual(run('print(string.gsub("abc", "", "-"))'), "-a-b-c-\t4\n")


class StringFormatTests(unittest.TestCase):
    def test_numeric_conversions(self):
        self.assertEqual(run('print(string.format("%d|%5.2f|%x|%X|%o", 42, 3.14159, 255, 255, 8))'),
                         "42| 3.14|ff|FF|10\n")
        self.assertEqual(run('print(string.format("%05d|%+d|%-4d|", 42, 7, 1))'), "00042|+7|1   |\n")
        self.assertEqual(run('print(string.format("%e|%g", 1000, 0.5))'), "1.000000e+03|0.5\n")
        self.assertEqual(run('print(string.format("%c%c", 72, 105))'), "Hi\n")

    def test_string_conversions(self):
        self.assertEqual(run('print(string.format("%s|%s|%s", 1, true, nil))'), "1|true|nil\n")
        self.assertEqual(run('print(string.format("%-5s|%.2s|", "ab", "xyz"))'), "ab   |xy|\n")
        self.assertEqual(run('print(string.format("%%"))'), "%\n")

    def test_quote(self):
        self.assertEqual(run(r'print(string.format("%q", "a\"b\n"))'), '"a\\"b\\\n"\n')
        self.assertEqual(run('print(string.format("%q", 3))'), "3\n")

    def test_errors(self):
        with self.assertRaises(LuaRuntimeError):
            run('string.format("%d")')
        with self.assertRaises(LuaRuntimeError):
            run('string.format("%y", 1)')
        with self.assertRaises(LuaRuntimeError):
            run('string.format("%d", "x")')


class TableLibraryTests(unittest.TestCase):
    def test_sort_default_and_comparator(self):
        self.assertEqual(run("local t = {5, 2, 9, 1}\ntable.sort(t)\nprint(t[1], t[2], t[3], t[4])"),
                         "1\t2\t5\t9\n")
        self.assertEqual(run("local t = {5, 2, 9, 1}\ntable.sort(t, function(a, b) return a > b end)\n"
                             "print(t[1], t[2], t[3], t[4])"), "9\t5\t2\t1\n")

    def test_sort_strings_and_mixed_error(self):
        self.assertEqual(run('local t = {"b", "c", "a"}\ntable.sort(t)\nprint(t[1], t[2], t[3])'),
                         "a\tb\tc\n")
        with self.assertRaises(LuaRuntimeError):
            run('table.sort({1, "x"})')

    def test_getn_and_maxn(self):
        self.assertEqual(run("print(table.getn({1, 2, 3}))"), "3\n")
        self.assertEqual(run("print(table.maxn({[1] = 'a', [10] = 'b', x = 'c'}))"), "10\n")


class MathLibraryTests(unittest.TestCase):
    def test_trig_and_logs(self):
        self.assertEqual(run("print(math.log10(1000), math.pow(2, 10), math.exp(0))"), "3\t1024\t1\n")
        self.assertEqual(run("print(math.sin(0), math.cos(0), math.atan2(0, 1))"), "0\t1\t0\n")
        self.assertEqual(run("print(math.log(0) < 0, math.sqrt(16))"), "true\t4\n")

    def test_modf_frexp_ldexp(self):
        self.assertEqual(run("print(math.modf(3.5))"), "3\t0.5\n")
        self.assertEqual(run("print(math.frexp(8))"), "0.5\t4\n")
        self.assertEqual(run("print(math.ldexp(0.5, 4))"), "8\n")

    def test_mod_alias_and_deg_rad(self):
        self.assertEqual(run("print(math.mod(7, 3))"), "1\n")
        self.assertEqual(run("print(math.deg(math.pi))"), "180\n")

    def test_random_ranges(self):
        self.assertEqual(run("math.randomseed(7)\nlocal x = math.random(3, 3)\nprint(x)"), "3\n")
        out = run("math.randomseed(1)\nfor i = 1, 50 do local r = math.random(5) assert(r >= 1 and r <= 5) end\nprint(\"ok\")")
        self.assertEqual(out, "ok\n")
        value = float(run("print(math.random())").strip())
        self.assertTrue(0.0 <= value < 1.0)


class BaseLibraryTests(unittest.TestCase):
    def test_version_and_collectgarbage(self):
        self.assertEqual(run("print(_VERSION)"), "Lua 5.1\n")
        self.assertEqual(run("print(collectgarbage(\"collect\"))"), "0\n")

    def test_xpcall_handler_receives_message(self):
        self.assertEqual(run('print(xpcall(function() error("boom") end, function(m) return "handled" end))'),
                         "false\thandled\n")
        self.assertEqual(run("print(xpcall(function(a) return a * 2 end, print, 21))"), "true\t42\n")


class NumericStringCoercionTests(unittest.TestCase):
    def test_arithmetic_coerces_numeric_strings(self):
        self.assertEqual(run('print("10" + 5, "3" * "4", 2 ^ "3", -"2")'), "15\t12\t8\t-2\n")
        self.assertEqual(run('print("0x10" + 0)'), "16\n")

    def test_non_numeric_strings_still_fail(self):
        with self.assertRaises(LuaRuntimeError):
            run('print("abc" + 1)')

    def test_comparison_does_not_coerce(self):
        with self.assertRaises(LuaRuntimeError):
            run('print(1 < "2")')


if __name__ == "__main__":
    unittest.main()
