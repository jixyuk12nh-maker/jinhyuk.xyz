# tm VM + Cloudflare License API

tm is an experimental limited-subset Luau compiler/VM prototype with a Cloudflare Worker license-verification API. It is not a complete Luau implementation and is not production-ready.

## Repository layout

- `frontend/`, `compiler/`, `bytecode/`, `vm/`: experimental Python-hosted compiler and VM.
- `packager.py`: generates a standalone Luau runtime for the currently supported subset.
- `cli/`: `check`, `run`, and `pack` commands.
- `public/`: responsive black-glass TM workspace UI served by the Worker assets binding.
- `cloudflare/worker.js`: Cloudflare Worker API (`GET /`, `GET /health`, `POST /v1/license/verify`) plus static UI fallback.
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

1. Create a D1 database named `tm-db` in the Cloudflare dashboard.
2. Copy its actual database ID.
3. Uncomment the `[[d1_databases]]` section in `wrangler.toml`, set `database_id`, and commit the change; alternatively configure the `DB` binding in Worker settings.
4. Apply `cloudflare/schema.sql` to the database using the Cloudflare dashboard or Wrangler.

### Add R2

Create an R2 bucket named `tm-scripts` before enabling the commented `[[r2_buckets]]` binding. The current API does not yet read or write R2 objects; this binding is preparation for the next integration step.

## Run the VM locally

Requires Python 3.10+ and no third-party Python packages:

```bash
python -m unittest discover -s tests -v
python -m cli check sample.lua
python -m cli run sample.lua
python -m cli pack sample.lua protected.lua 1234
```

`pack` only supports a subset of Luau. Test generated output in the official Luau CLI or Roblox Studio before relying on it.

## Website UI

The `public/` directory contains a responsive workspace interface with overview, product, script/VM, user, license, analytics, compiler, API docs, and settings views. The UI deliberately labels sections as unavailable where the corresponding backend API does not exist yet; it does not fabricate product or user data. The health panel calls `https://tm.jixyuk12nh.workers.dev/health`. Update that URL in `public/app.js` if your deployed Worker URL differs.

The site pages are currently a frontend scaffold. Login/signup, product CRUD, user management, license issuance/revocation, analytics, and R2 upload/download are not implemented by this change. The existing license verification API and Roblox loader URL are not changed.

## API

- `GET /` or `GET /health`: health/status JSON.
- `POST /v1/license/verify`: validates `productId`, `licenseKey`, and `placeId` against the D1 `licenses` table.

The Worker hashes the submitted license key with SHA-256 and compares the hash to `key_hash`; raw keys should not be stored in D1. Do not commit secrets or real license keys.

## Limitations

Cloudflare Workers do not execute Roblox Luau. Roblox server code can call this API using `HttpService` for license verification. The included Python compiler/VM supports only a subset of Luau; varargs, multiple returns, generic `for ... in`, type annotations, metatables, coroutines, most standard libraries, and Roblox APIs are not fully supported. Unit tests do not establish official Luau compatibility or commercial-grade anti-tamper security.

## Build hardening (Phase 12)

Generated builds use build-specific opcode permutation and affine opcode encoding, instruction-position-dependent operand masking, and XOR-masked UTF-8 string constants. These mechanisms increase the effort needed for quick static inspection but are reversible and are not cryptographic protection.

## Jinhyuk.xyz loader modes (2026-10-18 update)

The Worker supports `/api/<scriptName>` loader bootstrap URLs with `keyless` and `key` modes. In this test build, script upload and license-management endpoints do not require an admin API token. This is intentionally insecure and must not be exposed publicly before session-based admin authorization is added. In key mode, the generated loader reads the global `Script_key` value and submits it to `/api/loader/resolve`; the Worker checks the stored license hash, status, and expiration before returning code. Create licenses with `POST /api/licenses` and the `productId` returned by script registration. The raw key is shown only in the creation response.

For an existing D1 database, apply the migration once:

```sh
npx wrangler d1 migrations apply tm-db --remote
```

For a new database, initialize it with `cloudflare/schema.sql` before deploying. Ensure the D1 binding in `wrangler.toml` points to the intended database. The current test build does not require `ADMIN_API_TOKEN`; add session-based admin authorization before public production use.

Generated keyless loader:

```lua
loadstring(game:HttpGet("https://jinhyuk.xyz/api/MyScript"))()
```

Generated key loader:

```lua
Script_key = "YOUR_LICENSE_KEY"
loadstring(game:HttpGet("https://jinhyuk.xyz/api/MyScript"))()
```

Note: a client-side loader cannot guarantee prevention of source dumping after code reaches the client. The Worker logs loader requests and enforces license checks for key-mode delivery, but this is not a complete anti-dump system or production-grade rate limiter.
### API 연결 실패 시 확인

`wrangler.toml`의 `[assets]` 설정에서 `/health`, `/api/*`, `/v1/*` 경로는 `run_worker_first`로 Worker가 먼저 처리해야 합니다. 이 설정이 없으면 SPA 정적 파일 처리기가 API 요청을 가로채 사이트에서 `API 연결 실패`로 표시될 수 있습니다. 수정 후 Worker를 다시 배포하고 `https://jinhyuk.xyz/health`에서 JSON 응답을 확인하세요.
