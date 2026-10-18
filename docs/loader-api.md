# TM named-script loader API

## URL contract

Published protected output is served from:

```lua
loadstring(game:HttpGet("https://jinhyuk.xyz/api/Jinhyuk/MyScript"))()
```

The username and script name are case-insensitive for lookup and may contain only ASCII letters, digits, `_`, and `-`. The worker serves only active records. Unknown or disabled records return an HTTP error. The preferred public URL is owner-scoped: `https://jinhyuk.xyz/api/<username>/<scriptName>`. The legacy name-only URL can be ambiguous when multiple developers use the same name. The URL itself is a loader bootstrap, not a secret; key-mode delivery still requires license validation.

## D1 setup

For a new database only, initialize the D1 database bound as `DB` in `wrangler.toml` with `cloudflare/schema.sql`. For an existing database, apply the numbered migrations instead; do not rerun the baseline schema after `developer_id` has been added:

```sh
npx wrangler d1 execute tm-db --remote --file=cloudflare/schema.sql
```

Confirm the database name and ID in `wrangler.toml` match your Cloudflare account before running this command.

## Admin role

`/api/admin/*` uses the authenticated developer API token and checks that the corresponding D1 developer record has `role = 'admin'`. No separate admin-token environment variable is required. Grant the role only to an account whose identity you have verified, using a trusted D1 administrative session.

## Register protected output

First create or verify a developer account and grant it the `admin` role in D1. Then call `POST /api/scripts` with `Authorization: Bearer <DEVELOPER_API_TOKEN>` and JSON:

```json
{
  "scriptName": "MyScript",
  "sourceCode": "print('hello')",
  "loaderMode": "key"
}
```

This stores or updates the named record. When the Worker has an R2 binding named `BUCKET`, the protected code is stored at `scripts/<username-lowercase>/<script-name-lowercase>.lua` in R2 and D1 stores metadata. The response contains the public URL and `storage: "r2"`. Without the binding, it falls back to storing the code in D1 and returns `storage: "d1_fallback"`. `GET /api/scripts` lists only the authenticated developer's scripts. `DELETE /api/scripts/<username>/<scriptName>` disables a script only when its owner matches the authenticated developer; it does not physically delete the R2 object.

## Critical runtime limitation

Cloudflare Workers cannot directly execute this repository's Python compiler/VM. The dashboard compiles uploaded original source using the Worker's JavaScript port of the restricted subset. This is not the full official Luau compiler. The Python CLI can also package supported subset scripts (`python -m cli pack input.lua protected.lua`). This repository's VM supports only a limited Luau subset and is not a full Roblox Luau runtime. Verify generated output in the actual target Roblox environment before distribution. Standard Roblox scripts do not generally have executor-specific `loadstring(game:HttpGet(...))` behavior available; the exact loader call depends on the environment in which it is run.

## Route `jinhyuk.xyz` to the TM Worker

The URL returned to Roblox uses the custom domain, not the `workers.dev` hostname. Therefore the Worker currently serving `jinhyuk.xyz` must forward `GET /<username>/<scriptName>` to the TM Worker **before** it serves its normal site assets. If the domain is attached to this exact TM Worker, no proxy is needed; if the domain currently points to the separate `jinhyuk-xyz` Worker, add equivalent forwarding there. Do not bind the same hostname to two workers.

```js
const parts = new URL(request.url).pathname.split("/").filter(Boolean);
if (request.method === "GET" && parts.length === 2) {
  const upstream = new URL(request.url);
  upstream.hostname = "tm.jixyuk12nh.workers.dev";
  upstream.protocol = "https:";
  return fetch(new Request(upstream, request));
}
```

Review the existing route logic before adding this snippet: only forward the intended two-segment script paths, and preserve all existing routes. Browser `Accept` checks are a deterrent, not strong authentication.
