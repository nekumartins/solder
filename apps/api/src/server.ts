import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createChain } from './chain/index.js';
import type { Config } from './config.js';
import { AppContext } from './context.js';
import { Store } from './db.js';
import { HttpError } from './errors.js';
import { Realtime } from './realtime.js';
import { authRoutes } from './routes/auth.js';
import { devRoutes } from './routes/dev.js';
import { paymentRoutes, startPaymentWatcher } from './routes/payments.js';
import { requestRoutes } from './routes/requests.js';
import { streamRoutes } from './routes/stream.js';
import { threadRoutes } from './routes/threads.js';
import { userRoutes } from './routes/users.js';
import { vaultRoutes } from './routes/vault.js';

export interface BuiltServer {
  app: FastifyInstance;
  ctx: AppContext;
  close(): Promise<void>;
}

export async function buildServer(config: Config, options: { store?: Store; logger?: boolean } = {}): Promise<BuiltServer> {
  const store = options.store ?? new Store(config.databasePath);
  const chain = await createChain(config, store);
  const realtime = new Realtime();
  const ctx: AppContext = { store, chain, config, realtime };

  const app = Fastify({
    logger: options.logger ?? false,
    // The SSE stream must not be cut off by a request timeout.
    connectionTimeout: 0,
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    allowList: () => false,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'rate_limited', message: 'Slow down a moment and try again' },
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      error: { code: 'server_error', message: 'Something went wrong. Try again.' },
    });
  });

  await app.register(async (instance) => {
    await authRoutes(instance, ctx);
    await vaultRoutes(instance, ctx);
    await userRoutes(instance, ctx);
    await threadRoutes(instance, ctx);
    await paymentRoutes(instance, ctx);
    await requestRoutes(instance, ctx);
    await streamRoutes(instance, ctx);
    await devRoutes(instance, ctx);
  });

  app.get('/api/health', { config: { rateLimit: false } }, async () => ({
    ok: true, chain: config.chain,
  }));

  const watcher = startPaymentWatcher(ctx);

  return {
    app,
    ctx,
    async close() {
      clearInterval(watcher);
      realtime.close();
      await app.close();
      store.close();
    },
  };
}
