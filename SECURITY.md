# Security model

Solder holds money, so it is worth being precise about who can do what. This document is
written to be read by someone deciding whether to trust it — including the parts that argue
against doing so.

**This is a prototype. It has not been audited, and its on-chain path has never run against
a real network. Do not put real money in it.**

## What the server can and cannot do

| | |
| --- | --- |
| **Can** | Refuse a payment, see who pays whom and how much, read notes and messages (they are stored in plaintext), delete your account, pay the gas to publish a transfer you authorised. |
| **Cannot** | Move your money. Redirect a payment you authorised. Decrypt your key backup. Produce a valid signature on your behalf. |

The private key is generated in your browser and encrypted there. The server stores a blob it
has no key for. `vault.ts` never parses it beyond checking it is JSON under 8 KB, and the
`vaults` table has exactly four columns — `user_id`, `blob`, `alg`, `updated_at` — a fact a
test asserts so it cannot quietly change.

## How the key is protected

1. A 32-byte secp256k1 key is generated with `crypto.getRandomValues`.
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

## Why EIP-3009, and not `permit`

The obvious gasless path on Ethereum is ERC-2612 `permit` plus `transferFrom`. It is the
wrong one here: a permit signature authorises an **allowance** to a spender, and whoever
holds that allowance chooses the recipient of the transfer that follows. The relayer would be
able to send your money wherever it liked.

EIP-3009's `transferWithAuthorization` binds `from`, `to`, `value`, a validity window and a
nonce into the signature itself. The relayer's only power is to publish that exact transfer,
or to publish nothing. That is a meaningfully smaller amount of trust.

## Why the server composes authorisations

The relayer pays the gas for every payment, which makes it a standing target.

So the client never composes what it signs. `POST /api/payments` builds the authorisation
server-side and stores the digest; the client receives 32 bytes and returns a 65-byte
signature. At submit time the adapter rebuilds the authorisation from the server's own row —
the ref, sender, recipient, amount and deadline it recorded — recomputes the digest, and
refuses to submit if the bytes differ by so much as one bit. Both adapters do this; it is not
a property of the chain, it is a property of the flow.

The nonce is `keccak256("solder-authorization:" + eventId)`. EIP-3009 nonces need only be
unique per sender, never sequential, so there is no nonce queue to manage and no ordering to
get wrong under concurrency.

Additional limits: a per-person daily cap (`DAILY_SEND_LIMIT_USD`, default $500), 20 payment
creations per minute, 120 requests per minute overall.

### Residual relayer exposure

The relayer pays gas per payment and holds ETH to do it. Someone with many accounts can burn
that balance within the rate limits, and on mainnet a gas spike makes each payment cost real
money. A production deployment needs invite gating, per-account budgets, and a gas ceiling
above which payments queue rather than send. None of that is implemented here. Fund the
relayer with only what you can afford to lose, and prefer an L2 where a transfer costs
fractions of a cent.

Note that a failed or front-run submission costs the relayer gas but cannot cost the *sender*
anything: an unsubmitted authorisation simply expires.

## Replay, tampering and expiry

- Authorisations carry a `validBefore` 60 seconds out, enforced both by the server and by the
  token contract itself.
- `consumePrepared` is a conditional `UPDATE … WHERE consumed = 0`, so only the first submit
  for a payment can proceed even under concurrent requests.
- The token contract records every used nonce, so an authorisation cannot be replayed
  on-chain even if someone captures it. The adapter checks `authorizationState` before
  submitting, which turns a guaranteed revert into a clean error instead of wasted gas. The
  simulated ledger enforces the same uniqueness on the payment reference.
- The digest includes the chain id and the token's address, so a signature made for one
  network or one token is meaningless on any other.
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

Handles, display names, account addresses, payment amounts, payment notes, chat messages,
reactions and split membership. Solder is not a private messenger. Notes are deliberately
kept off-chain so they are not published to the world, but the server can read them.

On-chain, every payment is a public `Transfer` between two addresses. Handles are not on
chain, but anyone who learns one person's address can read their whole payment history and
balance. Real privacy would need a different design; this is the normal state of affairs for
a token on a public ledger, and it is worth being clear that Solder does not fix it.

## Dependencies

`npm audit` reports zero vulnerabilities. `viem` is server-only and lazily imported, so the
default `CHAIN=sim` setup never loads it and no Ethereum client library reaches the browser
bundle. The client's cryptography is `@noble/curves` and `@noble/hashes` — small, audited, and
the same primitives the server verifies with.

The EIP-712 encoding is hand-written (`apps/api/src/chain/eip3009.ts`) so the exact bytes
being signed are readable in one file rather than assembled inside a dependency. It is
checked against viem's implementation in the test suite; if the two ever disagree, the tests
fail.

## Reporting

This is a prototype built to explore an interaction model. If you find something, open an
issue — but please do not deploy it to mainnet and then be surprised.
