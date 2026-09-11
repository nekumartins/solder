import type { FastifyInstance } from 'fastify';
import { parseAmount } from '@solder/shared';
import { addressFromPrivateKey, signDigest } from './chain/eip3009.js';
import { loadConfig, type Config } from './config.js';
import { Store } from './db.js';
import { devSeedFor } from './routes/auth.js';
import { buildServer, type BuiltServer } from './server.js';

export interface Harness extends BuiltServer {
  config: Config;
  actor(handle: string, displayName?: string): Promise<Actor>;
}

export class Actor {
  cookie = '';
  constructor(readonly app: FastifyInstance, readonly handle: string) {}

  get seed(): Uint8Array { return devSeedFor(this.handle); }
  get accountKey(): string { return addressFromPrivateKey(this.seed); }

  async raw(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) {
    const response = await this.app.inject({
      method, url,
      headers: this.cookie ? { cookie: this.cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      const first = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
      this.cookie = first.split(';')[0]!;
    }
    return response;
  }

  async call(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown): Promise<any> {
    const response = await this.raw(method, url, payload);
    if (response.statusCode >= 400) {
      throw Object.assign(new Error(`${method} ${url} -> ${response.statusCode} ${response.body}`), {
        statusCode: response.statusCode,
        body: response.json(),
      });
    }
    return response.json();
  }

  sign(messageB64: string): string {
    return Buffer.from(signDigest(Buffer.from(messageB64, 'base64'), this.seed)).toString('base64');
  }

  async fund(amount: string): Promise<void> {
    await this.call('POST', '/api/dev/fund', { micros: parseAmount(amount).toString() });
  }

  async balance(): Promise<bigint> {
    return BigInt((await this.call('GET', '/api/me')).balanceMicros);
  }

  async prepare(to: string, amount: string, extra: Record<string, unknown> = {}) {
    return this.call('POST', '/api/payments', {
      toHandle: to, amountMicros: parseAmount(amount).toString(), ...extra,
    });
  }

  async pay(to: string, amount: string, extra: Record<string, unknown> = {}) {
    const prepared = await this.prepare(to, amount, extra);
    return this.call('POST', `/api/payments/${prepared.paymentId}/submit`, {
      signatureB64: this.sign(prepared.messageB64),
    });
  }
}

export async function harness(overrides: Partial<Config> = {}): Promise<Harness> {
  const config = loadConfig({ databasePath: ':memory:', chain: 'sim', ...overrides });
  const store = new Store(':memory:');
  const built = await buildServer(config, { store });

  return {
    ...built,
    config,
    async actor(handle: string, displayName = handle) {
      if (!store.getUserByHandle(handle)) store.createUser(handle, displayName);
      const actor = new Actor(built.app, handle);
      await actor.call('POST', '/api/dev/login', { handle });
      return actor;
    },
  };
}
