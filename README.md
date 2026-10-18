# Script Vault — Cloudflare starter

A minimal script-hosting panel built with Cloudflare Workers, D1, and R2-ready configuration. This starter stores source text in D1 and provides a public raw-text URL. The R2 bucket is configured for the next storage step but is not used by this first version.

## Features

- Dark responsive dashboard
- Create, list, edit, and delete scripts
- Unique public URL per script: `/raw/{id}`
- Raw URL returns the source as `text/plain`
- Copy URL and one-line loader text from the UI
- 256 KB upload limit

## Deploy from a phone or computer using the Cloudflare dashboard

1. Create a GitHub repository and upload the contents of this ZIP to its root.
2. In Cloudflare, create a D1 database named `script-hosting-db`.
3. Create an R2 bucket named `script-hosting-files`.
4. Open `wrangler.toml` and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the database ID shown by Cloudflare.
5. Connect the GitHub repository in Cloudflare Workers & Pages, choose **Workers**, and configure the build command as `npm install` and deploy command as `npx wrangler deploy` if the dashboard asks for commands.
6. Apply the migration from the project using Wrangler: `npx wrangler d1 migrations apply DB --remote`. If using a dashboard-only workflow, run the SQL in `migrations/0001_init.sql` in the D1 console instead.
7. Deploy. Open `/api/health`; it should return `{"ok":true,"service":"script-hosting-starter"}`.
8. Open the site, create a script, and test the generated `/raw/...` URL. It should show the source code as plain text.

## Local CLI deploy

Install Node.js, then run:

```sh
npm install
npx wrangler login
npx wrangler d1 create script-hosting-db
npx wrangler r2 bucket create script-hosting-files
```

Copy the D1 database ID into `wrangler.toml`, then run:

```sh
npm run db:migrate:remote
npm run deploy
```

For local preview, use `npm run db:migrate:local` then `npm run dev`.

## Loader snippet

The UI displays a loader line in the form below for compatible Luau execution environments:

```lua
loadstring(game:HttpGet("https://YOUR-WORKER-DOMAIN/raw/YOUR_SCRIPT_ID"))()
```

Replace the placeholder URL with the URL issued by your deployed site. Support depends on the execution environment and its `HttpGet`/`loadstring` capabilities; this project cannot guarantee compatibility with a specific third-party executor.

## Important security notes

- The raw URL is public and anyone who has it can read the script.
- This MVP has no login or access control. Do not upload secrets, tokens, private keys, or code you do not have permission to distribute.
- Anyone with API access can create, modify, or delete scripts. Add authentication before using it for sensitive or production content.
- This version does not obfuscate, compile, or package scripts into a VM.
