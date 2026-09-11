import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const config = loadConfig();
const { app, close } = await buildServer(config, { logger: true });

if (config.devLogin) {
  app.log.warn('DEV_LOGIN is on: /api/dev/login will hand out sessions without a passkey.');
}

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Solder API ready on :${config.port} (chain: ${config.chain})`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void close().then(() => process.exit(0)); });
}
