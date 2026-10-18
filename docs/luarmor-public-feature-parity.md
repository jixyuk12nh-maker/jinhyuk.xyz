# Public Luarmor feature-parity matrix

This matrix is based only on public Luarmor documentation. It does not describe or reproduce private source code, anti-tamper algorithms, bytecode formats, or proprietary internals.

| Public-facing capability | TM project status after Phase 15 | Remaining work |
|---|---|---|
| Projects grouping scripts and keys | Partial: developer ownership and product records exist | Add project CRUD and multi-script project membership instead of one product tied to one script |
| Stable loader URL across script updates | Partial: owner-scoped URL remains stable by username/script name | Add versioning, rollback, and a deliberate rename/migration policy |
| License/key creation | Implemented for active owned products | Add bulk generation, key labels/notes, list/search UI |
| Expiry and revocation | Implemented in D1 checks and management API | Add automated cleanup/reporting and more expiry edge-case tests |
| Place ID restrictions | Implemented as an optional allowlist | Treat as client-supplied filter only; it can be spoofed |
| HWID/device binding and reset | Not implemented | Define privacy policy, reset cooldown, reliable platform-specific identity semantics; do not use spoofable client strings as strong identity |
| Heartbeat / periodic revalidation | Not implemented | Add short-lived signed delivery grants and periodic server checks only where the target runtime supports them reliably |
| Webhooks / audit notifications | Event rows exist for loader actions | Add configurable webhook destinations, SSRF protections, signing, retry and rate limits |
| FFA / Silent / Lightning modes | Not implemented | Decide explicit product semantics before implementing; these are not assumed equivalent based on their names |
| Admin vs developer management | Implemented as D1 admin role + per-developer API tokens and owner-scoped operations | Add full browser sessions, token rotation/revocation, audit trails, rate limits, and recovery workflows |
| Obfuscation / anti-dump | Prototype only | Do not claim equivalence to a mature commercial protector; client-delivered code and decode logic can be inspected |
