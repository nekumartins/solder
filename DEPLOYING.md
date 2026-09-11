# Deploying Solder

**The short version:** Vercel hosts the PWA beautifully, but the API cannot run there as
written. Deploy the web app to Vercel and the API to any host that runs a normal Node
process, then point one at the other. Both halves are set up for you below.

If you would rather have one thing to deploy, skip to [One container](#one-container).

## Why the API is not serverless

Four things in the API need a process that stays alive between requests:

| | |
| --- | --- |
| **SQLite on local disk** | `node:sqlite` writes to a file. Serverless filesystems are per-invocation and thrown away, so the ledger would vanish between requests. |
| **`/api/stream`** | Server-sent events hold a connection open for as long as the tab is. |
| **The payment watcher** | A `setInterval` advances payments from pending to confirmed every 400 ms. Nothing runs it if nothing is running. |
| **The realtime hub** | A `Map` of who is listening. Separate invocations do not share memory, so a payment published by one would never reach a tab connected to another. |

Making it serverless means Postgres instead of SQLite, polling or a hosted pub/sub instead of
SSE, and a cron instead of the watcher — a real rewrite that would also make `npm run dev`
worse. A $5 always-on container is the better trade for now.

## The Vercel half

`vercel.json` already builds the PWA (`npm run build` → `apps/web/dist`), routes every
client-side path to the app shell, and sets cache headers.

**One thing to edit before deploying:** the `/api/:path*` rewrite points at a placeholder.
Replace `REPLACE-WITH-YOUR-API-HOST` with your API's hostname.

The second rewrite sends everything else to the app shell, which is what makes `/@ana`,
`/c/<id>` and `/t/marco` work on a hard refresh. It cannot shadow real files: Vercel checks
the filesystem before applying rewrites, so `/assets/…` and `/sw.js` still serve themselves.
Order matters — the catch-all stays last.

Proxying `/api` through the Vercel domain rather than calling the API directly matters:

- the session cookie stays **first-party**, so `SameSite=Lax` keeps working and Safari's
  tracking prevention does not eat it
- **no CORS** to configure
- **passkeys bind to one domain** — WebAuthn ties credentials to the site you visit, so the
  browser must only ever see the Vercel origin

### If the build runs in the wrong place

Vercel's **Root Directory** setting decides where it installs and builds. It should be the
repository root — that is where `vercel.json` lives, and where `apps/web/dist` resolves from.

You can tell it is wrong from the build log: if it installs ~120 packages instead of ~550, or
runs a build for `@solder/api`, it is scoped to one workspace. Every workspace declares the
tools its own build needs, so that will not fail — but it will not produce the web app
either, because `outputDirectory` is relative to the root directory Vercel chose.

## The API half

Any host that runs a container and can mount a disk: Fly.io, Railway, Render, a VPS. The
`Dockerfile` at the repo root builds and runs it.

```bash
fly launch --dockerfile Dockerfile
fly volumes create solder_data --size 1     # SQLite lives here
fly secrets set ORIGIN=https://your-app.vercel.app RP_ID=your-app.vercel.app
```

**Mount the volume at `/app/data`.** Without it the database is inside the image and every
deploy silently resets everyone's balance.

### Environment

| Variable | Set it to | Why |
| --- | --- | --- |
| `NODE_ENV` | `production` | Turns the dev sign-in off for good, whatever `DEV_LOGIN` says. |
| `ORIGIN` | `https://your-app.vercel.app` | WebAuthn checks it, and it decides whether the cookie is `Secure`. Comma-separated for more than one. |
| `RP_ID` | `your-app.vercel.app` | The passkey's domain. **No scheme, no port.** |
| `DATABASE_PATH` | `/app/data/solder.db` | On the mounted volume. |
| `CHAIN` | `sim`, or `base` / `ethereum` / `sepolia` / `base-sepolia` | |
| `RPC_URL`, `RELAYER_PRIVATE_KEY` | your own | Required unless `CHAIN=sim`. |
| `DAILY_SEND_LIMIT_USD` | `500` | Per person, per day. |
| `RATE_LIMIT_MAX` | `120` | Per IP, per minute. Leave it alone in production. |

### Passkeys are bound to a domain

A passkey created on `solder-abc123.vercel.app` will not work on `solder.vercel.app`. Decide
the domain before anyone signs up, and set `RP_ID` to the bare domain people will actually
visit. Preview deployments each get their own hostname, so accounts made on one do not carry
across — expected, not a bug.

## One container

The API can serve the built PWA itself, which makes a single container the whole app — no
Vercel, one origin, nothing to proxy:

```bash
docker build -t solder .
docker run -p 8787:8787 -v solder-data:/app/data \
  -e ORIGIN=https://money.example.com -e RP_ID=money.example.com \
  solder
```

`SERVE_WEB=1` is already set in the image. Client-side routes fall through to the app shell;
unknown `/api` paths return JSON, not HTML.

Locally:

```bash
npm run build
SERVE_WEB=1 PORT=8080 ORIGIN=http://localhost:8080 npm start -w @solder/api
```

## Before you point anyone at it

- **`CHAIN=sim` mints demo money on request.** `/api/dev/fund` exists whenever the ledger is
  the local simulated one, because that is what makes the demo work. Nobody can lose anything
  real, but do not confuse it for a testnet.
- **Read [SECURITY.md](SECURITY.md).** Particularly the relayer's exposure and what a claim
  link gives away. Fund the relayer with only what you can afford to lose.
- **The on-chain path has never run against a real network.** See the README.
