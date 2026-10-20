local x <const> = 10
print(x)
local function mk(tag) return setmetatable({}, { __close = function() print("close " .. tag) end }) end
do
  local a <close> = mk("a")
  local b <close> = mk("b")
  print("body")
end
local function f()
  local c <close> = mk("c")
  return "ret"
end
print(f())
for i = 1, 3 do
  local d <close> = setmetatable({}, { __close = function() print("close d " .. i) end })
  if i == 2 then break end
end
local n = 0
while true do
  local e <close> = setmetatable({}, { __close = function() n = n + 1 end })
  if n >= 0 then break end
end
print("n " .. n)
do local z <close> = nil print("nilok") end
do
  local i = 0
  ::top::
  i = i + 1
  do
    local g <close> = setmetatable({}, { __close = function() print("close g " .. i) end })
    if i < 2 then goto top end
  end
end
local u <const>= 3
print("u " .. u)
