# Security model

Solder holds money, so it is worth being precise about who can do what. This document is
written to be read by someone deciding whether to trust it — including the parts that argue
against doing so.

**This is a prototype. It has not been audited. Do not put real money in it.**

## What the server can and cannot do

| | |
| --- | --- |
| **Can** | Refuse a payment, see who pays whom and how much, read notes and messages (they are stored in plaintext), delete your account, pay the network fee for a transfer it composed. |
| **Cannot** | Move your money. Decrypt your key backup. Produce a valid signature on your behalf. |

The private key is generated in your browser and encrypted there. The server stores a blob it
has no key for. `vault.ts` never parses it beyond checking it is JSON under 8 KB, and the
`vaults` table has exactly four columns — `user_id`, `blob`, `alg`, `updated_at` — a fact a
test asserts so it cannot quietly change.

## How the key is protected

1. A 32-byte ed25519 seed is generated with `crypto.getRandomValues`.
2. Your passkey's **PRF extension** produces 32 bytes for the fixed input `"solder-vault-v1"`.
   That output never leaves the device.
3. `HKDF-SHA256(prf, salt, "solder-vault-v1")` → an AES-GCM-256 key → the seed is encrypted.
4. The ciphertext goes to IndexedDB and to the server as a backup.

A new device repeats steps 2–4 in reverse: same passkey, same PRF output, same key, backup
decrypts. This is why there is no seed phrase — the phrase's job (moving your key to a new
device) is done by the passkey, which the platform already syncs and backs up.

The unlocked seed lives in memory for five minutes and is zeroed on lock. It is never written
anywhere in plaintext.

### The PIN fallback is weaker, and here is how

Some browsers and authenticators do not support PRF. Those users get a 6-digit PIN instead:
`PBKDF2-SHA256`, 600,000 iterations. This is meaningfully weaker than the PRF path — six
digits is a million possibilities, and anyone who obtains the stored blob can grind it
offline at their leisure. Server-side rate limiting on `GET /api/vault` (10 requests per 15
minutes) slows down *getting* the blob; it does nothing once someone has it.

The app only offers the PIN path when PRF is genuinely unavailable. If you are deploying this
for real, consider requiring PRF outright.

## Why the server composes transactions

The relayer pays the fee for every payment, which makes it a standing target: anyone who can
get it to sign arbitrary bytes can drain its SOL, or worse.

So the client never composes what the relayer signs. `POST /api/payments` builds the transfer
server-side and stores the message bytes; the client returns only a signature. At submit
time the adapter re-derives what those bytes must say from the server's own row:

- **`SimulatedChain`** rebuilds the canonical message string from the stored ref, sender,
  recipient and amount, and compares byte-for-byte.
- **`SolanaChain`** decompiles the versioned message and checks: no address-table lookups,
  exactly two required signers, fee payer is the relayer, second signer is the sender, and
  every instruction is either an idempotent ATA creation for the expected recipient or a
  single `TransferChecked` with the expected mint, decimals, amount, source and destination.
  Anything else is refused.

Additional limits: a per-person daily cap (`DAILY_SEND_LIMIT_USD`, default $500), 20 payment
creations per minute, 120 requests per minute overall.

### Residual relayer exposure

The relayer still pays rent for a token account the first time anyone receives money, and a
fee per payment. Someone with many accounts can burn the relayer's SOL within the rate limits.
A production deployment needs invite gating, a funded-account requirement, or per-account
budgets. None of that is implemented here.

## Replay, tampering and expiry

- Prepared transfers expire after 60 seconds (matching a Solana blockhash lifetime).
- `consumePrepared` is a conditional `UPDATE … WHERE consumed = 0`, so only the first submit
  for a payment can proceed even under concurrent requests.
- The simulated ledger enforces a unique constraint on the payment reference, so the same
  transfer cannot land twice.
- A transfer nobody signs is reaped along with its event, so a cancelled biometric prompt
  leaves no trace.

## Sessions

A session token is 32 random bytes in an `HttpOnly`, `SameSite=Lax` cookie. Only its SHA-256
hash is stored, so a database leak cannot be replayed as a login. `secure` is set
automatically when `ORIGIN` is HTTPS. WebAuthn challenges are single-use and expire in five
minutes.

## The development sign-in

`POST /api/dev/login` hands out a session and a known key without a passkey. It is disabled
whenever `NODE_ENV=production`, regardless of what `DEV_LOGIN` says (`config.ts`), the route
is not registered when it is off, and the server logs a warning at boot when it is on. A test
asserts it returns 404 when disabled.

## What is stored in plaintext

Handles, display names, account public keys, payment amounts, payment notes, chat messages,
reactions and split membership. Solder is not a private messenger. Notes are deliberately
kept off-chain so they are not published to the world, but the server can read them.

## Known dependency advisories

`@solana/web3.js` v1 pulls in `bigint-buffer`, `stream-json` and `uuid` versions with open
advisories. They are transitive and unfixable without abandoning web3.js v1. They are
**server-only** and the adapter is **lazily imported**, so the default `CHAIN=sim` setup never
loads any of them, and no Solana code reaches the browser bundle at all.

## Reporting

This is a prototype built to explore an interaction model. If you find something, open an
issue — but please do not deploy it to mainnet and then be surprised.
