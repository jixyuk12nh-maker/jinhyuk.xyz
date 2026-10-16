# tm VM + Cloudflare License API

tm is an **experimental limited-subset Luau compiler/VM prototype** plus a Cloudflare Worker/D1 license-verification scaffold. It is not equivalent to Luarmor and is not production-ready.

## Repository layout

- `frontend/`, `compiler/`, `bytecode/`, `vm/`: Python-hosted experimental compiler and VM.
- `packager.py`: generates a standalone Luau runtime for the currently supported subset; official Luau/Roblox execution still needs testing.
- `cli/`: `check`, `run`, and `pack` commands.
- `cloudflare/worker.js`: Worker API with `/health` and `/v1/license/verify`.
- `cloudflare/schema.sql`: D1 schema for license records (stores SHA-256 hashes, not plaintext keys).
- `roblox/LicenseGate.server.lua`: example server-side license gate for your own Roblox Studio experience.
- `.github/workflows/test.yml`: CI runs Python unit tests.

## Run VM locally

Requires Python 3.10+; no third-party Python packages are required.

```bash
python3 -m unittest discover -s tests -v
python3 -m cli check sample.lua
python3 -m cli run sample.lua
python3 -m cli pack sample.lua protected.lua 1234
```

`pack` emits an experimental standalone `.lua` file for the supported syntax subset. Do not assume it supports arbitrary Luau. Test generated output in the official Luau CLI or Roblox Studio before using it.

## Deploy Cloudflare Worker

1. Install Wrangler and authenticate: `npx wrangler login`.
2. Create a D1 database: `npx wrangler d1 create tm-licenses`.
3. Copy the returned database ID into `wrangler.toml`.
4. Apply schema: `npx wrangler d1 execute tm-licenses --remote --file=cloudflare/schema.sql`.
5. Deploy: `npx wrangler deploy`.
6. Configure `api.jinhyuk.xyz` as a Worker custom domain in Cloudflare, then check `https://api.jinhyuk.xyz/health`.

### Add a license record

The Worker expects `key_hash` to be lowercase SHA-256 hex of the raw key, `product_id`, `status='active'`, and `allowed_place_ids` as a JSON array of place IDs (strings). Generate the hash locally; never commit raw keys. Example SQL after substituting values:

```sql
INSERT INTO licenses (id, product_id, key_hash, status, allowed_place_ids)
VALUES ('lic_001', 'my-product', 'LOWERCASE_SHA256_HEX', 'active', '["123456789"]');
```

## Roblox integration boundary

Cloudflare cannot execute Luau inside Roblox. Roblox server code can call the Worker using `HttpService` for license checks or data. The included example then requires a ModuleScript already installed in your own experience. Arbitrary source returned by an HTTP endpoint is not automatically executable. This repo does not include executor-specific loaders.

For real sales/licensing, add rate limiting, audit logs, key rotation, admin-only license issuance, abuse monitoring, and secret management before production. The current endpoint is a starting scaffold, not a hardened commercial licensing system.

## Limitations

The Python VM and generated Luau runtime support only a subset. Varargs, multiple returns, generic `for ... in`, type annotations, metatables, coroutines, most standard libraries, and Roblox APIs are not fully supported. Passing unit tests does not establish official Luau compatibility or resistance to reverse engineering. See `STATUS.md` and `docs/`.
