import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChainKind } from '@solder/shared';

/**
 * Relative paths resolve against the repository root, not the working
 * directory — otherwise `npm run seed` (which runs inside apps/api) and
 * `npm run dev` (which runs from the root) would quietly use two different
 * databases.
 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export interface Config {
  port: number;
  chain: ChainKind;
  databasePath: string;
  rpId: string;
  origins: string[];
  sessionTtlMs: number;
  devLogin: boolean;
  dailySendLimitMicros: bigint;
  /** Requests per minute per IP. Test runs all share 127.0.0.1, so they raise it. */
  rateLimitMax: number;
  rpcUrl: string | null;
  relayerPrivateKey: string | null;
  usdcAddress: string | null;
}

const NETWORKS: ChainKind[] = ['sim', 'ethereum', 'sepolia', 'base', 'base-sepolia'];

function resolveFromRoot(path: string): string {
  return path === ':memory:' ? path : resolve(REPO_ROOT, path);
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const chain = env('CHAIN', 'sim') as ChainKind;
  if (!NETWORKS.includes(chain)) {
    throw new Error(`CHAIN must be one of ${NETWORKS.join(', ')} (got "${chain}")`);
  }

  const origin = env('ORIGIN', 'http://localhost:5173');
  const config: Config = {
    port: Number(env('PORT', '8787')),
    chain,
    databasePath: resolveFromRoot(env('DATABASE_PATH', './data/solder.db')),
    rpId: env('RP_ID', 'localhost'),
    origins: origin.split(',').map((o) => o.trim()).filter(Boolean),
    sessionTtlMs: Number(env('SESSION_TTL_DAYS', '30')) * 24 * 60 * 60 * 1000,
    // The dev shortcut sign-in can never be enabled in production, whatever the env says.
    devLogin: env('DEV_LOGIN', '1') === '1' && !isProduction,
    dailySendLimitMicros: BigInt(env('DAILY_SEND_LIMIT_USD', '500')) * 1_000_000n,
    rateLimitMax: Number(env('RATE_LIMIT_MAX', '120')),
    rpcUrl: process.env['RPC_URL'] || null,
    relayerPrivateKey: process.env['RELAYER_PRIVATE_KEY'] || null,
    usdcAddress: process.env['USDC_ADDRESS'] || null,
    ...overrides,
  };

  if (config.chain !== 'sim') {
    const missing = [
      !config.rpcUrl && 'RPC_URL',
      !config.relayerPrivateKey && 'RELAYER_PRIVATE_KEY',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(
        `CHAIN=${config.chain} needs ${missing.join(' and ')}. ` +
        'Set them in .env, or use CHAIN=sim for the local simulated ledger.',
      );
    }
  }

  return config;
}
