local g = {print=print, x=1}
local f = function() return x end
setfenv(f, g)
print(f(), getfenv(f) == g)
local G = getfenv()
local function outer()
  local n = {print=print, getfenv=getfenv, setfenv=setfenv, v="inner"}
  setfenv(1, n)
  print(v, getfenv(1) == n)
  setfenv(1, G)
  print(getfenv(1) == G)
end
outer()
local h = {print=print, getfenv=getfenv, setfenv=setfenv, w=5}
local chunkless = function() local q = setfenv(1, h) return q == nil end
print(chunkless(), w)
