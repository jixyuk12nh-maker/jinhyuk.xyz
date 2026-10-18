# Security and compatibility limitations

tm VM is a prototype. It does not create a trusted execution boundary on a user's client, and it cannot guarantee that source logic or embedded constants will remain secret.

Each generated build now applies several reversible transformations: opcode IDs are permuted and affine-encoded, instruction operands are masked using per-build keys plus instruction-position-dependent offsets, and string constants are stored as XOR-masked UTF-8 bytes and decoded at runtime. A seed makes a build reproducible; omitting it chooses fresh parameters.

These are obfuscation layers, not cryptographic secrecy. The keys and decoding logic must run on the client and can be recovered by a determined analyst. Numeric constants and runtime behavior can still be inspected, and decrypted strings can be captured during execution. This is a stronger baseline than plain opcode permutation, not a claim of equivalence to a mature commercial protector.

The Python VM is not runnable inside Roblox. The `pack` command emits an experimental Luau interpreter for the supported custom-bytecode subset, but the generated output has not been verified in Roblox Studio or against an official Luau runtime in this environment. Test output in a controlled environment before using it.

Unsupported or incomplete features include varargs, multiple returns, generic iteration, full standard-library behavior, metatables, coroutines, type annotations, and Roblox APIs (`game`, `Instance`, `task`, services). The generated runtime may also differ from the Python VM on error details, table edge cases, number formatting, and native behavior.

Execution-step and call-depth limits mitigate accidental runaway code in the generated interpreter but do not replace a complete sandbox. Do not run untrusted scripts with privileged host capabilities.

## Loader license checks added in the 2026-10-18 review

The key-mode loader now sends `game.PlaceId` and checks it against `licenses.allowed_place_ids` when that list is non-empty. License creation accepts `allowedPlaceIds` as an optional array of numeric place IDs; an empty array means no place restriction. The older `/v1/license/verify` route follows the same empty-list behavior.

This check is only a compatibility/access-control guard, not proof of game identity: a client-controlled executor can alter the request and submit a different `placeId`. Do not use it as a substitute for server-side authorization where the execution environment can be trusted.

The current code requires developer bearer tokens for script publishing/listing/disabling and license management. Admin routes additionally require the authenticated developer record to have `role = 'admin'` in D1. This is not a full browser-session account system.

## Phase 15 — developer ownership and API authentication

- Management endpoints use per-developer bearer API tokens whose SHA-256 hashes are stored in D1; `/api/admin/*` also checks the D1 role.
- Admins can create/list developers, enable/disable accounts, and rotate developer tokens using `/api/admin/developers` routes. The developer token is shown only when created.
- Script publishing derives the username/owner from the authenticated developer rather than trusting the caller's `username` field. Script listing and disabling are scoped to the authenticated developer. Product/license creation and license revocation are scoped to product ownership.
- No separate admin-token environment variable is used. Admin access is denied unless the authenticated D1 developer record has the `admin` role.
- These are bearer API tokens, not a complete email/password + cookie-session account system. Protect developer tokens, rotate compromised tokens through the admin route, and use HTTPS. Legacy scripts with a null `developer_id` require an explicit ownership migration before being manageable through the new developer routes.
