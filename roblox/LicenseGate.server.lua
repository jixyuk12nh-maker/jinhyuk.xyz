

local HttpService = game:GetService("HttpService")
local ServerScriptService = game:GetService("ServerScriptService")

local API_BASE = "https://api.jinhyuk.xyz"
local PRODUCT_ID = "your-product-id"
local LICENSE_KEY = "SET_THIS_ON_THE_SERVER_ONLY"

local ok, response = pcall(function()
    return HttpService:RequestAsync({
        Url = API_BASE .. "/v1/license/verify",
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json" },
        Body = HttpService:JSONEncode({
            productId = PRODUCT_ID,
            licenseKey = LICENSE_KEY,
            placeId = tostring(game.PlaceId),
        }),
    })
end)

if not ok or not response.Success then
    warn("tm: license verification failed")
    return
end

local decodedOk, result = pcall(function() return HttpService:JSONDecode(response.Body) end)
if not decodedOk or result.ok ~= true then
    warn("tm: license rejected")
    return
end

local feature = ServerScriptService:FindFirstChild("GameFeature")
if not feature or not feature:IsA("ModuleScript") then
    warn("tm: GameFeature ModuleScript is missing")
    return
end

local loaded, module = pcall(require, feature)
if not loaded then
    warn("tm: GameFeature failed to load")
    return
end
if type(module) == "table" and type(module.Init) == "function" then
    module.Init()
end
