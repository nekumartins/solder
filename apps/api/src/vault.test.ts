import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './testkit.js';

const blobFor = (note: string) => JSON.stringify({
  v: 1, alg: 'prf-hkdf-aesgcm', salt: 'c2FsdHNhbHQ=', iv: 'aXZpdml2', ct: Buffer.from(note).toString('base64'),
});

test('the encrypted backup comes back byte-identical', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const blob = blobFor('ana-secret');
  await ana.call('PUT', '/api/vault', { blob, alg: 'prf-hkdf-aesgcm', accountKey: ana.accountKey });

  const fetched = await ana.call('GET', '/api/vault');
  assert.equal(fetched.blob, blob);
  assert.equal(fetched.alg, 'prf-hkdf-aesgcm');
});

test('the server stores the backup without ever reading inside it', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const blob = blobFor('ana-secret');
  await ana.call('PUT', '/api/vault', { blob, alg: 'prf-hkdf-aesgcm', accountKey: ana.accountKey });

  // Whatever the server holds is exactly the ciphertext the client handed over:
  // there is no column anywhere holding a key that could open it.
  const stored = app.ctx.store.getVault(app.ctx.store.getUserByHandle('ana')!.id)!;
  assert.equal(stored.blob, blob);
  const columns = app.ctx.store.db.prepare('PRAGMA table_info(vaults)').all() as Array<{ name: string }>;
  assert.deepEqual(columns.map((c) => c.name).sort(), ['alg', 'blob', 'updated_at', 'user_id']);
});

test('one person cannot read another person\'s backup', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  await ana.call('PUT', '/api/vault', {
    blob: blobFor('ana-secret'), alg: 'prf-hkdf-aesgcm', accountKey: ana.accountKey,
  });

  const marco = await app.actor('marco');
  const response = await marco.raw('GET', '/api/vault');
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'no_backup');
});

test('an account key cannot be swapped out once money is set up', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const marco = await app.actor('marco');

  const response = await ana.raw('PUT', '/api/vault', {
    blob: blobFor('x'), alg: 'prf-hkdf-aesgcm', accountKey: marco.accountKey,
  });
  assert.equal(response.statusCode, 409);
});

test('garbage backups are refused', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  for (const payload of [
    { blob: 'not json', alg: 'prf-hkdf-aesgcm', accountKey: ana.accountKey },
    { blob: blobFor('x'), alg: 'rot13', accountKey: ana.accountKey },
    { blob: blobFor('x'), alg: 'prf-hkdf-aesgcm', accountKey: 'not-a-key' },
  ]) {
    const response = await ana.raw('PUT', '/api/vault', payload);
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
});
