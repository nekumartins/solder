# Solder

**Send money like a message.**

Solder is a mobile-first PWA for sending and receiving USDC on Solana that never asks you
to understand any of that. You pick a person, type an amount, and press send. No wallet
addresses, no seed phrase, no network fees to think about.

<p align="center">
  <img src="apps/web/public/icon-192.png" width="96" alt="Solder icon">
</p>

## The three things that make crypto payments feel unlike messaging

| Friction | What Solder does instead |
| --- | --- |
| **Wallet addresses** | People have handles. You pay `@marco`, find friends by name, or share a link and a QR code. An account key exists, but it lives under Settings → Advanced and you never need it. |
| **Seed phrases** | Your key is generated in your browser and encrypted with a key derived from your **passkey** (WebAuthn PRF). The ciphertext is backed up to the server, which has no way to open it. There is no phrase, because there is nothing for you to memorise. |
| **Gas, SOL, "approve this transaction"** | A **fee-sponsoring relayer** pays the network fee and creates token accounts. You never hold SOL and never see a fee. Confirming a payment is a Face ID prompt, not a signing dialog. |

Every payment is a message in a conversation. Notes, emoji, reactions, money requests you
settle with one tap, and bills split across a table — all in the same thread.

## Try it in 60 seconds

```bash
npm install
npm run seed     # four demo people with a few weeks of plausible history
npm run dev      # API on :8787, app on http://localhost:5173
```

Open <http://localhost:5173>, create an account with a passkey, and send `@marco` a few
dollars. Or sign in as the seeded `@ana` from the browser console:

```js
await fetch('/api/dev/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ handle: 'ana' }), credentials: 'include',
}).then(() => location.reload());
```

**On your phone:** run `npm run dev -- --host`, open the printed LAN address, and add it to
your home screen. Passkeys need a secure context, so either use `localhost` or put it behind
HTTPS.

## How a payment actually works

The client never composes what the relayer signs. That is the whole security posture in one
sentence.

```
  you                        server                         ledger
   │                           │                              │
   │  POST /api/payments ──────▶                              │
   │                           │ resolves @handle, checks     │
   │                           │ balance + daily cap,         │
   │                           │ COMPOSES the transfer and    │
   │  ◀──────── message bytes  │ keeps the bytes              │
   │                           │                              │
   │ Face ID unlocks the key   │                              │
   │ ed25519.sign(those bytes) │                              │
   │                           │                              │
   │  POST …/submit ──────────▶│ re-derives what the bytes    │
   │         (signature only)  │ MUST say from its own row    │
   │                           │ and refuses anything else,   │
   │                           │ then co-signs as fee payer ──▶
   │  ◀──── pending → confirmed│                         ◀────│
```

Because the server authors the bytes and verifies them against its own record before adding
the fee-payer signature, a malicious client cannot smuggle an extra instruction past the
relayer. The simulated ledger proves this by string comparison; the Solana adapter decompiles
the transaction message and checks every instruction, account, mint and amount.

## Two ledgers, one contract

`ChainAdapter` (`apps/api/src/chain/types.ts`) has two implementations:

- **`SimulatedChain`** (default, `CHAIN=sim`) — a local SQLite ledger that verifies **real
  ed25519 signatures**, rejects replays and expired transfers, and confirms on a short delay
  so the pending → confirmed transition in the UI is genuine. No network required.
- **`SolanaChain`** (`CHAIN=devnet` or `CHAIN=mainnet`) — real USDC via `@solana/web3.js` and
  `@solana/spl-token`, with the relayer as fee payer and idempotent token-account creation.

Both hand the client the same thing: opaque base64 bytes to sign. One client code path, two
backends — so the security-critical logic is exercised by the test suite either way.

To use real devnet USDC:

```bash
CHAIN=devnet SOLANA_RPC_URL=https://api.devnet.solana.com \
RELAYER_SECRET_KEY=<base58 64-byte key, funded with a little SOL> npm run dev
```

> **Honest caveat:** the devnet path is written and type-checked but was **not exercised**
> during development — the sandbox this was built in blocks outbound connections to
> `api.devnet.solana.com`. The simulated ledger is what the tests run against. Treat the
> Solana adapter as code that needs its first real run before you trust it with anything.

## Layout

```
packages/shared/     money math (bigint micro-USDC), handle rules, DTOs, the copy deck
apps/api/            Fastify 5 + node:sqlite
  src/chain/         the two ledger adapters
  src/routes/        auth, vault, users, threads, payments, requests, splits, stream
apps/web/            React 19 + Vite, plain CSS, vite-plugin-pwa
  src/lib/           api, passkey, vault crypto, wallet session, store, SSE
  src/screens/       welcome, claim, home, thread, pay, people, split, scan, profile, settings
scripts/e2e.mjs      drives the real app in Chromium with a virtual passkey authenticator
```

The browser never imports `@solana/web3.js`. It signs bytes with `@noble/curves`, so the PWA
ships without Buffer polyfills — the production bundle contains zero Solana code.

## Tests

```bash
npm test     # 50 tests: money math, the jargon ban, auth, vault, payments, social
npm run e2e  # the real UI in Chromium at iPhone size, passkey included
```

The payment tests prove the parts that matter: tampered message bytes are refused, a
signature from the wrong key is refused, an honest one goes through, replays and expired
transfers are rejected, and a failed payment leaves the balance untouched. One test asserts
the server's vault table has no column that could hold a key.

There is also a test that walks every user-facing string and fails if a banned word
("seed phrase", "gas", "blockchain", …) appears — the no-jargon rule is enforced, not just
intended.

## Configuration

Everything has a working default; see `.env.example`. The ones that matter:

| Variable | Default | Notes |
| --- | --- | --- |
| `CHAIN` | `sim` | `sim`, `devnet`, or `mainnet` |
| `DAILY_SEND_LIMIT_USD` | `500` | Per-person cap, enforced server-side |
| `DEV_LOGIN` | `1` | Shortcut sign-in for tests. Ignored when `NODE_ENV=production` |
| `RP_ID` / `ORIGIN` | `localhost` / `http://localhost:5173` | WebAuthn relying party. `ORIGIN` accepts a comma-separated list |

## Not built yet

- **Paying someone who hasn't joined.** It needs escrow and custody, so it is deliberately
  out of scope rather than half-built. Today you can only pay a claimed handle.
- Contact import, multiple currencies, a fiat on-ramp, push notifications.

## Status

A working prototype, not an audited product. It defaults to a local simulated ledger for a
reason — read [SECURITY.md](SECURITY.md) before pointing it at real money.
