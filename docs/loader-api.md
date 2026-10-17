# TM named-script loader API

## URL contract

Published protected output is served from:

```lua
loadstring(game:HttpGet("https://jinhyuk.xyz/Jinhyuk/MyScript"))()
```

The username and script name are case-insensitive for lookup and may contain only ASCII letters, digits, `_`, and `-`. The worker serves only active records. Unknown or disabled records return an HTTP error. Browser navigation is discouraged by checking the `Accept` header, but this is not authentication: HTTP headers can be forged. Use actual per-user license/token validation before treating a script as private.

## D1 setup

Apply `cloudflare/schema.sql` to the D1 database bound as `DB` in `wrangler.toml`:

```sh
npx wrangler d1 execute tm-db --remote --file=cloudflare/schema.sql
```

Confirm the database name and ID in `wrangler.toml` match your Cloudflare account before running this command.

## Worker secret

Set a strong random token (at least 32 characters) as a Worker secret:

```sh
npx wrangler secret put ADMIN_API_TOKEN
```

Do not put this token in source control or embed it into public JavaScript. The dashboard currently asks for it at publish time and sends it only in the request Authorization header. Use a trusted private device and clear the field after publishing.

## Register protected output

`POST /api/scripts` with `Authorization: Bearer <ADMIN_API_TOKEN>` and JSON:

```json
{
  "username": "Jinhyuk",
  "scriptName": "MyScript",
  "protectedCode": "-- already protected Luau output"
}
```

This stores or updates the named record. The response contains the public URL. `GET /api/scripts?username=Jinhyuk` lists metadata for that username (admin token required). `DELETE /api/scripts/Jinhyuk/MyScript` disables the record; it does not physically delete it.

## Critical runtime limitation

Cloudflare Workers cannot directly execute this repository's Python compiler/VM. The API and dashboard therefore accept **already-generated protected Luau output**; they do not yet compile an uploaded original source file. Generate output using the local CLI (`python -m cli pack input.lua protected.lua`) first. This repository's VM supports only a limited Luau subset and is not a full Roblox Luau runtime. Verify generated output in the actual target Roblox environment before distribution. Standard Roblox scripts do not generally have executor-specific `loadstring(game:HttpGet(...))` behavior available; the exact loader call depends on the environment in which it is run.

## Route `jinhyuk.xyz` to the TM Worker

The URL returned to Roblox uses the custom domain, not the `workers.dev` hostname. Therefore the Worker currently serving `jinhyuk.xyz` must forward `GET /<username>/<scriptName>` to the TM Worker **before** it serves its normal site assets. If the domain is attached to this exact TM Worker, no proxy is needed; if the domain currently points to the separate `jinhyuk-xyz` Worker, add equivalent forwarding there. Do not bind the same hostname to two workers.

```js
// Add near the start of the existing jinhyuk.xyz Worker's fetch handler,
// before its normal HTML/assets fallback:
const parts = new URL(request.url).pathname.split("/").filter(Boolean);
if (request.method === "GET" && parts.length === 2) {
  const upstream = new URL(request.url);
  upstream.hostname = "tm.jixyuk12nh.workers.dev";
  upstream.protocol = "https:";
  return fetch(new Request(upstream, request));
}
```

Review the existing route logic before adding this snippet: only forward the intended two-segment script paths, and preserve all existing routes. Browser `Accept` checks are a deterrent, not strong authentication.
