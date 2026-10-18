# tm VM status — Phase 9

This repository remains an experimental compiler/VM and packaging prototype. It is not equivalent to Luarmor and is not a production-grade protector.

## Phase 7 — standalone Luau package generator

- Added `python3 -m cli pack input.lua output.lua [seed]`.
- Compiles the currently supported subset to the project's custom bytecode and emits a Luau file containing instruction/prototype tables and an interpreter for that opcode subset.
- Generated files do not include the original source text as a source string; literals required by the program remain present as constants.
- This generated runtime is an experimental implementation and still needs execution in the official Luau/Roblox environment before compatibility can be claimed.

## Phase 8 — build diversification

- Each package build can permute numeric opcode IDs using a seed.
- Reproducible builds are available by passing the same seed; omit it for a randomized build.
- This is lightweight diversification, not encryption and not strong anti-reverse-engineering protection. Constants and bytecode remain recoverable by analysis.

## Phase 9 — hardening and regression coverage

- Added packaging tests for deterministic seed behavior, output structure, closure metadata, and invalid source rejection.
- Retained execution-step and call-depth limits in the generated runtime.
- Added explicit documentation of unsupported syntax and security/compatibility boundaries.

## Supported in the Python-hosted VM

- Arithmetic and comparisons; conditionals and `while`.
- Numeric `for`, `repeat ... until`, `break`.
- Tables and basic indexing.
- Functions, closures, and upvalues.
- `%`, `^`, `//`, `#`, concatenation, and colon method-call syntax.

## Important limitations

- This is not a complete Luau parser/runtime. Varargs, multiple return values, generic `for ... in`, type annotations, metatables, coroutines, and most standard libraries are not implemented.
- Roblox globals/APIs such as `game`, `Instance`, `task`, and services are not supplied by the Python VM.
- The generated Luau runtime implements the current custom bytecode subset only. It has not been verified in Roblox Studio or against the official Luau CLI in this environment.
- The generated runtime uses Roblox/Luau native tables for table values; some edge-case semantics differ from the Python VM.
- Opcode permutation is not cryptographic protection. A determined analyst can inspect the runtime and constants.
- Passing unit tests does not establish full Luau compatibility, performance, or resistance to reverse engineering.

## Phase 10 — embedded runtime argument semantics

- The generated Luau VM now carries an explicit argument count, so nil-valued arguments do not get truncated by Lua table length or `ipairs` behavior.
- The generated `print` wrapper formats nil, booleans, integral numbers, finite numbers, NaN, infinities, tables, and functions consistently with the prototype's display conventions.
- This remains a subset VM: multiple return values, varargs, generic iteration, metatables, coroutines, and Roblox APIs are still out of scope. Generated code still requires execution tests in the official Luau/Roblox environment.

## Phase 11 — runtime consistency fixes and architecture notes

- Generated `RETURN` now honors the zero-result form by returning `nil`, matching the Python interpreter's current single-result contract.
- Added `docs/custom-vm-architecture.md` to document the source-to-bytecode-to-embedded-runtime path and the boundaries of the current subset.
- Next major compatibility work should start with official Luau execution tests, then multiple returns/varargs and additional syntax. Do not describe the current VM as full Luau-compatible yet.

## Phase 12 — layered per-build encoding

- Added build-specific affine encoding after opcode permutation.
- Encoded each instruction operand with a build-specific key and instruction-position offset.
- Stored string constants as XOR-masked UTF-8 byte arrays and decode them only when read by the generated runtime.
- Added regression coverage confirming plaintext string literals are not emitted directly.
- Security remains obfuscation, not encryption against a determined analyst. The generated Luau still needs real execution tests in the official Luau/Roblox runtime.


## Website UI integration

- Added a responsive black-glass workspace UI under `public/` and configured the Worker static assets binding.
- Added navigation views for overview, products, scripts/VM, users, licenses, analytics, compiler, API docs, and settings.
- The UI checks the configured Worker health endpoint and explicitly marks backend features that are not implemented yet.
- Existing VM/compiler/bytecode source and `/v1/license/verify` behavior are retained.
- UI presence does not mean account auth, product CRUD, key issuance, analytics, or R2 transfer endpoints exist; these remain follow-up implementation work.


## Phase 13 — Worker-side JavaScript compiler pipeline

- Added `cloudflare/compiler.js`, a JavaScript implementation of the project's restricted lexer/parser, register bytecode generator, and standalone Luau VM packager.
- `POST /api/scripts` now accepts original `sourceCode`, compiles and packages it inside the Worker, and stores only the generated package in R2/D1.
- Compile failures return HTTP 400 before any R2 write.
- Updated the script UI to upload original Lua source and report compile/storage status.
- Worker tests cover successful compilation/storage and rejection without storage on compile failure.
- Limitations remain: supported syntax is a subset, no Roblox APIs are exposed inside the custom VM, and generated output has not yet been validated in a live Roblox/Luau execution environment.

## Phase 14 — official Luau and public Luarmor documentation review

- Added `docs/luau-conformance.md`, separating official Luau language/runtime expectations from this project's implemented subset.
- Added regression tests that unsupported syntax (generic iteration, varargs, `do` blocks, Luau `if` expressions, `continue`, type annotations, and backtick interpolation) is rejected rather than accidentally treated as supported.
- Compared only against public Luarmor documentation; no claim is made about private Luarmor internals.
- Full Luau/Roblox compatibility remains unverified because the official Luau CLI/Roblox runtime is not available in this environment.

## Phase 15 — developer API authentication and external conformance harness (2026-10-18)

- Added `cloudflare/migrations/0003_developer_auth.sql`: developers, products, script ownership, and indexes.
- Admin endpoints under `/api/admin/developers` require a valid developer API token and a D1 `admin` role. Developer creation returns a high-entropy bearer token once and stores only its SHA-256 hash.
- Script publishing, listing, disabling, license creation, and license revocation require an active developer token. Script owner identity comes from the token; product and license operations are scoped to the developer's owned products. Product ID and legacy script ownership collision checks were added.
- Dashboard script/license forms now request the developer token and keep it in `sessionStorage` for the current browser tab only.
- Added an official Luau CLI conformance smoke corpus and GitHub Actions job that builds upstream `luau-lang/luau`; added a manual Roblox Studio payload smoke harness.
- Local validation: 75 Python unit tests pass; 20 Worker tests pass; JavaScript syntax checks pass.

### Remaining blockers / truth-in-advertising

- The project's actual JS/Python compiler and embedded VM remain a restricted subset. The official CLI CI job checks the official Luau corpus separately; it does not magically add full syntax/runtime support to the custom VM.
- The Roblox Studio harness is provided but has not been executed in this environment. A user must run it in a private Studio test place and record the result.
- Luarmor private implementation is unavailable. The project can implement equivalent public-facing features, not claim a byte-for-byte or algorithm-for-algorithm reproduction.
- Developer authentication is bearer-token based, not full password/session auth. Existing scripts with `developer_id = NULL` need an explicit owner migration.
- Wrangler deployment dry-run and upstream Luau CI build were not run locally in this environment.


## Follow-up cleanup

- Removed source-code comments from JavaScript, Python, Lua, SQL, CSS, HTML, TOML, and workflow files.
- Removed the separate `ADMIN_API_TOKEN` environment-secret requirement. Admin routes now require a valid developer API token whose D1 account has the `admin` role.
- Added no cache layer or Cache API usage. `no-store` headers remain only to prevent caching of sensitive responses and stored script payloads.
- Re-ran Python and Worker tests after the cleanup.
