import {
  Connection, Keypair, PublicKey, TransactionMessage, VersionedMessage, VersionedTransaction,
  type MessageV0,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction,
  getAccount, getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import type { ChainKind } from '@solder/shared';
import { ChainError, type ChainAdapter, type PreparedTransfer, type SubmitResult, type TransferRequest, type TxStatus } from './types.js';

const USDC_DECIMALS = 6;
/** SPL Token instruction discriminators we allow the relayer to pay for. */
const IX_TRANSFER_CHECKED = 12;
const IX_ATA_CREATE_IDEMPOTENT = 1;

/** The canonical USDC mint on each cluster. */
export const USDC_MINTS: Record<'devnet' | 'mainnet', string> = {
  mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

export interface SolanaChainOptions {
  rpcUrl: string;
  relayerSecretKey: string;
  cluster: Exclude<ChainKind, 'sim'>;
  usdcMint?: string | null;
}

/**
 * Real USDC on Solana, with the relayer as fee payer so the person sending
 * money never needs SOL and never sees a fee.
 *
 * The server composes the transaction and keeps the message bytes; the client
 * only ever returns a signature over those bytes. The relayer therefore never
 * co-signs instructions it did not author.
 */
export class SolanaChain implements ChainAdapter {
  readonly kind = 'solana' as const;
  readonly canFund = false;

  private readonly connection: Connection;
  private readonly relayer: Keypair;
  private readonly mint: PublicKey;

  constructor(options: SolanaChainOptions) {
    this.connection = new Connection(options.rpcUrl, 'confirmed');
    this.relayer = Keypair.fromSecretKey(bs58.decode(options.relayerSecretKey));
    this.mint = new PublicKey(options.usdcMint || USDC_MINTS[options.cluster]);
  }

  async ensureAccount(_pubkey: string): Promise<void> {
    // Token accounts are created idempotently by the relayer at transfer time,
    // so there is nothing to do (and nothing to pay for) up front.
  }

  async getBalance(pubkey: string): Promise<bigint> {
    const ata = getAssociatedTokenAddressSync(this.mint, new PublicKey(pubkey));
    try {
      const account = await getAccount(this.connection, ata);
      return account.amount;
    } catch {
      // No token account yet simply means no money yet.
      return 0n;
    }
  }

  async prepareTransfer({ ref, from, to, micros }: TransferRequest): Promise<PreparedTransfer> {
    const fromOwner = new PublicKey(from);
    const toOwner = new PublicKey(to);
    const fromAta = getAssociatedTokenAddressSync(this.mint, fromOwner);
    const toAta = getAssociatedTokenAddressSync(this.mint, toOwner);

    const instructions = [
      createAssociatedTokenAccountIdempotentInstruction(this.relayer.publicKey, toAta, toOwner, this.mint),
      createTransferCheckedInstruction(fromAta, this.mint, toAta, fromOwner, micros, USDC_DECIMALS),
    ];

    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: this.relayer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    return {
      ref,
      messageB64: Buffer.from(message.serialize()).toString('base64'),
      // A blockhash is good for ~150 slots; 60s is a safe signable window.
      expiresAt: Date.now() + 60_000,
    };
  }

  async submitTransfer(input: {
    transfer: TransferRequest; messageB64: string; signatureB64: string;
  }): Promise<SubmitResult> {
    const { transfer } = input;
    const messageBytes = Buffer.from(input.messageB64, 'base64');
    const signatureBytes = Buffer.from(input.signatureB64, 'base64');
    if (signatureBytes.length !== 64) {
      throw new ChainError('bad_signature', 'That payment could not be verified');
    }

    const sender = new PublicKey(transfer.from);
    // Verify before spending a network round-trip on it.
    if (!ed25519.verify(signatureBytes, messageBytes, sender.toBytes())) {
      throw new ChainError('bad_signature', 'That payment could not be verified');
    }

    const message = VersionedMessage.deserialize(messageBytes);
    // The relayer signs as fee payer, so it must prove to itself that these
    // bytes do what the server recorded — nothing added, nothing altered.
    this.assertMatchesRecord(message as MessageV0, transfer);

    const transaction = new VersionedTransaction(message);
    transaction.sign([this.relayer]);
    transaction.addSignature(sender, signatureBytes);

    try {
      const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
        maxRetries: 3,
      });
      return { signature, status: 'pending' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/insufficient/i.test(detail)) {
        throw new ChainError('insufficient_funds', "That's more than you have");
      }
      throw new ChainError('submit_failed', "That payment didn't go through");
    }
  }

  /**
   * Decompiles the message and checks it against the server's own record of the
   * payment: the relayer pays the fee, so it must never co-sign an instruction
   * it did not author.
   */
  private assertMatchesRecord(message: MessageV0, transfer: TransferRequest): void {
    const reject = (): never => {
      throw new ChainError('message_mismatch', 'That payment could not be verified');
    };

    if (message.addressTableLookups.length > 0) reject();
    if (message.header.numRequiredSignatures !== 2) reject();

    const keys = message.staticAccountKeys;
    if (!keys[0]?.equals(this.relayer.publicKey)) reject();
    if (!keys[1]?.equals(new PublicKey(transfer.from))) reject();

    const fromOwner = new PublicKey(transfer.from);
    const toOwner = new PublicKey(transfer.to);
    const fromAta = getAssociatedTokenAddressSync(this.mint, fromOwner);
    const toAta = getAssociatedTokenAddressSync(this.mint, toOwner);

    let sawTransfer = false;
    for (const instruction of message.compiledInstructions) {
      const programId = keys[instruction.programIdIndex];
      if (!programId) reject();
      const accounts = instruction.accountKeyIndexes.map((index) => keys[index]);
      if (accounts.some((account) => account === undefined)) reject();
      const data = Buffer.from(instruction.data);

      if (programId!.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        // Creating the recipient's token account, paid for by the relayer.
        if (data.length !== 1 || data[0] !== IX_ATA_CREATE_IDEMPOTENT) reject();
        if (!accounts[0]!.equals(this.relayer.publicKey)) reject();
        if (!accounts[1]!.equals(toAta)) reject();
        if (!accounts[2]!.equals(toOwner)) reject();
        if (!accounts[3]!.equals(this.mint)) reject();
        continue;
      }

      if (programId!.equals(TOKEN_PROGRAM_ID)) {
        if (sawTransfer) reject();
        if (data.length !== 10 || data[0] !== IX_TRANSFER_CHECKED) reject();
        if (data.readBigUInt64LE(1) !== transfer.micros) reject();
        if (data[9] !== USDC_DECIMALS) reject();
        if (!accounts[0]!.equals(fromAta)) reject();
        if (!accounts[1]!.equals(this.mint)) reject();
        if (!accounts[2]!.equals(toAta)) reject();
        if (!accounts[3]!.equals(fromOwner)) reject();
        sawTransfer = true;
        continue;
      }

      // Anything else has no business being paid for by the relayer.
      reject();
    }

    if (!sawTransfer) reject();
  }

  async getStatus(signature: string): Promise<TxStatus> {
    const { value } = await this.connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = value[0];
    if (!status) return 'pending';
    if (status.err) return 'failed';
    if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
      return 'confirmed';
    }
    return 'pending';
  }
}
