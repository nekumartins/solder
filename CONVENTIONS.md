# Working on Solder

Conventions that are load-bearing. Breaking one of these breaks something real.

## Money is always bigint micro-USDC

1 USDC = `1_000_000n`. Never a float, never a `number`. Over the wire amounts are decimal
strings (`"12500000"`), parsed with `BigInt()` at the edges. `packages/shared/src/money.ts`
owns parsing and formatting; use it rather than writing arithmetic inline.

## The browser must never import `viem`

It is API-only and lazily imported (`apps/api/src/chain/index.ts`), so the default simulated
setup never loads it. The client signs 32 opaque bytes with `@noble/curves/secp256k1`. If you
find yourself adding a Node polyfill to the Vite config, the boundary has been crossed
somewhere — find it instead.

`npm run build` should keep showing zero matches for `viem` in `apps/web/dist/assets/*.js`.

## The server composes authorisations; the client only signs

Never accept client-composed bytes to submit on someone's behalf. `submitTransfer` takes the
server's own `TransferRequest` plus the deadline from its own row, rebuilds the EIP-3009
authorisation, and must prove the bytes say exactly that. See SECURITY.md.

`apps/api/src/chain/eip3009.ts` owns the EIP-712 encoding and is deliberately hand-written so
the signed bytes are auditable. If you change it, `eip3009.test.ts` will tell you whether you
still agree with viem.

## The ChainAdapter boundary

Anything chain-specific lives behind `apps/api/src/chain/types.ts`. Both adapters expose the
same client contract — base64 bytes in, base64 signature back — so one client code path
serves both. Adding a third backend should not touch the web app. (Moving this app from
Solana to Ethereum changed two files under `chain/` plus key derivation, and no screen.)

## No crypto jargon in the UI

Every user-facing string lives in `packages/shared/src/copy.ts`. `copy.test.ts` fails the
build if a banned word appears, and asserts "USDC" is named exactly once (the balance
subtitle). Say *account* not address, *payment* not transaction; fees are simply not
mentioned. Technical detail belongs under Settings → Advanced and nowhere else.

## SQL lives in one file

`apps/api/src/db.ts`. Everything else talks to the `Store` class. Row casts go through
`as unknown as XRow[]` because `node:sqlite` returns open record types.

## Paths resolve against the repo root

`DATABASE_PATH` and friends resolve from the repository root, not `process.cwd()` — npm
workspace scripts run in their own directory, and a relative path would silently give the
seed and the server two different databases.

## Tests

`node --test` via `tsx`, no framework. Keep the test glob quoted in `package.json` — unquoted,
the shell expands it and silently runs a subset. `apps/api/src/testkit.ts` gives you an in-memory
server and `Actor` helpers that sign like a real client. Run `npm test` before pushing;
`npm run e2e` needs the app running (`npm run seed && npm run dev`, or the preview server on
:4173 with `ORIGIN` including that port).
