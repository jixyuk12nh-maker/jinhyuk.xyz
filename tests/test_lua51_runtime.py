import io
import os
import tempfile
import unittest

from frontend.diagnostics import LuaRuntimeError
from pipeline import run_source


def run(source, file="runtime.lua"):
    out = io.StringIO()
    run_source(source, file, out)
    return out.getvalue()


class MetatableTests(unittest.TestCase):
    def test_arithmetic_and_tostring_metamethods(self):
        src = ('local V = setmetatable({}, {__add = function(a, b) return "added" end, '
               '__tostring = function() return "VEC" end})\nprint(V + 1, tostring(V))')
        self.assertEqual(run(src), "added\tVEC\n")

    def test_index_chain_with_table_and_function(self):
        self.assertEqual(run('local base = {greet = function(self) return "hello " .. self.name end}\n'
                             'local obj = setmetatable({name = "bob"}, {__index = base})\nprint(obj:greet())'),
                         "hello bob\n")
        self.assertEqual(run('local t = setmetatable({}, {__index = function(_, k) return k .. "!" end})\n'
                             'print(t.hi)'), "hi!\n")

    def test_newindex_function_and_rawset(self):
        src = ('local proxy = setmetatable({}, {__newindex = function(t, k, v) rawset(t, k, v * 10) end})\n'
               'proxy.x = 5\nprint(proxy.x)')
        self.assertEqual(run(src), "50\n")

    def test_call_metamethod(self):
        self.assertEqual(run('local c = setmetatable({}, {__call = function(self, a, b) return a + b end})\n'
                             'print(c(2, 3))'), "5\n")

    def test_comparison_and_concat_and_unm(self):
        src = ('local L = setmetatable({}, {__lt = function() return true end, '
               '__le = function() return false end, __concat = function() return "cat" end, '
               '__unm = function() return "neg" end})\n'
               'print(L < L, L <= L, L .. "x", -L)')
        self.assertEqual(run(src), "true\tfalse\tcat\tneg\n")

    def test_eq_metamethod_only_for_tables(self):
        src = ('local mt = {__eq = function() return true end}\n'
               'local a = setmetatable({}, mt)\nlocal b = setmetatable({}, mt)\n'
               'print(a == b, a ~= b, a == 1)')
        self.assertEqual(run(src), "true\tfalse\tfalse\n")

    def test_protected_metatable(self):
        src = ('local p = setmetatable({}, {__metatable = "locked"})\n'
               'print(getmetatable(p))\nprint(pcall(setmetatable, p, {}))')
        self.assertEqual(run(src), "locked\nfalse\tcannot change a protected metatable\n")

    def test_string_metatable_gives_methods(self):
        self.assertEqual(run('print(getmetatable("").__index == string, ("abc"):upper())'), "true\tABC\n")

    def test_length_ignores_tables_metamethod_in_51(self):
        self.assertEqual(run('print(#setmetatable({1, 2}, {__len = function() return 99 end}))'), "2\n")

    def test_missing_metamethod_is_error(self):
        with self.assertRaises(LuaRuntimeError):
            run("local t = setmetatable({}, {})\nprint(t + 1)")

    def test_error_values_survive_pcall(self):
        self.assertEqual(run("local ok, e = pcall(error, {code = 7})\nprint(ok, e.code)"), "false\t7\n")


class CoroutineTests(unittest.TestCase):
    def test_resume_yield_and_return_values(self):
        src = ('local co = coroutine.create(function(a, b)\n'
               '  local c = coroutine.yield(a + b)\n'
               '  local d, e = coroutine.yield(c * 2)\n'
               '  return d + e\nend)\n'
               'print(coroutine.resume(co, 1, 2))\n'
               'print(coroutine.resume(co, 10))\n'
               'print(coroutine.resume(co, 3, 4))\n'
               'print(coroutine.status(co), coroutine.resume(co))')
        self.assertEqual(run(src), "true\t3\ntrue\t20\ntrue\t7\ndead\tfalse\tcannot resume dead coroutine\n")

    def test_status_transitions(self):
        src = ('local co\nco = coroutine.create(function() print(coroutine.status(co)) coroutine.yield() end)\n'
               'print(coroutine.status(co))\ncoroutine.resume(co)\nprint(coroutine.status(co))')
        self.assertEqual(run(src), "suspended\nrunning\nsuspended\n")

    def test_wrap_generator(self):
        src = ('local gen = coroutine.wrap(function() for i = 1, 3 do coroutine.yield(i) end end)\n'
               'print(gen(), gen(), gen())')
        self.assertEqual(run(src), "1\t2\t3\n")

    def test_error_inside_coroutine(self):
        self.assertEqual(run('print(coroutine.resume(coroutine.create(function() error("oops") end)))'),
                         "false\toops\n")

    def test_yield_outside_coroutine_is_error(self):
        with self.assertRaises(LuaRuntimeError):
            run("coroutine.yield(1)")

    def test_running_in_main_is_nil(self):
        self.assertEqual(run("print(coroutine.running())"), "nil\n")

    def test_nested_coroutines(self):
        src = ('local inner = coroutine.wrap(function() coroutine.yield("in") end)\n'
               'local outer = coroutine.wrap(function() coroutine.yield(inner()) coroutine.yield("out") end)\n'
               'print(outer(), outer())')
        self.assertEqual(run(src), "in\tout\n")

    def test_wrap_propagates_error(self):
        with self.assertRaises(LuaRuntimeError):
            run('coroutine.wrap(function() error("bad") end)()')


