import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519';
import { formatUsd, parseAmount } from '@solder/shared';
import { SimulatedChain } from './chain/simulated.js';
import { harness } from './testkit.js';

test('money moves from one person to the other', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana', 'Ana Ruiz');
  const marco = await app.actor('marco', 'Marco Silva');
  await ana.fund('100');

  const result = await ana.pay('marco', '12.50', { note: 'thai food', emoji: '🍜' });

  assert.equal(result.event.amountMicros, '12500000');
  assert.equal(result.event.note, 'thai food');
  assert.equal(result.event.mine, true);
  assert.equal(formatUsd(await ana.balance()), '$87.50');
  assert.equal(formatUsd(await marco.balance()), '$12.50');
});

test('a payment shows up in both people\'s threads, told from each side', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  await ana.fund('50');
  await ana.pay('marco', '5');

  const anaView = await ana.call('GET', '/api/threads/marco');
  const marcoView = await marco.call('GET', '/api/threads/ana');

  assert.equal(anaView.events.at(-1).mine, true);
  assert.equal(marcoView.events.at(-1).mine, false);
  assert.equal(marcoView.events.at(-1).from, 'ana');

  // The recipient sees an unread badge until they open the thread.
  const threads = await marco.call('GET', '/api/threads');
  assert.equal(threads.threads[0].unread, 1);
  await marco.call('POST', '/api/threads/ana/read');
  assert.equal((await marco.call('GET', '/api/threads')).threads[0].unread, 0);
});

test('a signature over different bytes is refused', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  await ana.fund('100');

  const prepared = await ana.prepare('marco', '10');
  const forged = Buffer.from('SOLDER-TRANSFER-V1|evt_x|a|b|1|9').toString('base64');

  const response = await ana.raw('POST', `/api/payments/${prepared.paymentId}/submit`, {
    signatureB64: ana.sign(forged),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'bad_signature');
  assert.equal(await ana.balance(), 100_000_000n);
});

test('someone else\'s signature is refused', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  await ana.fund('100');

  const prepared = await ana.prepare('marco', '10');
  const response = await ana.raw('POST', `/api/payments/${prepared.paymentId}/submit`, {
    signatureB64: marco.sign(prepared.messageB64), // right bytes, wrong person
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'bad_signature');
  assert.equal(await ana.balance(), 100_000_000n);
});

test('tampered message bytes never reach the ledger', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const store = app.ctx.store;
  const chain = new SimulatedChain(store);
  const seed = ed25519.utils.randomPrivateKey();
  const from = (await import('bs58')).default.encode(ed25519.getPublicKey(seed));
  const to = (await import('bs58')).default.encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()));
  await chain.ensureAccount(from);
  await chain.fund(from, parseAmount('100'));

  const prepared = await chain.prepareTransfer({ ref: 'evt_1', from, to, micros: parseAmount('10') });

  // Rewrite the amount after the server composed it, then sign the new bytes.
  const original = Buffer.from(prepared.messageB64, 'base64').toString('utf8');
  const tampered = original.replace('|10000000|', '|99000000|');
  const tamperedB64 = Buffer.from(tampered, 'utf8').toString('base64');
  const signature = Buffer.from(ed25519.sign(Buffer.from(tampered, 'utf8'), seed)).toString('base64');

  const record = { ref: 'evt_1', from, to, micros: parseAmount('10') };
  await assert.rejects(
    () => chain.submitTransfer({ transfer: record, messageB64: tamperedB64, signatureB64: signature }),
    (error: Error) => /verified/.test(error.message),
  );

  // The untampered bytes still go through, so the check is not simply refusing everything.
  const honest = Buffer.from(ed25519.sign(Buffer.from(original, 'utf8'), seed)).toString('base64');
  const ok = await chain.submitTransfer({
    transfer: record, messageB64: prepared.messageB64, signatureB64: honest,
  });
  assert.equal(ok.status, 'pending');
  assert.equal(await chain.getBalance(from), parseAmount('90'));
});

test('a payment cannot be submitted twice', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  await ana.fund('100');

  const prepared = await ana.prepare('marco', '10');
  const signatureB64 = ana.sign(prepared.messageB64);
  await ana.call('POST', `/api/payments/${prepared.paymentId}/submit`, { signatureB64 });

  const replay = await ana.raw('POST', `/api/payments/${prepared.paymentId}/submit`, { signatureB64 });
  assert.equal(replay.statusCode, 400);
  assert.equal(replay.json().error.code, 'already_submitted');
  assert.equal(formatUsd(await ana.balance()), '$90.00');
});

test('a payment left unsigned for too long expires', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  await ana.fund('100');

  const prepared = await ana.prepare('marco', '10');
  app.ctx.store.db.prepare('UPDATE prepared_payments SET expires_at = ? WHERE id = ?')
    .run(Date.now() - 1, prepared.paymentId);

  const response = await ana.raw('POST', `/api/payments/${prepared.paymentId}/submit`, {
    signatureB64: ana.sign(prepared.messageB64),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'expired');
  assert.equal(await ana.balance(), 100_000_000n);
});

test('sending more than you have fails cleanly', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  await ana.fund('5');

  const response = await ana.raw('POST', '/api/payments', {
    toHandle: 'marco', amountMicros: parseAmount('50').toString(),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'insufficient_funds');
  assert.match(response.json().error.message, /more than you have/);
  assert.equal(await ana.balance(), 5_000_000n);
});

test('you cannot pay yourself, or a name nobody has', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await ana.fund('50');

  const self = await ana.raw('POST', '/api/payments', {
    toHandle: 'ana', amountMicros: parseAmount('5').toString(),
  });
  assert.equal(self.statusCode, 400);
  assert.equal(self.json().error.code, 'self_payment');

  const ghost = await ana.raw('POST', '/api/payments', {
    toHandle: 'nobody', amountMicros: parseAmount('5').toString(),
  });
  assert.equal(ghost.statusCode, 404);
  assert.equal(ghost.json().error.code, 'handle_not_found');
});

test('the daily limit holds', async (t) => {
  const app = await harness({ dailySendLimitMicros: parseAmount('20') });
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  await ana.fund('100');

  await ana.pay('marco', '15');
  const response = await ana.raw('POST', '/api/payments', {
    toHandle: 'marco', amountMicros: parseAmount('10').toString(),
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'daily_limit');

  const me = await ana.call('GET', '/api/me');
  assert.equal(me.dailyRemainingMicros, '5000000');
});

test('a payment abandoned at the confirm prompt leaves no trace', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  await ana.fund('100');

  const prepared = await ana.prepare('marco', '10');
  assert.ok(app.ctx.store.getEvent(prepared.eventId));

  // The thread does not show it until it is actually sent.
  assert.equal((await ana.call('GET', '/api/threads')).threads.length, 0);

  app.ctx.store.db.prepare('UPDATE prepared_payments SET expires_at = ? WHERE id = ?')
    .run(Date.now() - 1, prepared.paymentId);
  await new Promise((resolve) => setTimeout(resolve, 600));

  assert.equal(app.ctx.store.getEvent(prepared.eventId), null);
});

test('payments settle from pending to confirmed on their own', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  await ana.fund('100');

  const result = await ana.pay('marco', '10');
  assert.equal(result.event.status, 'pending');

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const thread = await ana.call('GET', '/api/threads/marco');
  assert.equal(thread.events.at(-1).status, 'confirmed');
  assert.ok(thread.events.at(-1).confirmedAt > 0);
});
