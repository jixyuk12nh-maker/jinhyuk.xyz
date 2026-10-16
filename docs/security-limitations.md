# Security and compatibility limitations

tm VM is a prototype. It does not create a trusted execution boundary on a user's client, and it cannot guarantee that source logic or embedded constants will remain secret.

Opcode permutation changes numeric opcode IDs between generated builds. It does not encrypt bytecode, and the mapping can be recovered by analyzing the generated interpreter. It should not be advertised as equivalent to a mature commercial protector.

The Python VM is not runnable inside Roblox. The `pack` command emits an experimental Luau interpreter for the supported custom-bytecode subset, but the generated output has not been verified in Roblox Studio or against an official Luau runtime in this environment. Test output in a controlled environment before using it.

Unsupported or incomplete features include varargs, multiple returns, generic iteration, full standard-library behavior, metatables, coroutines, type annotations, and Roblox APIs (`game`, `Instance`, `task`, services). The generated runtime may also differ from the Python VM on error details, table edge cases, number formatting, and native behavior.

Execution-step and call-depth limits mitigate accidental runaway code in the generated interpreter but do not replace a complete sandbox. Do not run untrusted scripts with privileged host capabilities.
