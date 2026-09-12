# Deploying Solder

**The short version:** the API needs a host that runs an ordinary Node process, because it
keeps a SQLite file, holds connections open, and runs a background watcher. Vercel cannot do
that; Railway, Fly and Render can.

**The fastest working deployment is one service on Railway** — it serves the PWA and the API
together on one origin, with nothing to proxy. Skip to
[Railway from GitHub](#the-api-half-railway-from-github).

Using Vercel for the front end as well works too, and is set up below.

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

### `No Output Directory named "dist" found after the Build completed`

The Root Directory is wrong. Vercel reads `vercel.json` **from the Root Directory**, so with
it set to a workspace, the config at the repository root is never read at all — which is why
Vercel falls back to looking for a plain `dist` instead of the `apps/web/dist` the file asks
for.

**Project → Settings → General → Root Directory.** Clear it so it points at the repository
root, then redeploy.

Other signs of the same thing in the build log: an install of ~120 packages instead of ~550,
or a build running for `@solder/api`. Every workspace declares the tools its own build needs,
so that no longer errors — but it cannot produce the web app either.

Note that `apps/api` is not a Vercel target at all. It has no web output to serve, and it
could not run there anyway — see the table above.

## The API half: Railway from GitHub

`railway.json` pins the build to the `Dockerfile` and points the healthcheck at `/api/health`,
so this is close to click-and-wait.

1. **New Project → Deploy from GitHub repo**, pick this repo and the branch.
2. Railway reads `railway.json`, builds the `Dockerfile`, and waits for `/api/health`.
3. **Settings → Networking → Generate Domain.**

That is enough for a working app. The image sets `SERVE_WEB=1`, so the service serves the PWA
as well as the API — **the Railway URL on its own is the whole thing**, on one origin, with
nothing to proxy and no Vercel involved.

You do not need to set `ORIGIN` or `RP_ID`. Left unset, the server takes the passkey domain
from each request, so passkeys bind to whatever hostname the browser actually visited —
the URL Railway generated, or a custom domain added later, without a redeploy. Setting
either by hand pins it to that value instead and the request is ignored; do that once the
app has a domain it should stay on. See [SECURITY.md](SECURITY.md#the-passkey-domain) for
what following the request gives up.

### Add a volume, or the ledger resets

**Settings → Volumes → add one, mounted at `/app/data`.**

Without it SQLite lives inside the container, and every redeploy silently starts everyone
back at zero. It will appear to work, which is what makes it worth doing first.

### If you also want the Vercel front end

Only then do you need to set things by hand, because the domain people visit is no longer the
one Railway named:

| On Railway | Set to |
| --- | --- |
| `ORIGIN` | `https://your-app.vercel.app` |
| `RP_ID` | `your-app.vercel.app` |

and point the `/api/:path*` rewrite in `vercel.json` at the Railway domain. Passkeys bind to
one domain, so pick which one is the real front door before anyone signs up — an account made
on the Railway URL will not work on the Vercel one.

### About the free tier

Railway retired its perpetual free tier; what is on offer is a limited trial credit, and
volumes may need a paid plan. Check before relying on it. The same `Dockerfile` runs on
Fly.io or Render unchanged — note that Render's free instances have no persistent disk, so
the ledger would reset there for the same reason a missing volume does here.

### Environment

Everything has a working default. These are the ones worth knowing:

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | injected by the host | Falls back to 8787. The app binds `0.0.0.0`. |
| `ORIGIN` | the domain of the request | WebAuthn checks it, and it decides whether the cookie is `Secure`. Comma-separated for more than one. |
| `RP_ID` | the domain of the request | The passkey's domain. **No scheme, no port.** Setting it pins the app to that one domain. |
| `DATABASE_PATH` | `/app/data/solder.db` | Set by the image. Mount the volume there. |
| `NODE_ENV` | `production` | Set by the image. Turns the dev sign-in off for good. |
| `CHAIN` | `sim` | Or `base` / `ethereum` / `sepolia` / `base-sepolia`. |
| `RPC_URL`, `RELAYER_PRIVATE_KEY` | — | Required unless `CHAIN=sim`. |
| `DAILY_SEND_LIMIT_USD` | `500` | Per person, per day. |
| `RATE_LIMIT_MAX` | `120` | Per IP, per minute. Leave it alone in production. |

## One container, anywhere

The same image runs outside Railway:

```bash
docker build -t solder .
docker run -p 8787:8787 -v solder-data:/app/data \
  -e ORIGIN=https://money.example.com -e RP_ID=money.example.com \
  solder
```

Client-side routes fall through to the app shell; unknown `/api` paths return JSON, not HTML.

Locally, without Docker:

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
