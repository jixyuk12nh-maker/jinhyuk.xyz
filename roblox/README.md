# Roblox integration (legitimate Roblox Studio experiences)

1. Deploy the Cloudflare Worker and configure D1 as described in the root README.
2. Enable **Allow HTTP Requests** in your own experience's Game Settings > Security.
3. Put `LicenseGate.server.lua` in `ServerScriptService`. Replace the Worker URL, product ID, and server-side license key.
4. Add your actual game code as a `ModuleScript` named `GameFeature` in `ServerScriptService`, returning a table with an optional `Init()` function.

Important: Roblox `HttpService` can fetch data but does not evaluate arbitrary source text. This example intentionally does not use `loadstring` or executor APIs. Cloudflare verifies a license; the Roblox server runs a ModuleScript already shipped with your experience. Do not put secret keys in replicated/client scripts.
