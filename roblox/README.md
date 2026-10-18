# Roblox Studio validation

The CI environment can validate Python and Worker code, but it cannot launch Roblox Studio. This manual harness is the boundary for actual Roblox runtime validation.

1. Build a generated standalone package with `python3 -m cli pack sample.lua output.lua` or use the Worker-generated payload.
2. In a **private test place**, create `ServerStorage/TMGeneratedPayload` as a `ModuleScript` and paste the generated payload into it. It must return the generated runner function.
3. Add `StudioSmokeTest.server.lua` to `ServerScriptService` and run Play/Test in Roblox Studio.
4. Save the Output window logs and any errors with the tested payload's hash and Roblox Studio version.

This checks only the payload that was inserted. A passing native-Luau check alone does not establish that the custom VM supports full Luau syntax or Roblox APIs. Do not use a real paid script or production place for this test.
