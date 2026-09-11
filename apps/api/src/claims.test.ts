import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secp256k1 } from '@noble/curves/secp256k1';
import { formatUsd, parseAmount } from '@solder/shared';
import { addressFromPrivateKey, signDigest } from './chain/eip3009.js';
import { harness, type Harness } from './testkit.js';

/** The sender's device derives this and puts it in the link; nobody else sees it. */
function escrow() {
  const seed = secp256k1.utils.randomPrivateKey();
  return {
    seed,
    address: addressFromPrivateKey(seed),
    sign: (messageB64: string) =>
      Buffer.from(signDigest(Buffer.from(messageB64, 'base64'), seed)).toString('base64'),
  };
}

async function sendByLink(app: Harness, from: Awaited<ReturnType<Harness['actor']>>, amount: string) {
  const holding = escrow();
  const created = await from.call('POST', '/api/claims', {
    amountMicros: parseAmount(amount).toString(), note: 'For Uber', emoji: '🚕',
    escrowAddress: holding.address,
  });
  await from.call('POST', `/api/claims/${created.claimId}/fund`, {
    paymentId: created.paymentId, signatureB64: from.sign(created.messageB64),
  });
  return { holding, claimId: created.claimId as string };
}

test('money sent to nobody waits in a holding account', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana', 'Ana Ruiz');
  await ana.fund('100');
  const { claimId, holding } = await sendByLink(app, ana, '20');

  assert.equal(formatUsd(await ana.balance()), '$80.00');
  assert.equal(await app.ctx.chain.getBalance(holding.address), parseAmount('20'));

  // Anyone with the link can see who sent what, without being signed in.
  const anonymous = await app.app.inject({ method: 'GET', url: `/api/claims/${claimId}` });
  assert.equal(anonymous.statusCode, 200);
  assert.deepEqual(anonymous.json().claim.from, { handle: 'ana', displayName: 'Ana Ruiz' });
  assert.equal(anonymous.json().claim.amountMicros, '20000000');
  assert.equal(anonymous.json().claim.status, 'open');
});

test('a brand new person picks the money up with the link', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana', 'Ana Ruiz');
  await ana.fund('100');
  const { claimId, holding } = await sendByLink(app, ana, '20');

  // Someone who did not exist when the money was sent.
  const newcomer = await app.actor('david', 'David Cole');
  const prepared = await newcomer.call('POST', `/api/claims/${claimId}/prepare`);
  const result = await newcomer.call('POST', `/api/claims/${claimId}/settle`, {
    paymentId: prepared.paymentId,
    signatureB64: holding.sign(prepared.messageB64), // only the link-holder can produce this
  });

  assert.equal(result.claim.status, 'claimed');
  assert.equal(result.reclaimed, false);
  assert.equal(formatUsd(await newcomer.balance()), '$20.00');
  assert.equal(await app.ctx.chain.getBalance(holding.address), 0n);

  // And it lands as an ordinary payment in a conversation between them.
  const thread = await newcomer.call('GET', '/api/threads/ana');
  assert.equal(thread.events.at(-1).kind, 'payment');
  assert.equal(thread.events.at(-1).note, 'For Uber');
  assert.equal(thread.events.at(-1).mine, false);
  assert.equal((await ana.call('GET', '/api/threads')).threads.length, 1);
});

test('a link cannot be picked up twice', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await ana.fund('100');
  const { claimId, holding } = await sendByLink(app, ana, '20');

  const david = await app.actor('david');
  const first = await david.call('POST', `/api/claims/${claimId}/prepare`);
  await david.call('POST', `/api/claims/${claimId}/settle`, {
    paymentId: first.paymentId, signatureB64: holding.sign(first.messageB64),
  });

  const someoneElse = await app.actor('mallory');
  const second = await someoneElse.raw('POST', `/api/claims/${claimId}/prepare`);
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, 'claim_closed');
  assert.equal(formatUsd(await someoneElse.balance()), '$0.00');
});

test('without the link there is no way to take the money', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await ana.fund('100');
  const { claimId } = await sendByLink(app, ana, '20');

  // A signed-in stranger who guessed the claim id but has no link secret.
  const mallory = await app.actor('mallory');
  const prepared = await mallory.call('POST', `/api/claims/${claimId}/prepare`);
  const attempt = await mallory.raw('POST', `/api/claims/${claimId}/settle`, {
    paymentId: prepared.paymentId,
    signatureB64: mallory.sign(prepared.messageB64), // their own key, not the holding account's
  });

  assert.equal(attempt.statusCode, 400);
  assert.equal(attempt.json().error.code, 'bad_signature');
  assert.equal(formatUsd(await mallory.balance()), '$0.00');
  // The link is still open for its intended recipient.
  assert.equal((await app.app.inject({ method: 'GET', url: `/api/claims/${claimId}` }))
    .json().claim.status, 'open');
});

test('the sender can take back a link nobody used', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await ana.fund('100');
  const { claimId, holding } = await sendByLink(app, ana, '20');
  assert.equal(formatUsd(await ana.balance()), '$80.00');

  const prepared = await ana.call('POST', `/api/claims/${claimId}/prepare`);
  const result = await ana.call('POST', `/api/claims/${claimId}/settle`, {
    paymentId: prepared.paymentId, signatureB64: holding.sign(prepared.messageB64),
  });

  assert.equal(result.reclaimed, true);
  assert.equal(result.claim.status, 'reclaimed');
  assert.equal(formatUsd(await ana.balance()), '$100.00');
  // Taking it back is not a payment to anyone, so no conversation appears.
  assert.equal((await ana.call('GET', '/api/threads')).threads.length, 0);
});

test('you cannot send a link for more than you have', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await ana.fund('5');
  const response = await ana.raw('POST', '/api/claims', {
    amountMicros: parseAmount('50').toString(), escrowAddress: escrow().address,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'insufficient_funds');
});

test('a holding account cannot be an existing account', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  await ana.fund('100');

  for (const address of [marco.accountKey, ana.accountKey, 'not-an-address']) {
    const response = await ana.raw('POST', '/api/claims', {
      amountMicros: parseAmount('5').toString(), escrowAddress: address,
    });
    assert.equal(response.statusCode, 400, `should refuse ${address}`);
  }
});

test('open links are listed so the sender can chase or cancel them', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await ana.fund('100');
  await sendByLink(app, ana, '20');
  await sendByLink(app, ana, '5');

  const { claims } = await ana.call('GET', '/api/claims');
  assert.equal(claims.length, 2);
  assert.ok(claims.every((claim: { status: string }) => claim.status === 'open'));
});
