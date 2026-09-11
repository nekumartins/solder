import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd, parseAmount } from '@solder/shared';
import { harness } from './testkit.js';

test('paying a request closes it', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  await ana.fund('100');

  const { event: request } = await marco.call('POST', '/api/requests', {
    toHandle: 'ana', amountMicros: parseAmount('16.25').toString(), note: 'movie tickets', emoji: '🎟️',
  });
  assert.equal(request.status, 'open');

  await ana.pay('marco', '16.25', { requestEventId: request.id });

  const thread = await marco.call('GET', '/api/threads/ana');
  const updated = thread.events.find((event: any) => event.id === request.id);
  assert.equal(updated.status, 'paid');
  assert.equal(formatUsd(await marco.balance()), '$16.25');
});

test('a request can only be settled once', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  await ana.fund('100');

  const { event: request } = await marco.call('POST', '/api/requests', {
    toHandle: 'ana', amountMicros: parseAmount('10').toString(),
  });
  await ana.pay('marco', '10', { requestEventId: request.id });

  const second = await ana.raw('POST', '/api/payments', {
    toHandle: 'marco', amountMicros: parseAmount('10').toString(), requestEventId: request.id,
  });
  assert.equal(second.statusCode, 400);
  assert.equal(second.json().error.code, 'request_closed');
});

test('only the person asked can decline, and only once', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  const jules = await app.actor('jules');

  const { event: request } = await marco.call('POST', '/api/requests', {
    toHandle: 'ana', amountMicros: parseAmount('10').toString(),
  });

  const outsider = await jules.raw('POST', `/api/requests/${request.id}/decline`);
  assert.equal(outsider.statusCode, 403);

  const asker = await marco.raw('POST', `/api/requests/${request.id}/decline`);
  assert.equal(asker.statusCode, 403);

  const declined = await ana.call('POST', `/api/requests/${request.id}/decline`);
  assert.equal(declined.event.status, 'declined');

  const again = await ana.raw('POST', `/api/requests/${request.id}/decline`);
  assert.equal(again.statusCode, 409);
});

test('only the asker can take a request back', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');

  const { event: request } = await marco.call('POST', '/api/requests', {
    toHandle: 'ana', amountMicros: parseAmount('10').toString(),
  });

  assert.equal((await ana.raw('POST', `/api/requests/${request.id}/cancel`)).statusCode, 403);
  const cancelled = await marco.call('POST', `/api/requests/${request.id}/cancel`);
  assert.equal(cancelled.event.status, 'cancelled');
});

test('a split divides the bill and tracks who has paid', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  const jules = await app.actor('jules');
  const priya = await app.actor('priya');
  for (const person of [marco, jules, priya]) await person.fund('100');

  const created = await ana.call('POST', '/api/splits', {
    totalMicros: parseAmount('96').toString(),
    handles: ['marco', 'jules', 'priya'],
    note: 'dinner at Lupa',
  });

  // Four people, so Ana covers a quarter too.
  assert.equal(created.yourShare, '24000000');
  assert.equal(created.split.participantCount, 3);
  const shares = created.split.participants.map((p: any) => BigInt(p.shareMicros));
  assert.equal(shares.reduce((a: bigint, b: bigint) => a + b, BigInt(created.yourShare)), parseAmount('96'));

  const marcoThread = await marco.call('GET', '/api/threads/ana');
  const marcoRequest = marcoThread.events.find((event: any) => event.kind === 'request');
  assert.equal(marcoRequest.amountMicros, '24000000');
  assert.equal(marcoRequest.split.paidCount, 0);

  await marco.pay('ana', '24', { requestEventId: marcoRequest.id });

  const progress = await ana.call('GET', `/api/splits/${created.split.splitId}`);
  assert.equal(progress.split.paidCount, 1);
  assert.equal(progress.split.participants.find((p: any) => p.handle === 'marco').status, 'paid');
  assert.equal(formatUsd(await ana.balance()), '$24.00');
});

test('an uneven split still adds up to the total', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  await app.actor('jules');

  const created = await ana.call('POST', '/api/splits', {
    totalMicros: parseAmount('10').toString(),
    handles: ['marco', 'jules'],
  });

  const total = created.split.participants.reduce(
    (sum: bigint, p: any) => sum + BigInt(p.shareMicros), BigInt(created.yourShare),
  );
  assert.equal(total, parseAmount('10'));
});

