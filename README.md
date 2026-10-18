# TM Lua Host

A new Lua/Luau source-hosting app built from scratch, using Cloudflare Workers + D1 + R2. Inspired by public file-publishing projects such as `jonomatusky/drop` and `raveli/agent2web`; this is an original minimal implementation, not a copy of their code.

## Features
- Dark glass UI for listing, creating, editing and deleting hosted scripts.
- D1 stores metadata; R2 stores script source.
- Public raw delivery at `/raw/<id>`.
- Bearer-token protection for create/edit/delete. Public read-only list and raw endpoints.
- SHA-256 hash and byte-size metadata.

## Cloudflare resources configured from your prior settings
- Worker: `tm`
- D1 database name: `tm-db`
- D1 database ID: `9951ea1d-ab4d-44a8-8ba5-9e962092cf82`
- R2 bucket configured as `jinhyuk--xyz` (confirm this bucket actually exists in your Cloudflare account before deploy).

The project does not import the previous app's UI, routes, tables, authentication, or business logic. The migration creates only `hosted_scripts`. Back up the D1 database before applying any migration. Do not point this at a database containing valuable data without reviewing the migration first.

## Deploy from Android / Termux or a computer
1. Extract the ZIP into a writable folder (not Android shared storage if npm has permission errors).
2. Install Node.js/npm and run `npm install`.
3. Confirm the D1 ID and R2 bucket name in `wrangler.jsonc`.
4. In Cloudflare dashboard, create the R2 bucket `jinhyuk--xyz` if it does not exist, or change the config to the bucket you intend to use.
5. Set a strong Worker secret named `ADMIN_TOKEN`. With Wrangler: `npx wrangler secret put ADMIN_TOKEN`.
6. Apply the new schema: `npx wrangler d1 migrations apply tm-db --remote`.
7. Run `npm run check`, then `npm run deploy`.
8. Open `/api/health`; verify `database`, `storage`, and `adminConfigured` are true.

If deploying from Cloudflare Workers Builds, configure the same bindings and secret in the dashboard and apply `migrations/0001_hosted_scripts.sql` to the intended D1 database before testing.

## Admin token use
The UI sends the token as `Authorization: Bearer <token>` for write actions. Enter only the token value in the UI, not the word `Bearer`. Anyone who knows the token can upload, edit, or delete scripts, so do not expose it or put it into client-side source files. It is sent from the browser to your own Worker only when you use admin actions; avoid using the admin page on shared devices.

## Example loader URL
After a script is registered, the UI gives a URL like `https://YOUR-DOMAIN/raw/<id>`. An executor that supports the relevant APIs may use:

```lua
loadstring(game:HttpGet("https://jinhyuk.xyz/rivals"))()
```

This is only a format example; support depends on the runtime. Raw URLs are public and unguessable IDs are not access control. Do not host secrets, credentials, private keys, or code you do not have permission to publish.

## Routes
- `GET /api/health` — service/binding status
- `GET /api/scripts` — metadata list
- `POST /api/scripts` — create (Bearer token required)
- `PATCH /api/scripts/:id` — update (Bearer token required)
- `DELETE /api/scripts/:id` — delete (Bearer token required)
- `GET /raw/:id` — raw text source

## Important limitations
This is a functional starter, not a hardened multi-user service. The admin token is a single shared credential; there is no per-user account system, rate limiting, revision history, moderation, or audit log. Add these before allowing untrusted people to access the admin endpoints. Public raw delivery means anyone with the URL can retrieve the source.


## Owner-only publishing and custom URL names

Publishing, editing, and deleting require the `ADMIN_TOKEN` Worker secret. Set it in Cloudflare Workers > Settings > Variables and Secrets. Do not put the token in source code or share it. Public raw delivery uses `GET /{slug}`; choose a slug containing letters, numbers, `_` or `-`, e.g. `https://jinhyuk.xyz/my-script`.

For an existing database that already has `hosted_scripts`, apply migration `0002_script_slugs.sql` once in the `tm-db` SQL Console. It adds the `slug` column, assigns existing rows their ID as the initial slug, and creates a unique index. Then deploy the updated Worker and assets.
