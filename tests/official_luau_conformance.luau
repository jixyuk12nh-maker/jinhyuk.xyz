-- Executed by the upstream official Luau CLI in CI; not by the custom VM.
type Pair = { key: string, value: number }
local function collect(...: number): (number, string)
    local values = { ... }
    local total = 0
    for _, value in values do
        total += value
    end
    return total, `count={#values}`
end
local total, label = collect(1, 2, 3)
assert(total == 6 and label == "count=3")
local sign = if total > 0 then "positive" else "nonpositive"
assert(sign == "positive")
local map: { [string]: number } = { alpha = 1, beta = 2 }
local sum = 0
for key, value in pairs(map) do
    if key ~= "" then
        sum += value
    end
end
assert(sum == 3)
local function returnsMany(): (number, nil, string)
    return 9, nil, "done"
end
local a, b, c = returnsMany()
assert(a == 9 and b == nil and c == "done")
local result = 0
for i = 1, 3 do
    if i == 2 then continue end
    result += i
end
assert(result == 4)
print("official Luau CLI conformance smoke passed")
