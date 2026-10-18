# TM project review and Phase 15 changes

Date: 2026-10-18

Follow-up cleanup: removed source-code comments, removed the separate `ADMIN_API_TOKEN` secret requirement, switched admin routes to D1 role-based authorization, and added no cache layer. `no-store` response metadata remains solely to prevent sensitive responses and stored scripts from being cached.

## Changes made in this pass

### Authentication and ownership

- Added migration `cloudflare/migrations/0003_developer_auth.sql` for `developers`, `products`, and `scripts.developer_id`.
- Admin-only developer create/list/status endpoints now require a valid developer API token whose D1 account has the `admin` role.
- Developer API tokens are generated with 256 random bits, returned only on creation, and stored as SHA-256 hashes.
- Script publishing uses the authenticated developer identity instead of trusting a user-supplied username.
- Script listing and disabling are scoped to the authenticated developer. Product creation/license issuance and revocation are scoped to product ownership.
- Added checks preventing a developer from taking another developer's product ID or script. Existing unowned legacy scripts are rejected until explicitly migrated.
- Updated dashboard forms to request the developer token and keep it in `sessionStorage` for the current tab.

### Luau / Roblox validation

- Added `tests/official_luau_conformance.luau` to exercise official Luau syntax/runtime features: type declarations, type annotations, varargs, multiple returns, generalized iteration, compound assignment, `continue`, `if` expressions, and interpolation.
- Added a GitHub Actions job that builds the upstream official Luau CLI and runs that corpus.
- Added `roblox/StudioSmokeTest.server.lua` and instructions for running a generated payload in a private Roblox Studio place.
- Updated compatibility documentation to distinguish official Luau tests from the custom VM tests.

## Tests actually run locally

- `python -m unittest discover -s tests -v`: **75 passed**.
- `npm run test:worker`: **22 passed**.
- `node --check cloudflare/worker.js`, `node --check cloudflare/compiler.js`, `node --check public/app.js`: **passed**.

Not run locally: upstream Luau source build/CLI job, Wrangler deploy dry-run, and Roblox Studio runtime test. This environment does not provide Roblox Studio.

## Important limitations

1. **Full Luau VM is not complete.** The Worker compiler and generated custom VM still implement only a documented subset. Running official Luau in a separate CI job is a differential baseline, not support in the custom VM. A full solution requires replacing or substantially redesigning the compile/package/runtime path around the official Luau compiler/VM, including an explicit decision about how Roblox globals and services are exposed.
2. **Roblox Studio verification is not yet passed.** The harness is included; the actual payload must be executed in Studio and logs reviewed.
3. **Luarmor internal replication is not possible from public docs alone.** The repository can implement similar public product behavior (project grouping, loader stability, key expiry/revocation, optional identity binding, events) but cannot claim to reproduce private algorithms or source.
4. **Auth is API-token based, not a complete account system.** There is no email/password login, session rotation, cookie security, CSRF flow, or self-service token rotation UI. No separate admin-token environment variable is required; assign the `admin` role only to a verified D1 account.
5. **Legacy ownership migration required.** Existing scripts may have null `developer_id`; assign them to verified developer records before management endpoints can work for those scripts.
6. **Client-side license metadata is not trustworthy.** `placeId` supplied by a client can be spoofed; it is an access filter, not proof of game identity.

## Public-source basis

- Official Luau implementation and CLI: https://github.com/luau-lang/luau
- Official Roblox Studio command line test support: https://create.roblox.com/docs/studio/command-line-interface
- Public Luarmor API and user manual docs describe key management, expiry, project-level key organization, and loader behavior, but do not reveal private internals: https://docs.luarmor.net/
