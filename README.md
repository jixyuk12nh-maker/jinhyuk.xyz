# LuaGuard VM + Cloudflare License API

LuaGuard is an experimental limited-subset Luau compiler/VM prototype with a Cloudflare Worker license-verification API. It is not a complete Luau implementation and is not production-ready.

## Repository layout

- `frontend/`, `compiler/`, `bytecode/`, `vm/`: experimental Python-hosted compiler and VM.
- `packager.py`: generates a standalone Luau runtime for the currently supported subset.
- `cli/`: `check`, `run`, and `pack` commands.
- `cloudflare/worker.js`: Cloudflare Worker API (`GET /`, `GET /health`, `POST /v1/license/verify`).
- `cloudflare/schema.sql`: D1 schema; license keys are stored as SHA-256 hashes.
- `roblox/LicenseGate.server.lua`: example server-side license gate for your own Roblox Studio experience.
- `package.json` and `wrangler.toml`: Node/Wrangler deployment configuration.

## Cloudflare Git integration

Configure the Cloudflare build settings at the repository root:

- **Build command:** `npm run build`
- **Deploy command:** `npm run deploy`
- **Preview command:** `npm run preview`

Cloudflare's build environment should install dependencies from `package.json`. The build command runs Wrangler's dry-run deployment; the deploy command publishes the Worker; the preview command starts a local Wrangler development server.

This initial configuration intentionally does not contain a fake D1 database ID, so the Worker can be built before a database exists. The health endpoint works without D1; license verification returns `database_not_configured` until you create and bind a database.

### Add D1

1. Create a D1 database named `luaguard-licenses` in the Cloudflare dashboard.
2. Copy its actual database ID.
3. Uncomment the `[[d1_databases]]` section in `wrangler.toml`, set `database_id`, and commit the change; alternatively configure the `DB` binding in Worker settings.
4. Apply `cloudflare/schema.sql` to the database using the Cloudflare dashboard or Wrangler.

### Add R2

Create an R2 bucket named `luaguard-scripts` before enabling the commented `[[r2_buckets]]` binding. The current API does not yet read or write R2 objects; this binding is preparation for the next integration step.

## Run the VM locally

Requires Python 3.10+ and no third-party Python packages:

```bash
python -m unittest discover -s tests -v
python -m cli check sample.lua
python -m cli run sample.lua
python -m cli pack sample.lua protected.lua 1234
```

`pack` only supports a subset of Luau. Test generated output in the official Luau CLI or Roblox Studio before relying on it.

## API

- `GET /` or `GET /health`: health/status JSON.
- `POST /v1/license/verify`: validates `productId`, `licenseKey`, and `placeId` against the D1 `licenses` table.

The Worker hashes the submitted license key with SHA-256 and compares the hash to `key_hash`; raw keys should not be stored in D1. Do not commit secrets or real license keys.

## Limitations

Cloudflare Workers do not execute Roblox Luau. Roblox server code can call this API using `HttpService` for license verification. The included Python compiler/VM supports only a subset of Luau; varargs, multiple returns, generic `for ... in`, type annotations, metatables, coroutines, most standard libraries, and Roblox APIs are not fully supported. Unit tests do not establish official Luau compatibility or commercial-grade anti-tamper security.

## Build hardening (Phase 12)

Generated builds use build-specific opcode permutation and affine opcode encoding, instruction-position-dependent operand masking, and XOR-masked UTF-8 string constants. These mechanisms increase the effort needed for quick static inspection but are reversible and are not cryptographic protection.
