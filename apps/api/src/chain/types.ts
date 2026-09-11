export type TxStatus = 'pending' | 'confirmed' | 'failed';

export interface PreparedTransfer {
  ref: string;
  /** Base64 bytes the client signs. The client never interprets them. */
  messageB64: string;
  expiresAt: number;
}

export interface SubmitResult {
  signature: string;
  status: TxStatus;
  error?: string;
}

export interface TransferRequest {
  ref: string;
  from: string;
  to: string;
  micros: bigint;
}

/**
 * Both adapters expose the same contract to the client: the server hands over
 * opaque base64 bytes, the client signs exactly those bytes with ed25519, and
 * the server verifies the signature before submitting. One client code path,
 * two backends.
 */
export interface ChainAdapter {
  readonly kind: 'sim' | 'solana';
  /** True when the ledger can hand out money on request (local sim only). */
  readonly canFund: boolean;
  ensureAccount(pubkey: string): Promise<void>;
  getBalance(pubkey: string): Promise<bigint>;
  prepareTransfer(request: TransferRequest): Promise<PreparedTransfer>;
  /**
   * `transfer` carries the server's own record of what this payment is. The
   * adapter must prove the bytes it is about to submit say exactly that, and
   * reject them otherwise — never trust the message to describe itself.
   */
  submitTransfer(input: {
    transfer: TransferRequest;
    messageB64: string;
    signatureB64: string;
  }): Promise<SubmitResult>;
  getStatus(signature: string): Promise<TxStatus>;
  fund?(pubkey: string, micros: bigint): Promise<void>;
}

export class ChainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ChainError';
    this.code = code;
  }
}
