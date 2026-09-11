import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd, parseAmount } from '@solder/shared';
import { harness } from './testkit.js';

const usd = (value: string) => parseAmount(value).toString();

test('a group is a conversation everyone can talk and pay in', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana', 'Ana Ruiz');
  const marco = await app.actor('marco', 'Marco Silva');
  const jules = await app.actor('jules', 'Jules Okafor');

  const group = await ana.call('POST', '/api/groups', {
    title: 'Paris trip', emoji: '🗼', handles: ['marco', 'jules'],
  });
  assert.equal(group.members.length, 3);

  await marco.call('POST', `/api/threads/${group.threadId}/messages`, { body: 'booked the hotel' });
  const view = await jules.call('GET', `/api/threads/${group.threadId}`);
  assert.equal(view.kind, 'group');
  assert.equal(view.title, 'Paris trip');
  assert.equal(view.members.length, 3);
  assert.equal(view.events.at(-1).body, 'booked the hotel');

  // It shows up in every member's list, with the right unread count.
  const threads = await jules.call('GET', '/api/threads');
  assert.equal(threads.threads[0].kind, 'group');
  assert.equal(threads.threads[0].unread, 2);
});

test('the ledger works out what everyone owes', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana', 'Ana Ruiz');
  const marco = await app.actor('marco', 'Marco Silva');
  const jules = await app.actor('jules', 'Jules Okafor');
  const group = await ana.call('POST', '/api/groups', {
    title: 'Paris trip', handles: ['marco', 'jules'],
  });

  await ana.call('POST', `/api/groups/${group.threadId}/expenses`, { amountMicros: usd('400'), note: 'hotel' });
  await marco.call('POST', `/api/groups/${group.threadId}/expenses`, { amountMicros: usd('120'), note: 'train' });
  await jules.call('POST', `/api/groups/${group.threadId}/expenses`, { amountMicros: usd('180'), note: 'dinner' });

  const { group: ledger } = await marco.call('GET', `/api/groups/${group.threadId}`);
  assert.equal(formatUsd(BigInt(ledger.totalMicros)), '$700.00');

  // Nets always cancel out, to the micro.
  const nets = ledger.members.map((m: { netMicros: string }) => BigInt(m.netMicros));
  assert.equal(nets.reduce((a: bigint, b: bigint) => a + b, 0n), 0n);

  // Marco paid the least, so he owes the most — to Ana, who paid the most.
  assert.deepEqual(ledger.youOwe.map((o: { handle: string }) => o.handle), ['ana']);
  assert.equal(ledger.youAreOwed.length, 0);
  assert.equal(ledger.settlements.length, 2, 'three people should settle in two payments');
});

test('settling up inside a group clears the debt', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  await marco.fund('200');
  const group = await ana.call('POST', '/api/groups', { title: 'Dinner', handles: ['marco'] });

  await ana.call('POST', `/api/groups/${group.threadId}/expenses`, { amountMicros: usd('100'), note: 'the bill' });

  const before = await marco.call('GET', `/api/groups/${group.threadId}`);
  assert.equal(before.group.youOwe[0].handle, 'ana');
  assert.equal(before.group.youOwe[0].micros, usd('50'));

  await marco.pay('ana', '50', { threadId: group.threadId });

  const after = await marco.call('GET', `/api/groups/${group.threadId}`);
  assert.equal(after.group.youOwe.length, 0, 'the debt should be cleared');
  assert.equal(after.group.settlements.length, 0);
  assert.equal(formatUsd(await ana.balance()), '$50.00');

  // The settlement is a message in the group, not a side conversation.
  const thread = await marco.call('GET', `/api/threads/${group.threadId}`);
  assert.equal(thread.events.at(-1).kind, 'payment');
  assert.equal((await marco.call('GET', '/api/threads')).threads.length, 1);
});

test('a group is private to its members', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  const stranger = await app.actor('priya');
  const group = await ana.call('POST', '/api/groups', { title: 'Dinner', handles: ['marco'] });

  assert.equal((await stranger.raw('GET', `/api/groups/${group.threadId}`)).statusCode, 403);
  assert.equal((await stranger.raw('GET', `/api/threads/${group.threadId}`)).statusCode, 403);
  assert.equal((await stranger.raw('POST', `/api/threads/${group.threadId}/messages`,
    { body: 'hello?' })).statusCode, 403);
  assert.equal((await stranger.raw('POST', `/api/groups/${group.threadId}/expenses`,
    { amountMicros: usd('10') })).statusCode, 403);
});

test('people can be added to a group later', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await app.actor('marco');
  const jules = await app.actor('jules');
  const group = await ana.call('POST', '/api/groups', { title: 'Dinner', handles: ['marco'] });

  assert.equal((await jules.raw('GET', `/api/groups/${group.threadId}`)).statusCode, 403);
  await ana.call('POST', `/api/groups/${group.threadId}/members`, { handles: ['jules'] });
  const view = await jules.call('GET', `/api/groups/${group.threadId}`);
  assert.equal(view.group.members.length, 3);

  // Adding the same person again is a no-op rather than an error.
  assert.deepEqual((await ana.call('POST', `/api/groups/${group.threadId}/members`,
    { handles: ['jules'] })).added, []);
});

test('a surprise keeps its amount secret until it is opened', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  await ana.fund('100');

  const sent = await ana.pay('marco', '25', { gift: true, note: 'happy birthday', emoji: '🎁' });
  assert.equal(sent.event.gift, true);
  // The sender knows what they sent.
  assert.equal(sent.event.amountMicros, usd('25'));

  // The recipient does not — the amount is not in the response at all.
  const before = await marco.call('GET', '/api/threads/ana');
  const gift = before.events.at(-1);
  assert.equal(gift.gift, true);
  assert.equal(gift.revealed, false);
  assert.equal(gift.amountMicros, null);
  assert.ok(!JSON.stringify(before).includes('25000000'), 'the amount must not leak in the payload');

  const opened = await marco.call('POST', `/api/events/${gift.id}/reveal`);
  assert.equal(opened.event.revealed, true);
  assert.equal(opened.event.amountMicros, usd('25'));
  // The money arrived either way; only the telling was delayed.
  assert.equal(formatUsd(await marco.balance()), '$25.00');
});

test('only the recipient can open a surprise', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');
  const nosy = await app.actor('priya');
  await ana.fund('100');

  const sent = await ana.pay('marco', '25', { gift: true });
  assert.equal((await nosy.raw('POST', `/api/events/${sent.event.id}/reveal`)).statusCode, 403);
  assert.equal((await ana.raw('POST', `/api/events/${sent.event.id}/reveal`)).statusCode, 403);
  assert.equal((await marco.raw('POST', `/api/events/${sent.event.id}/reveal`)).statusCode, 200);
});
