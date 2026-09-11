# Solder

**Send money like a message.**

Solder is a mobile-first PWA for sending and receiving USDC on Ethereum that never asks you
to understand any of that. You pick a person, type an amount, and press send. No wallet
addresses, no seed phrase, no gas to think about.

<p align="center">
  <img src="apps/web/public/icon-192.png" width="96" alt="Solder icon">
</p>

## The three things that make crypto payments feel unlike messaging

| Friction | What Solder does instead |
| --- | --- |
| **Wallet addresses** | People have handles. You pay `@marco`, find friends by name, or share a link and a QR code. An account key exists, but it lives under Settings → Advanced and you never need it. |
| **Seed phrases** | Your key is generated in your browser and encrypted with a key derived from your **passkey** (WebAuthn PRF). The ciphertext is backed up to the server, which has no way to open it. There is no phrase, because there is nothing for you to memorise. |
| **Gas, ETH, "approve this transaction"** | Payments are **EIP-3009 authorisations**: you sign one off-chain and a relayer submits it and pays the gas. You never hold ETH and never see a fee. Confirming a payment is a Face ID prompt, not a signing dialog. |

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

USDC implements [EIP-3009](https://eips.ethereum.org/EIPS/eip-3009), which exists for exactly
this: you sign an authorisation naming a recipient and an amount, and *anyone* can submit it
on-chain and pay the gas. Because the signature covers the recipient and the amount, the
relayer paying that gas cannot redirect a single cent. It can publish the transfer you
authorised, or it can publish nothing.

```
  you                        server                          chain
   │                           │                              │
   │  POST /api/payments ──────▶                              │
   │                           │ resolves @handle, checks     │
   │                           │ balance + daily cap,         │
   │                           │ COMPOSES the authorisation   │
   │  ◀────── EIP-712 digest   │ and keeps it                 │
   │                           │                              │
   │ Face ID unlocks the key   │                              │
   │ secp256k1.sign(digest)    │                              │
   │                           │                              │
   │  POST …/submit ──────────▶│ rebuilds the authorisation   │
   │         (signature only)  │ from its OWN row, refuses    │
   │                           │ anything that differs, then  │
   │                           │ transferWithAuthorization ───▶
   │  ◀──── pending → confirmed│            (relayer pays gas)│
```

The nonce is derived from the payment's own id, so the server can rebuild the exact
authorisation later without storing anything extra, and two payments can never collide.
The client never chooses what it signs: it receives 32 bytes and returns 65.

Why not `permit` + `transferFrom`? A permit signature authorises an *allowance*, and the
relayer picks the recipient of the subsequent transfer. EIP-3009 binds the recipient into the
signature itself, which is the property worth having.

## Two ledgers, one contract

`ChainAdapter` (`apps/api/src/chain/types.ts`) has two implementations:

- **`SimulatedChain`** (default, `CHAIN=sim`) — a local SQLite ledger that builds the same
  EIP-712 digest and verifies **real secp256k1 signatures**, rejects replays and expired
  authorisations, and confirms on a short delay so the pending → confirmed transition in the
  UI is genuine. No network required.
- **`EthereumChain`** — real USDC via `viem`, calling `transferWithAuthorization` from a
  relayer that pays the gas.

Both hand the client the same thing: 32 opaque bytes to sign. One client code path, two
backends — so the security-critical logic is exercised by the test suite either way.

| `CHAIN` | Network | USDC |
| --- | --- | --- |
| `sim` | local, in-process | demo dollars |
| `base` | Base | `0x8335…2913` |
| `ethereum` | Ethereum mainnet | `0xA0b8…eB48` |
| `sepolia` | Ethereum Sepolia | `0x1c7D…7238` |
| `base-sepolia` | Base Sepolia | `0x036C…CF7e` |

Base is the sensible real target: identical USDC, gas a relayer can actually afford.

```bash
CHAIN=base-sepolia RPC_URL=https://sepolia.base.org \
RELAYER_PRIVATE_KEY=<32-byte hex key, funded with a little ETH> npm run dev
```

Two things to get right before real money:

- **Check the token address against [Circle's published list](https://developers.circle.com/stablecoins/usdc-contract-addresses).**
  The addresses above are from memory and are worth a minute of verification.
- **Use native USDC, not a bridged `USDC.e`.** Many bridged deployments do not implement
  EIP-3009, and without it there is no gasless path at all. The adapter reads `name`,
  `version` and `decimals` off the contract at startup and refuses a token whose decimals
  are not 6, but it cannot detect a missing EIP-3009 implementation until the first
  transfer reverts.

> **Honest caveat:** the on-chain path is written, type-checked, and its signing is verified
> against viem's reference implementation — but it has **never touched a real network**. The
> sandbox this was built in blocks outbound RPC. The simulated ledger is what the tests run
> against. Treat `EthereumChain` as code that needs its first real run on a testnet before
> you trust it with anything.

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

The browser never imports `viem`. It signs bytes with `@noble/curves/secp256k1`, so the PWA
ships without Buffer polyfills — the production bundle contains zero Ethereum client library.

## Tests

```bash
npm test     # 56 tests: money math, EIP-712, the jargon ban, auth, vault, payments, social
npm run e2e  # the real UI in Chromium at iPhone size, passkey included
```

The signing tests matter most, because those bytes are what a real contract would accept:
`eip3009.test.ts` checks the hand-rolled EIP-712 digest against **viem's independent
implementation**, proves every field is bound into it (change the recipient, the amount, the
deadline or the chain id and the digest moves), and confirms viem's `verifyTypedData` accepts
the signatures this app produces.

The payment tests prove the rest: a tampered authorisation is refused even when perfectly
signed, a signature from the wrong key is refused, an honest one goes through, replays and
expired authorisations are rejected, and a failed payment leaves the balance untouched. One
test asserts the server's vault table has no column that could hold a key.

There is also a test that walks every user-facing string and fails if a banned word
("seed phrase", "gas", "blockchain", …) appears — the no-jargon rule is enforced, not just
intended.

## Configuration

Everything has a working default; see `.env.example`. The ones that matter:

| Variable | Default | Notes |
| --- | --- | --- |
| `CHAIN` | `sim` | `sim`, `base`, `ethereum`, `sepolia`, `base-sepolia` |
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

An earlier version of this app targeted Solana, using the same `ChainAdapter` boundary with a
fee-payer model instead of EIP-3009. It is in the git history if you want it.
