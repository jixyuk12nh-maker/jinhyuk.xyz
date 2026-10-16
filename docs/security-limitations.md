# Security and compatibility limitations

tm VM is a prototype. It does not create a trusted execution boundary on a user's client, and it cannot guarantee that source logic or embedded constants will remain secret.

Each generated build now applies several reversible transformations: opcode IDs are permuted and affine-encoded, instruction operands are masked using per-build keys plus instruction-position-dependent offsets, and string constants are stored as XOR-masked UTF-8 bytes and decoded at runtime. A seed makes a build reproducible; omitting it chooses fresh parameters.

These are obfuscation layers, not cryptographic secrecy. The keys and decoding logic must run on the client and can be recovered by a determined analyst. Numeric constants and runtime behavior can still be inspected, and decrypted strings can be captured during execution. This is a stronger baseline than plain opcode permutation, not a claim of equivalence to a mature commercial protector.

The Python VM is not runnable inside Roblox. The `pack` command emits an experimental Luau interpreter for the supported custom-bytecode subset, but the generated output has not been verified in Roblox Studio or against an official Luau runtime in this environment. Test output in a controlled environment before using it.

Unsupported or incomplete features include varargs, multiple returns, generic iteration, full standard-library behavior, metatables, coroutines, type annotations, and Roblox APIs (`game`, `Instance`, `task`, services). The generated runtime may also differ from the Python VM on error details, table edge cases, number formatting, and native behavior.

Execution-step and call-depth limits mitigate accidental runaway code in the generated interpreter but do not replace a complete sandbox. Do not run untrusted scripts with privileged host capabilities.