test('a bill is only visible to the people on it', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  const stranger = await app.actor('priya');

  const created = await ana.call('POST', '/api/splits', {
    totalMicros: parseAmount('10').toString(), handles: ['marco'],
  });
  assert.equal((await stranger.raw('GET', `/api/splits/${created.split.splitId}`)).statusCode, 403);
});

test('reactions toggle on, swap, and off', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  await ana.fund('50');
  const { event } = await ana.pay('marco', '5', { note: 'lunch' });

  const added = await marco.call('POST', `/api/events/${event.id}/reactions`, { emoji: '❤️' });
  assert.equal(added.result, 'added');
  assert.deepEqual(added.event.reactions.map((r: any) => r.emoji), ['❤️']);

  const replaced = await marco.call('POST', `/api/events/${event.id}/reactions`, { emoji: '🔥' });
  assert.equal(replaced.result, 'replaced');
  assert.equal(replaced.event.reactions.length, 1);

  const removed = await marco.call('POST', `/api/events/${event.id}/reactions`, { emoji: '🔥' });
  assert.equal(removed.result, 'removed');
  assert.equal(removed.event.reactions.length, 0);

  // Both people can react to the same message, but nobody else can.
  await ana.call('POST', `/api/events/${event.id}/reactions`, { emoji: '🎉' });
  const outsider = await app.actor('jules');
  assert.equal((await outsider.raw('POST', `/api/events/${event.id}/reactions`, { emoji: '🎉' })).statusCode, 403);
  assert.equal((await ana.raw('POST', `/api/events/${event.id}/reactions`, { emoji: 'not an emoji' })).statusCode, 400);
});

test('messages and payments share one conversation', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  await ana.fund('50');

  await ana.call('POST', '/api/threads/marco/messages', { body: 'dinner later?' });
  await marco.call('POST', '/api/threads/ana/messages', { body: 'yes — 8pm' });
  await ana.pay('marco', '20', { note: 'my half', emoji: '🍝' });

  const thread = await ana.call('GET', '/api/threads/marco');
  assert.deepEqual(thread.events.map((event: any) => event.kind), ['note', 'note', 'payment']);
  assert.equal(thread.peer.displayName, 'marco');

  const summaries = await ana.call('GET', '/api/threads');
  assert.equal(summaries.threads.length, 1);
  assert.equal(summaries.threads[0].lastEvent.kind, 'payment');
});

test('finding people never exposes an account key', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana', 'Ana Ruiz');
  await app.actor('marco', 'Marco Silva');

  const search = await ana.call('GET', '/api/users/search?q=mar');
  assert.deepEqual(search.results, [{ handle: 'marco', displayName: 'Marco Silva' }]);

  const profile = await ana.call('GET', '/api/users/marco');
  assert.equal(profile.user.handle, 'marco');
  assert.equal(profile.canReceive, true);
  assert.equal(JSON.stringify(profile).includes(app.ctx.store.getUserByHandle('marco')!.pubkey!), false);

  // Only you see your own account key, and only when you ask for it.
  const me = await ana.call('GET', '/api/me');
  assert.equal(me.user.accountKey, ana.accountKey);
});

test('a name is checked before anyone can claim it', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  await app.actor('ana');
  const taken = await app.app.inject({ method: 'GET', url: '/api/users/handle-available?handle=ana' });
  assert.deepEqual(taken.json(), { available: false, reason: 'Already taken' });

  const reserved = await app.app.inject({ method: 'GET', url: '/api/users/handle-available?handle=admin' });
  assert.equal(reserved.json().available, false);

  const free = await app.app.inject({ method: 'GET', url: '/api/users/handle-available?handle=newcomer' });
  assert.deepEqual(free.json(), { available: true, handle: 'newcomer' });
});

test('live updates reach the other person', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  await ana.fund('50');

  const received: any[] = [];
  const marcoId = app.ctx.store.getUserByHandle('marco')!.id;
  app.ctx.realtime.add(marcoId, {
    raw: { write: (chunk: string) => received.push(chunk), end: () => {} },
  } as never);

  await ana.pay('marco', '7.50', { note: 'coffee' });

  const payloads = received
    .filter((chunk) => chunk.startsWith('data:'))
    .map((chunk) => JSON.parse(chunk.slice(5)));
  const newEvent = payloads.find((payload) => payload.type === 'event.new');
  assert.equal(newEvent.event.amountMicros, '7500000');
  assert.equal(newEvent.event.mine, false, 'the recipient should see it as incoming');
  assert.ok(payloads.some((payload) => payload.type === 'balance.updated'));
});
