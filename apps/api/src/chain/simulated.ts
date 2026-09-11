import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import type { Store } from '../db.js';
import { ChainError, type ChainAdapter, type PreparedTransfer, type SubmitResult, type TransferRequest, type TxStatus } from './types.js';

const PREFIX = 'SOLDER-TRANSFER-V1';
/** How long a prepared transfer stays signable — mirrors a Solana blockhash lifetime. */
const TTL_MS = 60_000;
/** Long enough that the pending -> confirmed transition is real, short enough to feel instant. */
const CONFIRM_DELAY_MS = 600;

/**
 * A local ledger that behaves like the real thing where it matters: the client
 * signs a canonical message with its ed25519 key and the ledger refuses
 * anything it cannot verify. No network required.
 */
export class SimulatedChain implements ChainAdapter {
  readonly kind = 'sim' as const;
  readonly canFund = true;

  constructor(private readonly store: Store) {}

  async ensureAccount(pubkey: string): Promise<void> {
    this.store.simEnsureAccount(pubkey);
  }

  async getBalance(pubkey: string): Promise<bigint> {
    return this.store.simBalance(pubkey);
  }

  async prepareTransfer({ ref, from, to, micros }: TransferRequest): Promise<PreparedTransfer> {
    const expiresAt = Date.now() + TTL_MS;
    const message = canonicalMessage({ ref, from, to, micros, expiresAt });
    return { ref, messageB64: Buffer.from(message, 'utf8').toString('base64'), expiresAt };
  }

  async submitTransfer(input: {
    transfer: TransferRequest; messageB64: string; signatureB64: string;
  }): Promise<SubmitResult> {
    const { transfer } = input;
    const messageBytes = Buffer.from(input.messageB64, 'base64');
    const parsed = parseCanonicalMessage(messageBytes.toString('utf8'));

    // Re-derive what these bytes must say from the server's own record. Any
    // difference at all — a changed amount, a changed recipient — and the
    // strings will not match.
    const expected = canonicalMessage({ ...transfer, expiresAt: parsed.expiresAt });
    if (messageBytes.toString('utf8') !== expected) {
      throw new ChainError('message_mismatch', 'That payment could not be verified');
    }
    if (parsed.expiresAt < Date.now()) throw new ChainError('expired', 'That took too long — try again');
    if (this.store.simTxByRef(transfer.ref)) throw new ChainError('replay', 'That payment was already sent');

    let signatureBytes: Buffer;
    try {
      signatureBytes = Buffer.from(input.signatureB64, 'base64');
    } catch {
      throw new ChainError('bad_signature', 'That payment could not be verified');
    }
    if (signatureBytes.length !== 64) {
      throw new ChainError('bad_signature', 'That payment could not be verified');
    }

    let verified = false;
    try {
      verified = ed25519.verify(signatureBytes, messageBytes, bs58.decode(parsed.from));
    } catch {
      verified = false;
    }
    if (!verified) throw new ChainError('bad_signature', 'That payment could not be verified');

    const balance = this.store.simBalance(parsed.from);
    if (balance < parsed.micros) {
      throw new ChainError('insufficient_funds', "That's more than you have");
    }

    const signature = bs58.encode(signatureBytes);
    const now = Date.now();
    this.store.transaction(() => {
      this.store.simEnsureAccount(parsed.to);
      this.store.simDebit(parsed.from, parsed.micros);
      this.store.simCredit(parsed.to, parsed.micros);
      this.store.simInsertTx({
        signature, ref: transfer.ref, from_pubkey: parsed.from, to_pubkey: parsed.to,
        amount_micros: parsed.micros.toString(), status: 'pending',
        created_at: now, confirm_at: now + CONFIRM_DELAY_MS,
      });
    });

    return { signature, status: 'pending' };
  }

  async getStatus(signature: string): Promise<TxStatus> {
    const tx = this.store.simTx(signature);
    if (!tx) return 'failed';
    if (tx.status === 'pending' && tx.confirm_at <= Date.now()) {
      this.store.simConfirmDue(Date.now());
      return 'confirmed';
    }
    return tx.status as TxStatus;
  }

  async fund(pubkey: string, micros: bigint): Promise<void> {
    this.store.simCredit(pubkey, micros);
  }
}

export function canonicalMessage(input: {
  ref: string; from: string; to: string; micros: bigint; expiresAt: number;
}): string {
  return [PREFIX, input.ref, input.from, input.to, input.micros.toString(), String(input.expiresAt)].join('|');
}

export function parseCanonicalMessage(message: string): {
  ref: string; from: string; to: string; micros: bigint; expiresAt: number;
} {
  const parts = message.split('|');
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    throw new ChainError('message_mismatch', 'That payment could not be verified');
  }
  const [, ref, from, to, amount, expiry] = parts as [string, string, string, string, string, string];
  let micros: bigint;
  try {
    micros = BigInt(amount);
  } catch {
    throw new ChainError('message_mismatch', 'That payment could not be verified');
  }
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || micros <= 0n) {
    throw new ChainError('message_mismatch', 'That payment could not be verified');
  }
  return { ref, from, to, micros, expiresAt };
}
