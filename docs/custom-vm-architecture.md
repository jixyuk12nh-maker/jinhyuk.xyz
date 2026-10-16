# Custom embedded Luau VM architecture

## Goal

`tm` uses its own register-based bytecode and interpreter for the supported source subset. The `pack` command compiles source to the internal `LGVM` format, then emits a standalone Luau script containing the prototype table and an interpreter. It does not execute source by calling Roblox's compiler or interpreter.

## Pipeline

1. `frontend/lexer.py` tokenizes source.
2. `frontend/parser.py` builds the syntax tree and rejects unsupported syntax.
3. `compiler/codegen.py` emits custom register-based instructions and function prototypes.
4. `bytecode/format.py` serializes the `LGVM` chunk; `bytecode/verifier.py` validates indexes, operands, jumps, and captures before execution.
5. `packager.py` embeds the prototypes into a standalone Luau runtime and maps opcode numbers per build seed.
6. The generated runtime dispatches each instruction, manages registers, function frames, closures/upvalues, global environment, and instruction/call-depth limits.

## Current runtime model

- Register-based frames, with one register slot per value.
- Explicit prototype metadata (`nparams`, `nregs`, constants, upvalue descriptors, instruction rows).
- Closure captures use shared cells so mutations are visible to sibling closures.
- A global instruction budget and maximum call depth.
- Per-build opcode ID permutation. This is diversification only, not encryption.
- Calls carry an explicit argument count, preserving interior and trailing `nil` arguments.

## Implementation boundary

The supported syntax remains a subset: arithmetic, comparisons, boolean logic, conditionals, `while`, numeric `for`, `repeat`, `break`, tables/indexing, functions/closures/upvalues, and selected operators. Varargs, multiple return values, generic iteration, type annotations, metatables, coroutines, and Roblox APIs are not implemented. The emitted script must be tested in the official Luau CLI or Roblox Studio before compatibility is claimed.

## Next engineering stages

1. Add an official Luau execution test harness for generated files.
2. Define and test exact Luau semantics for numeric edge cases, table length, string byte length, and error behavior.
3. Implement varargs and multiple return values with explicit result counts rather than Lua table length inference.
4. Add generic iteration and a controlled standard-library surface only after bytecode verification and execution limits cover the new instructions.
5. Benchmark dispatch and packaging size against a baseline before optimizing.
