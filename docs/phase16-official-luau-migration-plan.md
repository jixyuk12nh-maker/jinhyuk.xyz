# Phase 16 — required path to a complete Luau runtime

## Why the current custom VM cannot be called complete

The current Python and Worker JavaScript compilers translate only a small syntax subset into the project's custom opcodes. Adding grammar productions one at a time is insufficient: correct Luau support also requires compatible multiple-result adjustment, varargs, generalized iteration, closures/upvalues, metatables, error behavior, standard-library semantics, type-syntax handling, and conformance against the official runtime. Roblox services (`game`, `Instance`, `task`, engine datatypes) are a separate host API layer and are not part of the standalone Luau language VM itself.

## Recommended implementation direction

1. **Choose the runtime target explicitly.** For language fidelity, use upstream `luau-lang/luau` Compiler + VM. Keep the current custom LGVM only if an intentionally limited language subset is acceptable.
2. **Pin an upstream Luau revision and honor the MIT license.** Vendor via a pinned git submodule or build dependency; do not silently track an unpinned `main` branch for production.
3. **Build the official CLI and conformance corpus first.** CI builds upstream `Luau.Repl.CLI` and runs `tests/official_luau_conformance.luau`. Add upstream `Luau.UnitTest` and `Luau.Conformance` targets when the build environment permits.
4. **Decide where bytecode executes.** A server-side native Luau VM cannot simply be copied into a Cloudflare Worker. A Worker integration needs a tested WebAssembly build of the official compiler/runtime or a separate compatible service. Roblox execution needs a runtime available in the Roblox environment; ordinary game scripts do not expose arbitrary native C++ or filesystem access.
5. **Define the host environment.** Language compatibility does not imply Roblox API compatibility. Expose only the documented globals/services the product needs, and test each bridge explicitly.
6. **Build a differential corpus.** For each test, compare official Luau output/errors with the chosen production runtime. Include grammar coverage, multiple returns/varargs, generalized iteration, closure/upvalue cases, metamethods, libraries, numeric edge cases, and resource limits.
7. **Validate generated artifacts in Studio.** The manual `roblox/StudioSmokeTest.server.lua` harness is an initial hook, not a pass result. Store the tested payload hash, Studio version, place version, logs, and expected output.
8. **Only then deprecate the old compiler.** Keep a compatibility flag and rollback plan until real scripts pass the differential corpus.

## Acceptance criteria

- Official compiler accepts all intended Luau syntax, including types and newer language constructs supported by the pinned revision.
- Runtime semantics pass the selected official conformance tests and the project's differential tests.
- The packaged runtime is executed in Roblox Studio and the results are recorded.
- Worker deployments have bounded CPU/memory and no arbitrary server capabilities exposed to untrusted scripts.
- The dashboard clearly distinguishes language support from Roblox engine API availability.

## Current status

Phase 15 adds the official CLI CI job and Studio harness, but the actual compiler/runtime replacement is **not completed**. This is a deliberate boundary rather than a claim that a CI smoke test magically upgrades the custom VM.
