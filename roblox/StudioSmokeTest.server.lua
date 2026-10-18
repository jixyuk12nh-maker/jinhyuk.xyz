



local ServerStorage = game:GetService("ServerStorage")
local payload = ServerStorage:FindFirstChild("TMGeneratedPayload")
assert(payload and payload:IsA("ModuleScript"), "Missing ServerStorage.TMGeneratedPayload ModuleScript")

local runner = require(payload)
assert(type(runner) == "function", "Generated payload must return a function")

local ok, result = pcall(runner)
assert(ok, "Generated VM payload errored in Roblox Studio: " .. tostring(result))
print("[TM Studio Smoke Test] generated payload executed successfully", result)



local function multiReturn() return 7, nil, "tail" end
local a, b, c = multiReturn()
assert(a == 7 and b == nil and c == "tail", "multiple return semantics mismatch")
local t = { alpha = 1, [3] = "three" }
local sum = 0
for _, value in pairs(t) do
    if type(value) == "number" then sum += value end
end
assert(sum == 4, "generic iteration / compound assignment mismatch")
local interpolation = `Luau {a}`
assert(interpolation == "Luau 7", "string interpolation mismatch")
print("[TM Studio Smoke Test] native Luau semantic checks passed")
