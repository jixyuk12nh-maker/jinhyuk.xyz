local tostring = function() return "SHADOW" end
local v = `val={3}`
print(v)
type Fn = <T>(T) -> T
local idf: Fn = function(x) return x end
print(idf(9))
