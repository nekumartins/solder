import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1';
import { formatUsd, parseAmount } from '@solder/shared';
import {
  addressFromPrivateKey, authorizationDigest, signDigest,
} from './chain/eip3009.js';
import { DEMO_DOMAIN, SimulatedChain, demoAuthorization } from './chain/simulated.js';
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
  // A perfectly valid signature — over an authorisation nobody asked for.
  const forged = Buffer.from(authorizationDigest(DEMO_DOMAIN, demoAuthorization(
    { ref: 'evt_elsewhere', from: ana.accountKey, to: ana.accountKey, micros: parseAmount('10') },
    Date.now() + 60_000,
  ))).toString('base64');

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

test('tampered authorisations never reach the ledger', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const chain = new SimulatedChain(app.ctx.store);
  const seed = secp256k1.utils.randomPrivateKey();
  const from = addressFromPrivateKey(seed);
  const to = addressFromPrivateKey(secp256k1.utils.randomPrivateKey());
  await chain.ensureAccount(from);
  await chain.fund(from, parseAmount('100'));

  const record = { ref: 'evt_1', from, to, micros: parseAmount('10') };
  const prepared = await chain.prepareTransfer(record);

  // Re-authorise a bigger amount to a different person, and sign that properly.
  // The signature is valid; it just does not say what the server recorded.
  const tampered = authorizationDigest(DEMO_DOMAIN, demoAuthorization(
    { ...record, to: addressFromPrivateKey(secp256k1.utils.randomPrivateKey()), micros: parseAmount('99') },
    prepared.expiresAt,
  ));
  await assert.rejects(
    () => chain.submitTransfer({
      transfer: record,
      messageB64: Buffer.from(tampered).toString('base64'),
      signatureB64: Buffer.from(signDigest(tampered, seed)).toString('base64'),
      expiresAt: prepared.expiresAt,
    }),
    (error: Error) => /verified/.test(error.message),
  );
  assert.equal(await chain.getBalance(from), parseAmount('100'));

  // The honest authorisation still goes through, so the check is not simply
  // refusing everything.
  const honest = Buffer.from(prepared.messageB64, 'base64');
  const ok = await chain.submitTransfer({
    transfer: record,
    messageB64: prepared.messageB64,
    signatureB64: Buffer.from(signDigest(honest, seed)).toString('base64'),
    expiresAt: prepared.expiresAt,
  });
  assert.equal(ok.status, 'pending');
  assert.match(ok.signature, /^0x[0-9a-f]{64}$/);
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

test('turning demo funding off leaves no way to mint money', async (t) => {
  const app = await harness({ demoFunding: false });
  t.after(() => app.close());

  const ana = await app.actor('ana', 'Ana Ruiz');

  // The button is gone from the interface...
  assert.equal((await ana.call('GET', '/api/me')).canFund, false);
  // ...and so is the endpoint behind it, not merely hidden.
  const response = await ana.raw('POST', '/api/dev/fund', { micros: '25000000' });
  assert.equal(response.statusCode, 404);
  assert.equal(await ana.balance(), 0n);
});

test('demo funding is on by default, so the simulated ledger is usable', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana', 'Ana Ruiz');
  assert.equal((await ana.call('GET', '/api/me')).canFund, true);
  await ana.fund('25');
  assert.equal(formatUsd(await ana.balance()), '$25.00');
});
