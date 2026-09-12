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

## Leaving with your key

Self-custody you cannot exercise is just a nicer word for custody, so Settings → Advanced →
Export your key hands over the raw secp256k1 key as `0x`-prefixed hex, ready to paste into
any Ethereum wallet.

It is the one door in the app deliberately made awkward:

- A warning first, stating plainly that anyone holding the key can spend the money without
  any face or fingerprint check.
- **A fresh identity check every time.** `reauthenticate()` locks the wallet before unlocking
  it, so an already-unlocked session is never enough — someone who picks up an unlocked phone
  still cannot export.
- The key stays blurred until it is asked for a second time, and is dropped from memory when
  the sheet closes.
- It is derived and displayed entirely on the device. No endpoint returns it, and no request
  is made to show it. The server could not hand it over if it wanted to.

### What exporting gives up

**There is no way to un-export.** The exported key and the in-app account are the same
account, so from that moment two copies exist and Solder cannot tell whether the other one
has leaked. The app will keep working normally, which is exactly what makes this worth
stating.

A production version should offer rotation — generate a fresh key and sweep the balance to
it, so an exported key stops being live. That is not implemented. Until it is, treat an
export as permanent.

Copying to the clipboard is offered because it is what people actually need, but clipboards
persist and are readable by other apps on most platforms. The copy confirmation says to clear
it.

## Money sent to someone who has no account

A link is a bearer instrument, and it is worth being blunt about what that means.

The money goes to a holding account whose key is derived on the sender's device and carried
in the link's `#fragment`. Fragments are never sent to a server, so this server only ever
learns an address. Two people can move that money: whoever holds the link, and the sender,
whose device can re-derive the same key from their own key plus a stored salt (useless on its
own). The server can do neither — it can only pay the gas to publish a transfer one of them
has already signed.

The consequences follow from that, and they are the same as for cash:

- **Anyone who sees the link can take the money.** A link forwarded to the wrong group chat,
  or read off a screen, is gone. It is not addressed to a person, because at the moment of
  sending there is no person to address it to.
- **Links do not expire.** Money left in a holding account stays there until someone claims
  it or the sender takes it back. There is no sweep, and a forgotten link is forgotten money.
  A production version should expire them and reclaim automatically.
- **Picking up is first-come.** `lockClaim` is a conditional `UPDATE … WHERE status = 'open'`,
  so two simultaneous taps cannot both succeed, but the winner is whoever got there first.

The alternative — holding the funds ourselves until someone claims them — would make this
custodial, which is the thing the whole design is trying to avoid. This is the trade, made
deliberately.

## Sessions

A session token is 32 random bytes in an `HttpOnly`, `SameSite=Lax` cookie. Only its SHA-256
hash is stored, so a database leak cannot be replayed as a login. `secure` is set
automatically when `ORIGIN` is HTTPS. WebAuthn challenges are single-use and expire in five
minutes.

## The passkey domain

A passkey is bound to the domain the browser saw, so the server's idea of that domain has to
agree or every sign-in fails with *"the requested RPID did not match the origin"*. A value
fixed at boot is wrong the moment the app moves — a preview URL, a custom domain, a host that
hands out a name after the process starts — so unless `RP_ID` or `ORIGIN` is set, the server
takes it from each request: the browser's `Origin` header, or the proxy's `X-Forwarded-Host`
and `X-Forwarded-Proto` when there is no `Origin` (`relyingParty` in `routes/auth.ts`).

What that gives up: someone who can reach the server with a `Host` header of their choosing —
directly, or through a proxy that does not pin one — can have it issue and verify passkeys for
*their* domain. That does not get them into anyone's account. A credential is scoped by the
browser to the domain it was created on, so an assertion signed for `evil.example` can never
be replayed against the real one, and the victim's authenticator will not sign for a domain it
has no credential for. The worst of it is that an attacker can create accounts on this server
using passkeys only they can use — which is also true of simply signing up.

Set `RP_ID` (and `ORIGIN`) once the app has a domain it should stay on. Then the request is
ignored entirely, and a passkey created anywhere else is refused.

## The development sign-in

`POST /api/dev/login` hands out a session and a known key without a passkey. It is disabled
whenever `NODE_ENV=production`, regardless of what `DEV_LOGIN` says (`config.ts`), the route
is not registered when it is off, and the server logs a warning at boot when it is on. A test
asserts it returns 404 when disabled.

## Surprises

A gift's amount is withheld from the recipient by the server, not by the interface: until
they open it, `amountMicros` is `null` in every response and every live update they receive.
A test asserts the value does not appear anywhere in the payload. The sender always sees what
they sent, and the money moves on-chain immediately either way — only the telling is delayed,
and anyone reading the chain can see the amount.

## What is stored in plaintext

Handles, display names, account addresses, payment amounts, payment notes, chat messages,
reactions, group membership and group ledgers. Solder is not a private messenger. Notes are deliberately
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
