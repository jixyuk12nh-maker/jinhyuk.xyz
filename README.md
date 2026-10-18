# tm VM + Cloudflare License API

tm is an experimental limited-subset Luau compiler/VM prototype with a Cloudflare Worker license-verification API. It is not a complete Luau implementation and is not production-ready.

## Repository layout

- `frontend/`, `compiler/`, `bytecode/`, `vm/`: experimental Python-hosted compiler and VM.
- `packager.py`: generates a standalone Luau runtime for the currently supported subset.
- `cli/`: `check`, `run`, and `pack` commands.
- `public/`: responsive black-glass TM workspace UI served by the Worker assets binding.
- `cloudflare/worker.js`: Cloudflare Worker API, in-Worker JavaScript compilation, R2-backed script publishing/delivery, license verification, and static UI fallback.
- `cloudflare/compiler.js`: JavaScript port of the restricted parser/code generator/standalone VM packager; this is the test upload pipeline.
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

Create an R2 bucket in Cloudflare and add a Worker R2 binding with variable name `BUCKET` pointing to that bucket. In the dashboard, use Worker → Settings → Bindings → Add binding → R2 bucket. The `POST /api/scripts` endpoint accepts the original Lua source as `sourceCode`, compiles/packages it inside the Worker using `cloudflare/compiler.js`, then stores the protected output in R2 at `scripts/<username>/<scriptName>.lua`; D1 stores the script metadata. A compile error returns HTTP 400 and does not write to R2. The loader reads code from R2 after applying the existing active-status and license checks. If the R2 binding is absent, publishing falls back to storing code in D1 for backward compatibility. `GET /health` reports `r2Storage: true` when the binding exists.

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

The `public/` directory contains the workspace interface, email/password signup and login, session status, developer API key issuance, product listing/status/name management, admin user listing/blocking, license management, analytics, compiler, API docs, and settings. The site remains a beta prototype; not every commercial feature is implemented. The health panel uses the current origin's `/health` endpoint.

## API

- `GET /` or `GET /health`: service status and binding presence.
- `POST /api/auth/signup`: creates an email/password account; body `{ "username", "email", "password", "role": "user" | "admin" }`; creates an HttpOnly session cookie.
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`: session-based account authentication.
- `POST /api/account/api-token`: requires a signed-in account; issues or rotates its developer API key, shown once. The key's hash is stored in D1.
- `GET /api/account/admin/users`: admin-session-only user list.
- `POST /api/account/admin/users/:id/status`: admin-session-only account block/unblock; disabling an account also disables its linked developer key and removes sessions.
- `GET /api/products`, `PATCH /api/products/:productId`: developer-token-scoped product list, name and status update.
- `GET /api/analytics`: developer-token-scoped script, product, license, and loader-event counts.
- `POST /api/admin/developers`: admin-only; body `{ "username": "devname" }`; returns a developer API token once.
- `GET /api/admin/developers`: admin-only developer listing.
- `POST /api/admin/developers/:id/status`: admin-only; body `{ "status": "active" }` or `{ "status": "disabled" }`.
- `POST /api/admin/developers/:id/rotate-token`: admin-only; revokes the previous developer token and returns a new token once.
- `POST /api/scripts`: requires `Authorization: Bearer <developer-token>`; accepts `{ scriptName, sourceCode, loaderMode }`. Identity comes from the token, not request JSON.
- `GET /api/scripts`: requires a developer token and returns only that developer's scripts.
- `DELETE /api/scripts/:username/:scriptName`: requires a developer token and matching owner.
- `POST /api/licenses` and `POST /api/licenses/revoke`: require a developer token and product ownership.
- `GET /api/loader/resolve` and `POST /api/loader/resolve`: loader delivery with license checks.
- `POST /v1/license/verify`: public key verification; client-supplied Place ID is not a trusted identity.

The Worker hashes developer API tokens and license keys before storage. Do not commit secrets or real license keys.

## Limitations

The Worker does not provide Roblox's `game`, `Instance`, services, or full Roblox runtime. Its JavaScript compiler remains a restricted subset and is not a full Luau parser/runtime. CI now builds the upstream official Luau CLI and runs a conformance smoke corpus; `roblox/StudioSmokeTest.server.lua` is a manual Studio harness. Neither proves that the custom VM supports all Luau syntax. Full language support requires migrating the actual compiler/runtime pipeline to the official Luau compiler and VM (or a demonstrably equivalent implementation) and validating the generated runtime.

## Build hardening (Phase 12)

Generated builds use build-specific opcode permutation and affine opcode encoding, instruction-position-dependent operand masking, and XOR-masked UTF-8 string constants. These mechanisms increase the effort needed for quick static inspection but are reversible and are not cryptographic protection.

## Developer/admin authentication and loader modes (2026-10-18 update)

The Worker supports `/api/<scriptName>` loader bootstrap URLs with `keyless` and `key` modes. Management APIs fail closed:

1. Use an existing developer account's API token for authenticated management.
2. Grant the trusted account the `admin` role directly in D1 after verifying its identity: `UPDATE developers SET role = 'admin' WHERE username_key = 'your_verified_username';`
3. Use that account's existing developer API token in the `Authorization: Bearer <developer-token>` header. The token is stored only as a SHA-256 hash in D1. Do not expose it in public frontend code.
4. For an existing database whose earlier migrations are recorded, apply `cloudflare/migrations/0004_accounts_sessions.sql` using `wrangler d1 migrations apply tm-db --remote`. If you initialized the database manually from `cloudflare/schema.sql` and the migration history is not tracked, run the contents of `0004_accounts_sessions.sql` once in the D1 SQL editor instead. Do not run it twice: it adds `developers.account_id`.
5. Legacy scripts created before developer ownership have `developer_id = NULL`; assign them to a verified developer before expecting developer-scoped management routes to list or modify them.

In key mode, the loader submits the license key to `/api/loader/resolve`; the Worker checks key hash, status, expiry, and configured Place ID allowlist. A client-supplied Place ID can be spoofed, so this is not cryptographic proof of game identity. Browser accounts now use password-derived hashes and seven-day HttpOnly session cookies. Developer API keys remain separate bearer credentials, are stored only as SHA-256 hashes, and are shown once when issued. This is still a beta system: there is no email verification, password reset, rate limiting, or full audit log. The requested beta signup currently lets anyone select `admin`; this is unsafe on a public deployment and must be restricted before launch.

Generated keyless loader (executor-style environment only; not directly compatible with a default Roblox Studio server/client script):

```lua
loadstring(game:HttpGet("https://jinhyuk.xyz/api/YOUR_USERNAME/MyScript"))()
```

Generated key loader:

```lua
Script_key = "YOUR_LICENSE_KEY"
loadstring(game:HttpGet("https://jinhyuk.xyz/api/YOUR_USERNAME/MyScript"))()
```

Note: a client-side loader cannot guarantee prevention of source dumping after code reaches the client. The Worker logs loader requests and enforces license checks for key-mode delivery, but this is not a complete anti-dump system or production-grade rate limiter.
### API 연결 실패 시 확인

`wrangler.toml`의 `[assets]` 설정에서 `/health`, `/api/*`, `/v1/*` 경로는 `run_worker_first`로 Worker가 먼저 처리해야 합니다. 이 설정이 없으면 SPA 정적 파일 처리기가 API 요청을 가로채 사이트에서 `API 연결 실패`로 표시될 수 있습니다. 수정 후 Worker를 다시 배포하고 `https://jinhyuk.xyz/health`에서 JSON 응답을 확인하세요.
