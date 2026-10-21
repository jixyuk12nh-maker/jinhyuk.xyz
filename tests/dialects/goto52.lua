local fns = {}
do
  local i = 1
  ::again::
  local j = i
  fns[#fns + 1] = function() return j end
  i = i + 1
  if i <= 3 then goto again end
end
print(fns[1](), fns[2](), fns[3]())
for a = 1, 3 do
  for b = 1, 3 do
    if a * b == 4 then goto done end
    io.write(a, b, " ")
  end
end
::done:: print("done")
local out = {}
for i = 1, 6 do
  if i == 2 then goto skip end
  do
    local x = i * 10
    if x == 40 then goto stop end
    out[#out + 1] = x
  end
  ::skip::
end
::stop::
print(table.concat(out, ","))
local n = 0
repeat
  n = n + 1
  if n % 2 == 1 then goto cont end
  io.write("even", n, " ")
  ::cont::
until n >= 6
print()
local c = 0
while true do
  c = c + 1
  if c > 3 then break end
  if c == 2 then goto next end
  io.write("c", c, " ")
  ::next::
end
print()
