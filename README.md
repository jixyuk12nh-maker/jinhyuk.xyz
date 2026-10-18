# TM Script Host — new project

A new minimal script-hosting site. Existing Cloudflare resource identifiers are reused, but no application code, UI, or database tables from the old project are copied. Script source text is stored in the configured R2 bucket; D1 stores only metadata.

## Cloudflare resources configured

- Worker name: `tm`
- D1 binding: `DB`
- D1 database name: `tm-db`
- D1 database ID: `9951ea1d-ab4d-44a8-8ba5-9e962092cf82`
- R2 binding: `SCRIPTS`
- R2 bucket name: `jinhyuk--xyz` (taken from the old project's `wrangler.toml`; confirm this bucket still exists in the same Cloudflare account)
- Static assets: `./public`, binding `ASSETS`

The new app uses a separate D1 table named `hosted_scripts` so it does not collide with an existing `scripts` table from the old application. The migration creates only this new table and its index.

## Deploy

1. Upload this ZIP's contents to the root of the new GitHub repository.
2. Connect the repository to Cloudflare Workers Builds.
3. Use `npm install` as the build command and `npx wrangler deploy` as the deploy command, or use the repository's configured workflow.
4. Apply the migration to the existing D1 database:
   `npx wrangler d1 migrations apply DB --remote`
   If you only use the Cloudflare dashboard, run `migrations/0001_init.sql` in the D1 console.
5. Open `/api/health`. It reports whether D1 and R2 bindings can be reached.
6. Create a test script, then open its generated `/raw/{id}` URL to confirm it returns the source text.

Do not run `wrangler d1 create` or `wrangler r2 bucket create` for these existing resources. If the R2 bucket name is not present in the same Cloudflare account, update `bucket_name` to the real existing bucket name or create a separate bucket deliberately.

## Features

- Responsive dark dashboard
- Create, list, edit, and delete script metadata in D1
- Store source text in R2
- Public raw text route `/raw/{id}`
- 256 KiB source limit
- Copy raw URL and loader example from the UI

## Loader example

```lua
loadstring(game:HttpGet("https://YOUR-WORKER-DOMAIN/raw/YOUR_SCRIPT_ID"))()
```

This is only a loader-format example. Support depends on the target runtime's `HttpGet` and `loadstring` capabilities; compatibility with third-party executors is not guaranteed.

## Security limitations

This starter has no authentication or authorization. Anyone who can reach the write APIs may create, edit, or delete scripts. Do not use it for private or paid scripts until access control, rate limiting, and abuse protection are implemented. Public raw URLs are readable by anyone who knows the URL.
