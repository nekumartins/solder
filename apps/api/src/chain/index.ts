import type { Config } from '../config.js';
import type { Store } from '../db.js';
import { SimulatedChain } from './simulated.js';
import type { ChainAdapter } from './types.js';

export type { ChainAdapter, PreparedTransfer, SubmitResult, TxStatus } from './types.js';
export { ChainError } from './types.js';
export { SimulatedChain } from './simulated.js';

/**
 * The real Ethereum adapter is imported lazily so the default simulated setup
 * never loads viem at all.
 */
export async function createChain(config: Config, store: Store): Promise<ChainAdapter> {
  if (config.chain === 'sim') return new SimulatedChain(store);

  const { EthereumChain } = await import('./ethereum.js');
  return new EthereumChain({
    rpcUrl: config.rpcUrl!,
    relayerPrivateKey: config.relayerPrivateKey!,
    network: config.chain,
    usdcAddress: config.usdcAddress,
  });
}
