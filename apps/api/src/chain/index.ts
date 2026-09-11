import type { Config } from '../config.js';
import type { Store } from '../db.js';
import { SimulatedChain } from './simulated.js';
import type { ChainAdapter } from './types.js';

export type { ChainAdapter, PreparedTransfer, SubmitResult, TxStatus } from './types.js';
export { ChainError } from './types.js';
export { SimulatedChain } from './simulated.js';

/**
 * The real Solana adapter is imported lazily so the default simulated setup
 * never loads @solana/web3.js at all.
 */
export async function createChain(config: Config, store: Store): Promise<ChainAdapter> {
  if (config.chain === 'sim') return new SimulatedChain(store);

  const { SolanaChain } = await import('./solana.js');
  return new SolanaChain({
    rpcUrl: config.solanaRpcUrl!,
    relayerSecretKey: config.relayerSecretKey!,
    cluster: config.chain,
    usdcMint: config.usdcMint,
  });
}
