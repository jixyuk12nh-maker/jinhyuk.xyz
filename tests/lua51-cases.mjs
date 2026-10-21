// Lua 5.1 문법/의미 케이스. 각 항목은 [이름, 코드]. 에러 메시지의 위치 정보는 출력하지 않는다.
export const CASES = [
['numbers', `print(0xFF, 0XfF, 1e+3, 1E-2, .5, 5., 3e0, 0x7fffffff, 1e308*10, -0x10)`],
['escapes', `print(("\\a\\b\\f\\v\\\\\\"\\'"):byte(1,-1))
print("\\65\\066\\0067", #"\\0\\0", "x\\
y")`],
['longstr', `local s = [[
first]]
print(s, #s)
print([==[a]]b]=]c]==], [[]])
--[==[ long
comment ]] still ]==] print("after")`],
['crlf_longstr', "print([[a\r\nb]] == 'a\\nb')"],
['precedence', `print(not nil == true, -2^2, 2^-3, 2^3^2, 1 .. 2 .. 3, "a".."b".."c")
print(1 + 2 * 3 - 4 / 2, 2 * 3 % 4, -3 % 5, 7 % -3, 1 < 2 == true)
print(nil or false, false and nil, 1 and 2, nil or "x", 1 or error("no"))
print(#"abc" + 1, -#"ab", not not 0)`],
['concat_coerce', `print("10" + 1, 10 .. 20, "3" * "4", 2^0.5 > 1.41, 1e15 .. "")`],
['method_sugar', `local o = { n = "o" }
function o:m(x) return self.n .. tostring(x) end
function o.f(t) return type(t) end
print(o:m"s", o:m"t", o.f{}, o:m(1))
local function id(...) return ... end
print(id"x", id{1}[1], (id(4)))
local a = { b = { c = { } } }
function a.b.c:d(v) return v * 2 end
print(a.b.c:d(21))`],
['varargs', `local function cnt(...) return select("#", ...) end
local function pass(...) return ... end
print(cnt(), cnt(nil), cnt(nil, nil), cnt(pass(1, nil, nil)))
local function mid(...) return cnt(..., 9), (pass(1, 2)) end
print(mid(5, 6, 7))
local t = { pass(1, 2), pass(3, 4) }
print(#t, t[1], t[2], t[3])
local function first(...) local a, b = ... return a, b end
print(first(8, 9, 10))
print(select(2, "a", "b", "c"), select("#"))`],
['multret_adjust', `local function three() return 1, 2, 3 end
local a, b, c, d = three()
print(a, b, c, d)
local x, y = (three())
print(x, y)
print(three(), three())
local t = {three(), nil}
print(#{three(), three()})
return three()`],
['assign_order', `local t = {1, 2}
local i = 1
i, t[i] = i + 1, 20
print(i, t[1], t[2])
local a, b = 1, 2
a, b = b, a
print(a, b)
local q = {}
q.x, q.y, q.z = 1
print(q.x, q.y, q.z)`],
['loops', `local out = {}
local i = 0
while true do i = i + 1; if i > 3 then break end; out[#out+1] = i end
repeat local z = #out; out[#out+1] = z until z >= 5
for k = 10, 1, -3 do out[#out+1] = k end
for k = 0, 1, 0.25 do out[#out+1] = k end
for k = 5, 1 do out[#out+1] = "never" end
for k = 1, 3 do local k2 = k; k = k * 10; out[#out+1] = k + k2 end
print(table.concat(out, ","))
for n = 1, 3 do for m = 1, 3 do if m == 2 then break end; io.write(n, m, " ") end end
print()`],
['generic_for', `local function iter(s, c) if c < s then return c + 1, c * 2 end end
for a, b in iter, 3, 0 do io.write(a, ":", b, " ") end print()
local t = {10, 20, x = "y"}
local n = 0
for k, v in pairs(t) do n = n + 1 end
for i, v in ipairs(t) do io.write(i, v, ";") end print(n)
for _ in next, {} do print("no") end`],
['closures', `local fs = {}
for i = 1, 3 do fs[i] = function() return i end end
print(fs[1](), fs[2](), fs[3]())
local ws = {}
local j = 0
while j < 3 do j = j + 1; local jj = j; ws[j] = function() jj = jj + 10; return jj end end
print(ws[1](), ws[1](), ws[2]())
local function counter()
  local c = 0
  return function() c = c + 1 return c end, function() return c end
end
local inc, get = counter()
inc() inc()
print(get())
local function outer() local v = 1; local function mid() local function inner() v = v * 3 return v end return inner end return mid() end
local f = outer() f() print(f())`],
['repeat_scope', `local k = 0
repeat local stop = k >= 2; k = k + 1 until stop
print(k)
local n = 0
repeat n = n + 1 local done = n == 4 until done
print(n)`],
['shadow_do', `local x = 1
do local x = 2; print(x) end
print(x)
local function f(x) x = x + 1 return x end
print(f(5), x)`],
['recursion', `local function fact(n) if n <= 1 then return 1 end return n * fact(n - 1) end
print(fact(10))
function g(n) if n == 0 then return "done" end return g(n - 1) end
print(g(50))
local h
h = function(n) return n > 0 and h(n - 1) or "end" end
print(h(20))`],
['tables', `local t = { [1] = "a", "b", ["1"] = "c", x = 1; y = 2, [1.0 + 1] = "d", }
print(t[1], t["1"], t[2], t.x, t.y, #t)
local e = {}
print(next(e), rawlen and "" or "", #{nil, nil, 3} >= 0)
t[1.5] = "f" print(t[1.5], t[3/2])
local big = {} for i = 1, 100 do big[i] = i end print(#big, big[100])
print(({1,2,3})[2], ({n=5}).n)`],
['metatables', `local mt = {}
mt.__index = function(t, k) return "idx:" .. k end
mt.__newindex = function(t, k, v) rawset(t, k, v * 2) end
mt.__add = function(a, b) return "add" end
mt.__eq = function(a, b) return true end
mt.__lt = function(a, b) return true end
mt.__le = function(a, b) return false end
mt.__concat = function(a, b) return "cat" end
mt.__call = function(self, x) return "called " .. tostring(x) end
mt.__unm = function() return "neg" end
mt.__mod = function() return "mod" end
mt.__div = function() return "div" end
mt.__pow = function() return "pow" end
local a = setmetatable({}, mt)
local b = setmetatable({}, mt)
a.v = 4
print(a.missing, a.v, a + 1, 1 + a, a == b, a ~= b, a < b, a <= b, a > b)
print(a .. "x", "x" .. a, a(7), -a, a % 2, a / 2, a ^ 2)
local base = { hello = "base" }
local d = setmetatable({}, { __index = base })
print(d.hello, rawget(d, "hello"))
print(getmetatable("abc").__index == string)`],
['len_meta', `local t = setmetatable({}, { __len = function() return 99 end })
print(#t)`],
['string_lib', `print(("x"):rep(3), ("Hi"):upper(), ("%d-%s"):format(4, "z"))
print(string.format("%5.2f|%-3s|%x|%q", 3.14159, "a", 255, "q\\n"))
print(("hello world"):find("o w"), ("abc"):sub(-2), ("a,b,c"):gsub(",", ";"))
print(string.byte("A"), string.char(72, 105), ("abc"):len(), ("%a"):len())
for w in string.gmatch("one two", "%a+") do io.write(w, ".") end print()`],
['math_lib', `print(math.floor(-2.5), math.ceil(2.1), math.max(1, 5, 3), math.min(-1, 2))
print(7 / 2, 2^10, math.abs(-3), math.fmod(7, 3), math.mod and "mod" or "nomod")
print(tostring(1/0), tostring(-1/0), tostring(0/0) == tostring(0/0))
print(tonumber("0x1A"), tonumber("  12  "), tonumber("z", 36), tonumber("1e2"), tonumber(""))`],
['errors', `print(pcall(function() error("boom", 0) end))
print(type(select(2, pcall(function() error({code = 7}) end))))
print(select(2, pcall(function() error({code = 7}) end)).code)
print(xpcall(function() error("x", 0) end, function(m) return "H:" .. m end))
print(pcall(error))
local ok, e = pcall(function() local t = nil; return t.x end)
print(ok, type(e))
print(pcall(function() return 1 < "2" end))`],
['bool_and_nil', `local t = {}
print(t.x == nil, nil == false, 0 and "zero is true", "" and "empty is true")
print(type(nil), type(print), type(type), type({}), type("s"), type(2))`],
['unicode_bytes', `local s = "héllo 한글"
print(#s, s:sub(1, 1), s:byte(2))`],
['goto_is_ident', `local goto_ = 1
local goto = 5
print(goto)`],
['semicolons', `local a = 1; print(a);
local function nop() return; end
print(nop())`],
['func_defs', `local M = {}
function M.one() return 1 end
function M:two() return self == M end
local function three() return 3 end
print(M.one(), M:two(), three())
print(type(function() end), (function(...) return select("#", ...) end)(1, 2, nil))`],
['nested_vararg_main', `print(select("#", ...), ...)`],
['bitlike_ops', `print(5 % 3, 5.5 % 2, -5.5 % 2, 2^63 > 0, 1e300 * 1e10 == math.huge)`],
['numeric_edge', `print(1/3 == 1/3, 0.1 + 0.2 == 0.3, 100000000000000, 2^53 + 1)
print(3 == 3.0)`],
['deep_expr', `local v = ((((((1 + 2) * 3) - 4) / 5) ^ 2) .. "")
print(v, ((((((((((1)))))))))))`],
['assign_upval_nested', `local a = 1
local function f() local function g() a = a + 1 return a end return g() end
print(f(), f(), a)`],
['multiple_repeat_break', `local r = {}
for i = 1, 3 do repeat if i == 2 then break end r[#r+1] = i until true end
print(table.concat(r, ","))`],
['empty_fn_returns', `local function none() end
print(none(), (none()), select("#", none()))`],
['tostring_numbers', `print(1e15, 1e16, 123456789012, 0.1, -0.0, 1e-5, 2^24, 100 / 3)`],
];
