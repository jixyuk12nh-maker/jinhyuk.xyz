local t = { print = print, x = 5 }
do
  local _ENV = t
  print(x)
  y = 7
end
print(y, t.y)
local function f() local _ENV = { v = "in" } return v end
print(f())
x2 = 3
print(_ENV.x2, _G.x2)
