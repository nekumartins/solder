import { ed25519 } from '@noble/curves/ed25519';
import type { FastifyInstance } from 'fastify';
import { parseAmount } from '@solder/shared';
import { loadConfig } from './config.js';
import { Store } from './db.js';
import { devSeedFor } from './routes/auth.js';
import { buildServer } from './server.js';

/**
 * Lays down a believable slice of history so the app looks alive the first
 * time you open it.
 *
 * It drives the real HTTP API rather than writing rows directly, so running
 * the seed is also an end-to-end smoke test of the payment path.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Demo { handle: string; displayName: string; }

const PEOPLE: Demo[] = [
  { handle: 'ana', displayName: 'Ana Ruiz' },
  { handle: 'marco', displayName: 'Marco Silva' },
  { handle: 'jules', displayName: 'Jules Okafor' },
  { handle: 'priya', displayName: 'Priya Nair' },
];

class Client {
  cookie = '';
  constructor(readonly app: FastifyInstance, readonly handle: string) {}

  async call(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown): Promise<any> {
    const response = await this.app.inject({
      method, url,
      headers: this.cookie ? { cookie: this.cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
      const raw = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
      this.cookie = raw.split(';')[0]!;
    }
    if (response.statusCode >= 400) {
      throw new Error(`${method} ${url} -> ${response.statusCode} ${response.body}`);
    }
    return response.json();
  }

  sign(messageB64: string): string {
    const seed = devSeedFor(this.handle);
    const signature = ed25519.sign(Buffer.from(messageB64, 'base64'), seed);
    return Buffer.from(signature).toString('base64');
  }

  /** The full real flow: prepare, sign on the client, submit. */
  async pay(to: string, amount: string, extra: { note?: string; emoji?: string; requestEventId?: string } = {}) {
    const prepared = await this.call('POST', '/api/payments', {
      toHandle: to, amountMicros: parseAmount(amount).toString(), ...extra,
    });
    const result = await this.call('POST', `/api/payments/${prepared.paymentId}/submit`, {
      signatureB64: this.sign(prepared.messageB64),
    });
    return result.event;
  }
}

export async function seed(store: Store, app: FastifyInstance): Promise<void> {
  store.wipe();

  const clients = new Map<string, Client>();
  for (const person of PEOPLE) {
    store.createUser(person.handle, person.displayName);
    const client = new Client(app, person.handle);
    await client.call('POST', '/api/dev/login', { handle: person.handle });
    await client.call('POST', '/api/dev/fund', { micros: parseAmount('300').toString() });
    clients.set(person.handle, client);
  }

  const ana = clients.get('ana')!;
  const marco = clients.get('marco')!;
  const jules = clients.get('jules')!;
  const priya = clients.get('priya')!;

  // Each entry is [event id, how long ago it happened].
  const timeline: Array<[string, number]> = [];
  const at = (event: { id: string }, ago: number) => { timeline.push([event.id, ago]); return event; };

  at(await marco.pay('ana', '22.00', { note: 'thai food', emoji: '🍜' }), 4 * DAY);
  at(await ana.pay('marco', '8.50', { note: 'coffee', emoji: '☕' }), 3 * DAY);
  at((await marco.call('POST', '/api/threads/ana/messages', { body: 'that new place on 4th?' })).event, 3 * DAY - 20 * MINUTE);
  at((await ana.call('POST', '/api/threads/marco/messages', { body: 'worth every penny' })).event, 3 * DAY - 18 * MINUTE);

  const gift = at(await ana.pay('jules', '45.00', { note: 'your half of the gift', emoji: '🎁' }), 6 * DAY);
  at(await jules.pay('ana', '12.00', { note: 'cab home', emoji: '🚕' }), 5 * DAY);
  await ana.call('POST', `/api/events/${gift.id}/reactions`, { emoji: '🎉' });
  at((await jules.call('POST', '/api/threads/ana/messages', { body: 'you around later?' })).event, 20 * MINUTE);

  // A split: dinner for four, so everyone owes a quarter.
  await ana.call('POST', '/api/splits', {
    totalMicros: parseAmount('96.00').toString(),
    handles: ['marco', 'jules', 'priya'],
    note: 'dinner at Lupa',
  });

  // Priya settles hers straight away; the others are still open.
  const priyaThread = await priya.call('GET', '/api/threads/ana');
  const priyaRequest = priyaThread.events.find((event: any) => event.kind === 'request' && event.status === 'open');
  if (priyaRequest) {
    at(await priya.pay('ana', '24.00', { requestEventId: priyaRequest.id, note: 'dinner at Lupa' }), 2 * HOUR);
  }

  // And an open ask pointed at Ana, so the app opens with something to act on.
  at((await marco.call('POST', '/api/requests', {
    toHandle: 'ana', amountMicros: parseAmount('16.25').toString(), note: 'movie tickets', emoji: '🎟️',
  })).event, 1 * HOUR);

  // Payments confirm on a short delay, exactly as they do in the app.
  await new Promise((resolve) => setTimeout(resolve, 800));
  for (const payment of store.pendingPayments()) {
    store.setEventStatus(payment.id, 'confirmed', { confirmedAt: Date.now() });
  }

  // Backdate so the history reads like weeks of ordinary use.
  const now = Date.now();
  for (const [eventId, ago] of timeline) {
    const row = store.getEvent(eventId);
    if (!row) continue;
    const createdAt = now - ago;
    store.setEventTimestamps(eventId, createdAt, row.confirmed_at ? createdAt + 900 : null);
  }
  for (const thread of store.listThreads(store.getUserByHandle('ana')!.id)) {
    const last = thread.last_event_id ? store.getEvent(thread.last_event_id) : null;
    if (last) store.setThreadUpdatedAt(thread.id, last.created_at);
  }

  // Ana has read everything except the two things waiting on her.
  const anaId = store.getUserByHandle('ana')!.id;
  for (const thread of store.listThreads(anaId)) {
    const peerId = thread.user_a === anaId ? thread.user_b : thread.user_a;
    const peer = store.getUser(peerId);
    if (peer && peer.handle !== 'marco' && peer.handle !== 'jules') {
      store.markThreadRead(thread.id, anaId);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.devLogin) {
    throw new Error('Seeding needs DEV_LOGIN=1 (it is off in production).');
  }
  const server = await buildServer(config);
  try {
    await seed(server.ctx.store, server.app);
    const balances = await Promise.all(PEOPLE.map(async (person) => {
      const user = server.ctx.store.getUserByHandle(person.handle)!;
      const balance = user.pubkey ? await server.ctx.chain.getBalance(user.pubkey) : 0n;
      return `  @${person.handle.padEnd(6)} $${(Number(balance) / 1e6).toFixed(2)}`;
    }));
    console.log(`Seeded ${PEOPLE.length} people on the ${config.chain} ledger:`);
    console.log(balances.join('\n'));
    console.log('\nSign in as @ana to see it.');
  } finally {
    await server.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
