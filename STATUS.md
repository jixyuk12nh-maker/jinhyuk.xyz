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
