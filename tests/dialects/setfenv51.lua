x = 1
local function f() return x end
local env = { x = 42 }
setfenv(f, env)
print(f(), x)
local function mk() return function() return x end end
local g = mk()
setfenv(mk, env)
local h = mk()
print(g(), h())
print(getfenv(f) == env)
