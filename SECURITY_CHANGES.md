# Security update notes

## Added
- Cloudflare Turnstile browser gate for navigation and same-origin browser API calls, with a 30-minute signed HttpOnly clearance cookie.
- Server-side Turnstile Siteverify validation and hostname validation.
- D1 migration `0016_security_turnstile.sql` adding automatic ban expiry and security event records.
- Repeated invalid script-key handling: after 6 failures for the same IP/script within 10 minutes, create a session that only delivers harmless decoy Lua; after 8 failures, automatically block that IP for 72 hours.
- Six-part script delivery for key-protected scripts, using a 120-second session token hash stored in D1, ordered one-time chunk consumption, per-chunk license revalidation, and replay/out-of-order rejection.
- Disabled the legacy `/api/key-run` endpoint so it cannot return the entire protected script in one response.
- Added migration `0017_script_delivery_sessions.sql` for delivery-session state.
- Added migration `0018_served_script_integrity.sql`; the Worker records and checks a SHA-256 digest of the served obfuscated artifact before chunking it, and revokes the session if stored content changes.
- Repeated unauthorized API attempts can trigger a 72-hour IP block.
- `GET /api/security-events` for owner/admin audit review.
- `GET /api/health` now reports whether Turnstile is enabled.
- Aligned `wrangler.jsonc` and `wrangler.toml` bindings (`DB`, `BUCKET`, `ASSETS`) and settings.

## Required Cloudflare setup
1. Create a Turnstile widget allowing `jinhyuk.xyz`.
2. Add Worker variable `TURNSTILE_SITE_KEY` with the public site key.
3. Add Worker secret `TURNSTILE_SECRET_KEY` with the private secret key. CLI: `npx wrangler secret put TURNSTILE_SECRET_KEY`.
4. Keep `TURNSTILE_HOSTNAME=jinhyuk.xyz` for the production custom domain.
5. Apply D1 migrations, including `0016_security_turnstile.sql`, `0017_script_delivery_sessions.sql`, and `0018_served_script_integrity.sql`: `npx wrangler d1 migrations apply tm-db --remote`.
6. Deploy and verify `GET /api/health` returns `"turnstile":true`.
7. In Cloudflare Dashboard, enable **Security → Bots → Bot Fight Mode** separately. The Worker cannot switch this dashboard setting itself.

## Important limitations
- Turnstile stays disabled until both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are configured.
- Six-part delivery increases the effort needed to capture a full response and detects replay/order violations. A server-side SHA-256 check detects changes to the stored protected artifact, but it does not prevent a determined client from reconstructing code after all six chunks have been delivered. Server-side code cannot reliably detect every client-side memory dump or executor tool. The auto-ban logic responds to observable repeated invalid-key/authentication behavior.
- The existing editor sends source to the Worker on save so the Worker can store it in private R2 and produce the obfuscated copy. The public loader returns the protected copy, not the R2 raw object. If the requirement is literally that source must never be transmitted to the server at all, it cannot also be newly stored in R2 by that same workflow.
- No deployment was performed from this archive; apply the migration and set Cloudflare variables/secrets before relying on the new protections.
