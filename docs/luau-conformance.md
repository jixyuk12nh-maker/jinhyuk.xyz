# Luau compatibility review (source-based)

Review date: 2026-10-18

This project is a **restricted source-to-custom-bytecode compiler and embedded interpreter**, not the official Luau compiler or VM. The compatibility table below records what this repository actually implements; it does not infer compatibility from the fact that a snippet looks like Lua.

## References reviewed

- Official Luau compatibility guide: https://luau.org/compatibility/
- Official Luau syntax guide: https://luau.org/syntax/
- Official Luau grammar: https://luau.org/grammar/
- Official Luau sandbox guide: https://luau.org/sandbox/
- Public Luarmor quickstart documentation: https://github.com/Stefanuk12/luarmor/blob/main/quickstart.mdx
- Public Luarmor FAQ/troubleshooting: https://github.com/Stefanuk12/luarmor/blob/main/faq-troubleshooting.mdx

The Luau sources describe language/runtime compatibility and sandbox expectations. Luarmor's public docs describe user-facing product behavior, not its private implementation. This review does **not** claim to reproduce Luarmor internals.

## Syntax conformance matrix

| Feature | Current TM compiler/VM | Expected handling |
|---|---|---|
| Numbers, quoted strings, booleans, `nil` | Supported subset | Compile and run only within documented semantics |
| Arithmetic, comparisons, `and`/`or`/`not` | Supported subset | Unit-tested for covered cases |
| `if` statements, `while`, numeric `for`, `repeat ... until`, `break` | Supported subset | Unit-tested for covered cases |
| Tables, indexing, simple functions, closures/upvalues | Supported subset | Not full Luau table/metatable/function semantics |
| `do ... end` blocks | Not supported | Reject at compile time |
| Generic iteration (`for k, v in ... do`) | Not supported | Reject at compile time |
| `...`, varargs, multiple returns | Not supported | Reject or report unsupported syntax; never claim semantic support |
| Luau `if` expressions | Not supported | Reject at compile time |
| `continue` | Not supported | Reject at compile time |
| Type annotations/type declarations/generic types | Not supported | Reject at compile time |
| Backtick string interpolation | Not supported | Reject at compile time |
| Method declaration sugar (`function t:m()`) | Not supported | Reject at compile time; `obj:m()` calls are a separate supported syntax form |
| Metatables, coroutines, broad standard libraries | Not implemented as Luau semantics | Do not assume availability |
| Roblox globals/services (`game`, `Instance`, `workspace`, `task`) | Not supplied by the custom VM | They are not magically available because output is Luau text |

Official Luau is based on Lua 5.1 with intentional differences and additional syntax. The project's supported subset is much smaller; see `supported-syntax.md` and the automated rejection tests.

## Runtime and isolation findings

- The generated runtime must not write VM globals directly into the host's environment. It now creates a private `ENV` table that reads through `HOST_ENV`; this prevents a VM assignment such as `print = ...` from overwriting the executor's global `print`.
- The embedded runtime has an instruction limit and a call-depth limit. These are project safeguards, not a proof of sandbox safety or parity with official Luau's interruption model.
- The project does not expose a complete Roblox API, and its table/function/error behavior is not a drop-in replacement for Roblox Luau.
- String/operand encoding is obfuscation. The decoding logic and key are in the delivered client package, so this is not cryptographic confidentiality.

## Luarmor feature comparison (public docs only)

Public docs describe project/script organization, loader distribution, key whitelisting and expiry, optional HWID linking/reset, logs/webhooks, and modes such as Heartbeat and Silent Mode. Those are product-level behaviors; this repository only has partial loader/license endpoints and should not be described as feature-equivalent. In particular:

- A supplied `placeId` is client-controlled and can be spoofed; it is a compatibility/usage filter, not proof of game identity.
- Management endpoints require a developer bearer token; `/api/admin/*` additionally requires the authenticated account to have `role = 'admin'` in D1.
- New loader URLs include both developer username and script name so duplicate names can be resolved within an owner scope. The legacy name-only route remains ambiguous when names collide.
- A successful unit-test run is not equivalent to executing generated output in Roblox Studio or the official Luau CLI.

## Verification boundary

The automated tests validate the implemented subset, expected rejection of selected unsupported Luau constructs, Worker route behavior, and regression fixes. They do not establish full Luau language compatibility, Roblox executor compatibility, anti-tamper strength, or production security. Run the generated package in a real supported Luau/Roblox environment before making runtime compatibility claims.

## Official Luau CLI and Studio test harness added in Phase 15

- `tests/official_luau_conformance.luau` is run by a GitHub Actions job that checks out and builds the upstream `luau-lang/luau` repository, then runs the official Luau CLI. This verifies that the conformance corpus is accepted and executes in the official open-source Luau CLI. It does **not** mean the custom compiler/VM accepts the same corpus.
- `roblox/StudioSmokeTest.server.lua` is a manual Roblox Studio harness. Place a generated output in `ServerStorage.TMGeneratedPayload` as a ModuleScript, then run the harness in a private test place. This environment does not have Roblox Studio, so the harness has not been executed here.
- The current Cloudflare Worker compiler still compiles only the documented subset. Full Luau syntax/runtime support remains **not implemented** until the pipeline is migrated to the official Luau compiler and VM (or a demonstrably equivalent implementation) and the delivered runtime is proven to preserve the required semantics.
