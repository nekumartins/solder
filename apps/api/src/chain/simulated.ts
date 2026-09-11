import { keccak_256 } from '@noble/hashes/sha3';
import type { Store } from '../db.js';
import {
  authorizationDigest, hex0x, nonceFor, recoverSigner, sameAddress, type Eip712Domain,
} from './eip3009.js';
import { ChainError, type ChainAdapter, type PreparedTransfer, type SubmitResult, type TransferRequest, type TxStatus } from './types.js';

/** How long an authorisation stays signable. */
const TTL_MS = 60_000;
/** Long enough that the pending -> confirmed transition is real, short enough to feel instant. */
const CONFIRM_DELAY_MS = 600;

/** A stand-in for a deployed token, with its own chain id so nothing here could ever be replayed elsewhere. */
const DEMO_DOMAIN: Eip712Domain = {
  name: 'Solder Demo Dollar',
  version: '1',
  chainId: 31337n,
  verifyingContract: '0x5010D054Ac1BC0dd9Bd5B1b7d0E4Ce4EbFE0aB41',
};

/**
 * A local ledger that behaves like the real thing where it matters: the person
 * paying signs a real EIP-3009 authorisation with their own secp256k1 key, and
 * the ledger refuses anything it cannot verify. No network required.
 */
export class SimulatedChain implements ChainAdapter {
  readonly kind = 'sim' as const;
  readonly canFund = true;

  constructor(private readonly store: Store) {}

  async ensureAccount(address: string): Promise<void> {
    this.store.simEnsureAccount(address.toLowerCase());
  }

  async getBalance(address: string): Promise<bigint> {
    return this.store.simBalance(address.toLowerCase());
  }

  async prepareTransfer({ ref, from, to, micros }: TransferRequest): Promise<PreparedTransfer> {
    const expiresAt = Date.now() + TTL_MS;
    const digest = authorizationDigest(DEMO_DOMAIN, authorization({ ref, from, to, micros }, expiresAt));
    return { ref, messageB64: Buffer.from(digest).toString('base64'), expiresAt };
  }

  async submitTransfer(input: {
    transfer: TransferRequest; messageB64: string; signatureB64: string; expiresAt: number;
  }): Promise<SubmitResult> {
    const { transfer } = input;

    // Rebuild the authorisation from our own record. If the bytes about to be
    // submitted say anything else — a different recipient, a different amount —
    // they will not match.
    const expected = authorizationDigest(DEMO_DOMAIN, authorization(transfer, input.expiresAt));
    const submitted = Buffer.from(input.messageB64, 'base64');
    if (!Buffer.from(expected).equals(submitted)) {
      throw new ChainError('message_mismatch', 'That payment could not be verified');
    }
    if (input.expiresAt < Date.now()) throw new ChainError('expired', 'That took too long — try again');
    if (this.store.simTxByRef(transfer.ref)) throw new ChainError('replay', 'That payment was already sent');

    const signature = Buffer.from(input.signatureB64, 'base64');
    const signer = recoverSigner(expected, signature);
    if (!sameAddress(signer, transfer.from)) {
      throw new ChainError('bad_signature', 'That payment could not be verified');
    }

    const from = transfer.from.toLowerCase();
    const to = transfer.to.toLowerCase();
    if (this.store.simBalance(from) < transfer.micros) {
      throw new ChainError('insufficient_funds', "That's more than you have");
    }

    // Shaped like a real transaction hash, so nothing downstream has to care.
    const hash = hex0x(keccak_256(Buffer.concat([expected, signature])));
    const now = Date.now();
    this.store.transaction(() => {
      this.store.simEnsureAccount(to);
      this.store.simDebit(from, transfer.micros);
      this.store.simCredit(to, transfer.micros);
      this.store.simInsertTx({
        signature: hash, ref: transfer.ref, from_pubkey: from, to_pubkey: to,
        amount_micros: transfer.micros.toString(), status: 'pending',
        created_at: now, confirm_at: now + CONFIRM_DELAY_MS,
      });
    });

    return { signature: hash, status: 'pending' };
  }

  async getStatus(hash: string): Promise<TxStatus> {
    const tx = this.store.simTx(hash);
    if (!tx) return 'failed';
    if (tx.status === 'pending' && tx.confirm_at <= Date.now()) {
      this.store.simConfirmDue(Date.now());
      return 'confirmed';
    }
    return tx.status as TxStatus;
  }

  async fund(address: string, micros: bigint): Promise<void> {
    this.store.simCredit(address.toLowerCase(), micros);
  }
}

function authorization(transfer: TransferRequest, expiresAt: number) {
  return {
    from: transfer.from,
    to: transfer.to,
    value: transfer.micros,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(expiresAt / 1000)),
    nonce: nonceFor(transfer.ref),
  };
}

/** Exposed so tests can build an authorisation the way the ledger does. */
export { DEMO_DOMAIN, authorization as demoAuthorization };