class EnvironmentTests(unittest.TestCase):
    def test_setfenv_on_loaded_chunk(self):
        src = ('local env = {print = print, x = "envx"}\nlocal f = loadstring("print(x)")\n'
               'setfenv(f, env)\nf()\nprint(getfenv(f) == env)')
        self.assertEqual(run(src), "envx\ntrue\n")

    def test_getfenv_levels(self):
        self.assertEqual(run("print(getfenv(0) == _G)"), "true\n")
        self.assertEqual(run("local function f() return getfenv(1) == _G end\nprint(f())"), "true\n")

    def test_closures_inherit_environment(self):
        src = ('local env = {print = print, y = "yy"}\nlocal f = loadstring("return function() return y end")\n'
               'setfenv(f, env)\nprint(f()())')
        self.assertEqual(run(src), "yy\n")

    def test_global_access_respects_metatables_on_env(self):
        src = ('setmetatable(_G, {__index = function(_, k) return "dflt_" .. k end})\n'
               'print(undefined_name)\nsetmetatable(_G, nil)')
        self.assertEqual(run(src), "dflt_undefined_name\n")

    def test_setfenv_native_is_error(self):
        with self.assertRaises(LuaRuntimeError):
            run("setfenv(print, {})")


class ModuleTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.old = os.getcwd()
        os.chdir(self.dir)

    def tearDown(self):
        os.chdir(self.old)

    def write(self, name, text):
        with open(os.path.join(self.dir, name), "w", encoding="utf-8") as handle:
            handle.write(text)

    def test_loadfile_and_dofile(self):
        self.write("chunk.lua", "return 1 + 1, 'ok'")
        self.assertEqual(run('print(dofile("chunk.lua"))'), "2\tok\n")
        self.assertEqual(run('local f = loadfile("chunk.lua")\nprint(f())'), "2\tok\n")
        self.assertEqual(run('print(loadfile("missing.lua"))'),
                         "nil\tcannot open missing.lua: No such file or directory\n")

    def test_dofile_syntax_error_raises(self):
        self.write("broken.lua", "return +")
        with self.assertRaises(LuaRuntimeError):
            run('dofile("broken.lua")')

    def test_require_caches_module(self):
        self.write("cached.lua", "counter = (counter or 0) + 1\nreturn {n = counter}")
        self.assertEqual(run('local a = require("cached")\nlocal b = require("cached")\nprint(a == b, a.n)'),
                         "true\t1\n")

    def test_require_dotted_name(self):
        os.makedirs(os.path.join(self.dir, "pkg"))
        self.write(os.path.join("pkg", "sub.lua"), "return 'sub loaded'")
        self.assertEqual(run('print(require("pkg.sub"))'), "sub loaded\n")

    def test_require_missing_module_is_error(self):
        with self.assertRaises(LuaRuntimeError):
            run('require("no_such_module_here")')

    def test_module_with_seeall(self):
        self.write("mymod.lua", "module('mymod', package.seeall)\nvalue = 42\nfunction hi() return 'hi' end")
        self.assertEqual(run('require("mymod")\nprint(mymod.value, mymod.hi(), mymod._NAME)'), "42\thi\tmymod\n")


class IoOsTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.old = os.getcwd()
        os.chdir(self.dir)

    def tearDown(self):
        os.chdir(self.old)

    def test_write_read_lines_roundtrip(self):
        src = ('local f = io.open("data.txt", "w")\nf:write("line1\\n", 42, "\\n")\nf:close()\n'
               'for line in io.lines("data.txt") do print("L", line) end\n'
               'local r = io.open("data.txt")\nprint(r:read("l"), r:read("n"))\nr:close()')
        self.assertEqual(run(src), "L\tline1\nL\t42\nline1\t42\n")

    def test_io_types_and_closed_file(self):
        self.assertEqual(run('local f = io.open("t.txt", "w")\nf:close()\nprint(io.type(f), io.type(io.stdout), io.type(1))'),
                         "closed file\tfile\tnil\n")

    def test_io_open_missing_returns_nil(self):
        self.assertEqual(run('print(io.open("nope_missing.txt"))').split("\t")[0], "nil")

    def test_io_write_default_output(self):
        self.assertEqual(run('io.write("a", 1, "\\n")'), "a1\n")

    def test_os_time_clock_date_getenv(self):
        self.assertEqual(run('print(type(os.time()), type(os.clock()), os.getenv("LUA51_NOT_SET_ANYWHERE"))'),
                         "number\tnumber\tnil\n")
        self.assertEqual(run('print(os.date("!%Y-%m-%d", 0), os.date("!*t", 0).year)'), "1970-01-01\t1970\n")
        self.assertEqual(run('print(os.time{year=2020, month=1, day=1, hour=0} > 0)'), "true\n")

    def test_os_remove_and_rename(self):
        src = ('local f = io.open("a.txt", "w") f:write("x") f:close()\n'
               'print(os.rename("a.txt", "b.txt"), os.remove("b.txt"))\n'
               'print(os.remove("b.txt") == nil)')
        self.assertEqual(run(src), "true\ttrue\ntrue\n")

    def test_os_difftime(self):
        self.assertEqual(run("print(os.difftime(10, 4))"), "6\n")

    def test_io_lines_on_missing_file_is_error(self):
        with self.assertRaises(LuaRuntimeError):
            run('for l in io.lines("missing_file_xyz.txt") do end')


class GotoIdentifierTests(unittest.TestCase):
    def test_goto_is_a_plain_name_when_not_followed_by_a_name(self):
        self.assertEqual(run("local goto = 5\nprint(goto + 1)"), "6\n")
        self.assertEqual(run("local t = {goto = 1}\nprint(t.goto)"), "1\n")


if __name__ == "__main__":
    unittest.main()
