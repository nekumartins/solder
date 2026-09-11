import type { ChainKind } from '@solder/shared';

export interface Config {
  port: number;
  chain: ChainKind;
  databasePath: string;
  rpId: string;
  origins: string[];
  sessionTtlMs: number;
  devLogin: boolean;
  dailySendLimitMicros: bigint;
  solanaRpcUrl: string | null;
  relayerSecretKey: string | null;
  usdcMint: string | null;
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const chain = env('CHAIN', 'sim') as ChainKind;
  if (!['sim', 'devnet', 'mainnet'].includes(chain)) {
    throw new Error(`CHAIN must be sim, devnet or mainnet (got "${chain}")`);
  }

  const origin = env('ORIGIN', 'http://localhost:5173');
  const config: Config = {
    port: Number(env('PORT', '8787')),
    chain,
    databasePath: env('DATABASE_PATH', './data/solder.db'),
    rpId: env('RP_ID', 'localhost'),
    origins: origin.split(',').map((o) => o.trim()).filter(Boolean),
    sessionTtlMs: Number(env('SESSION_TTL_DAYS', '30')) * 24 * 60 * 60 * 1000,
    // The dev shortcut sign-in can never be enabled in production, whatever the env says.
    devLogin: env('DEV_LOGIN', '1') === '1' && !isProduction,
    dailySendLimitMicros: BigInt(env('DAILY_SEND_LIMIT_USD', '500')) * 1_000_000n,
    solanaRpcUrl: process.env['SOLANA_RPC_URL'] || null,
    relayerSecretKey: process.env['RELAYER_SECRET_KEY'] || null,
    usdcMint: process.env['USDC_MINT'] || null,
    ...overrides,
  };

  if (config.chain !== 'sim') {
    const missing = [
      !config.solanaRpcUrl && 'SOLANA_RPC_URL',
      !config.relayerSecretKey && 'RELAYER_SECRET_KEY',
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
