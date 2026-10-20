--!strict
type Point = { x: number, y: number }
export type Pair<T> = { a: T, b: T }
local function add(p: Point, q: Point): Point
  return { x = p.x + q.x, y = p.y + q.y }
end
local p: Point = { x = 1, y = 2 }
local r = add(p, { x = 10, y = 20 })
print(r.x, r.y)
local n = 0
for i = 1, 10 do
  if i % 3 == 0 then continue end
  n += i
end
print(n)
local t = { v = 1 }
t.v += 5
print(t.v)
local s = `x={r.x} y={r.y}`
print(s)
print(0b1010 + 1_000)
local lab = if n > 30 then "big" elseif n > 10 then "mid" else "small"
print(lab)
local v = (r.x :: number) + 1
print(v)
for i: number = 3, 1, -1 do io.write(i, " ") end print()
local function gen<T>(x: T): T return x end
print(gen(7))
@native
local function fast(a: number, b: number?): number return a * 2 end
print(fast(4))
local w = 0
while w < 5 do w += 1 if w == 2 then continue end end
print(w)
local k = 0
repeat
  k += 1
  if k < 3 then continue end
  print("k", k)
until k >= 4
for _, item: string in ipairs({ "a", "b", "c" }) do
  if item == "b" then continue end
  io.write(item, ";")
end
print()
print(`pair {`{tostring(1)}` .. "!"} ok`)
