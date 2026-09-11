import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, mainnet, sepolia } from 'viem/chains';
import type { ChainKind } from '@solder/shared';
import {
  authorizationDigest, hex0x, isAddress, nonceFor, recoverSigner, sameAddress, toChecksumAddress,
  type Eip712Domain,
} from './eip3009.js';
import { ChainError, type ChainAdapter, type PreparedTransfer, type SubmitResult, type TransferRequest, type TxStatus } from './types.js';

export type EthereumNetwork = Exclude<ChainKind, 'sim'>;

/**
 * Circle's native USDC on each supported network. Bridged variants (USDC.e and
 * friends) are deliberately not listed: many of them do not implement EIP-3009,
 * which is what makes payments here free for the sender.
 *
 * Verify against Circle's published list before pointing this at real money.
 */
export const USDC_ADDRESSES: Record<EthereumNetwork, Address> = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  sepolia: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  'base-sepolia': '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

const CHAINS = { ethereum: mainnet, sepolia, base, 'base-sepolia': baseSepolia } as const;

const USDC_ABI = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  {
    type: 'function', name: 'authorizationState', stateMutability: 'view',
    inputs: [{ name: 'authorizer', type: 'address' }, { name: 'nonce', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function', name: 'transferWithAuthorization', stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' }, { name: 'r', type: 'bytes32' }, { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

/** An authorisation is signable for a minute — long enough to confirm, short enough to matter. */
const TTL_MS = 60_000;
const USDC_DECIMALS = 6;

export interface EthereumChainOptions {
  rpcUrl: string;
  relayerPrivateKey: string;
  network: EthereumNetwork;
  usdcAddress?: string | null;
}

/**
 * Real USDC, with the relayer paying gas so the person sending money never
 * needs ETH and never sees a fee.
 *
 * The mechanism is EIP-3009: the sender signs an authorisation naming the
 * recipient and amount, and the relayer submits it. Because the signature
 * covers both, the relayer cannot redirect the money — it can only pay for a
 * transfer that was already authorised, or pay for nothing at all.
 */
export class EthereumChain implements ChainAdapter {
  readonly kind = 'ethereum' as const;
  readonly canFund = false;

  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly relayer: ReturnType<typeof privateKeyToAccount>;
  private readonly usdc: Address;
  private readonly network: EthereumNetwork;
  private domainPromise: Promise<Eip712Domain> | null = null;

  constructor(options: EthereumChainOptions) {
    const chain = CHAINS[options.network];
    this.network = options.network;
    this.relayer = privateKeyToAccount(normalizeKey(options.relayerPrivateKey));
    this.usdc = (options.usdcAddress || USDC_ADDRESSES[options.network]) as Address;
    this.publicClient = createPublicClient({ chain, transport: http(options.rpcUrl) }) as PublicClient;
    this.walletClient = createWalletClient({ chain, account: this.relayer, transport: http(options.rpcUrl) });
  }

  async ensureAccount(_address: string): Promise<void> {
    // Every Ethereum address exists already — nothing to create and nothing to pay for.
  }

  async getBalance(address: string): Promise<bigint> {
    if (!isAddress(address)) return 0n;
    return this.publicClient.readContract({
      address: this.usdc, abi: USDC_ABI, functionName: 'balanceOf', args: [address as Address],
    });
  }

  async prepareTransfer({ ref, from, to, micros }: TransferRequest): Promise<PreparedTransfer> {
    const expiresAt = Date.now() + TTL_MS;
    const digest = authorizationDigest(await this.domain(), authorization({ ref, from, to, micros }, expiresAt));
    return { ref, messageB64: Buffer.from(digest).toString('base64'), expiresAt };
  }

  async submitTransfer(input: {
    transfer: TransferRequest; messageB64: string; signatureB64: string; expiresAt: number;
  }): Promise<SubmitResult> {
    const { transfer } = input;
    const auth = authorization(transfer, input.expiresAt);

    // Rebuild the authorisation from our own record before paying to publish it.
    const expected = authorizationDigest(await this.domain(), auth);
    if (!Buffer.from(expected).equals(Buffer.from(input.messageB64, 'base64'))) {
      throw new ChainError('message_mismatch', 'That payment could not be verified');
    }
    if (input.expiresAt < Date.now()) throw new ChainError('expired', 'That took too long — try again');

    const signature = Buffer.from(input.signatureB64, 'base64');
    if (!sameAddress(recoverSigner(expected, signature), transfer.from)) {
      throw new ChainError('bad_signature', 'That payment could not be verified');
    }

    // The token itself rejects a reused nonce; catching it here saves the gas.
    const alreadyUsed = await this.publicClient.readContract({
      address: this.usdc, abi: USDC_ABI, functionName: 'authorizationState',
      args: [transfer.from as Address, hex0x(auth.nonce) as Hex],
    });
    if (alreadyUsed) throw new ChainError('replay', 'That payment was already sent');

    if (await this.getBalance(transfer.from) < transfer.micros) {
      throw new ChainError('insufficient_funds', "That's more than you have");
    }

    try {
      const hash = await this.walletClient.writeContract({
        address: this.usdc,
        abi: USDC_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          transfer.from as Address,
          transfer.to as Address,
          transfer.micros,
          auth.validAfter,
          auth.validBefore,
          hex0x(auth.nonce) as Hex,
          signature[64]!,
          hex0x(signature.subarray(0, 32)) as Hex,
          hex0x(signature.subarray(32, 64)) as Hex,
        ],
        chain: CHAINS[this.network],
        account: this.relayer,
      });
      return { signature: hash, status: 'pending' };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (/insufficient funds/i.test(detail)) {
        // This one is the relayer's gas, not the sender's balance.
        throw new ChainError('relayer_empty', "We couldn't send that right now — try again shortly");
      }
      throw new ChainError('submit_failed', "That payment didn't go through");
    }
  }

  async getStatus(hash: string): Promise<TxStatus> {
    try {
      const receipt = await this.publicClient.getTransactionReceipt({ hash: hash as Hex });
      return receipt.status === 'success' ? 'confirmed' : 'failed';
    } catch {
      // No receipt yet simply means it is still in flight.
      return 'pending';
    }
  }

  /**
   * The signing domain comes from the deployed token rather than a hardcoded
   * guess: `name` and `version` differ between USDC deployments, and getting
   * either wrong produces a signature the contract silently rejects.
   */
  private async domain(): Promise<Eip712Domain> {
    this.domainPromise ??= (async () => {
      const [name, version, decimals] = await Promise.all([
        this.publicClient.readContract({ address: this.usdc, abi: USDC_ABI, functionName: 'name' }),
        this.publicClient.readContract({ address: this.usdc, abi: USDC_ABI, functionName: 'version' })
          .catch(() => '2'),
        this.publicClient.readContract({ address: this.usdc, abi: USDC_ABI, functionName: 'decimals' }),
      ]);
      if (decimals !== USDC_DECIMALS) {
        throw new Error(
          `${this.usdc} reports ${decimals} decimals; Solder's money math assumes ${USDC_DECIMALS}.`,
        );
      }
      return {
        name, version,
        chainId: BigInt(CHAINS[this.network].id),
        verifyingContract: toChecksumAddress(this.usdc),
      };
    })().catch((error) => {
      this.domainPromise = null; // let a transient RPC failure be retried
      throw error;
    });
    return this.domainPromise;
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

function normalizeKey(key: string): Hex {
  const prefixed = (key.startsWith('0x') ? key : `0x${key}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(prefixed)) {
    throw new Error('RELAYER_PRIVATE_KEY must be a 32-byte hex key');
  }
  return prefixed;
}
