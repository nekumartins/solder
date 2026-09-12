import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from './testkit.js';

test('a session survives across requests and ends on sign out', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana', 'Ana Ruiz');
  const me = await ana.call('GET', '/api/me');
  assert.equal(me.user.handle, 'ana');
  assert.equal(me.balanceMicros, '0');

  await ana.call('POST', '/api/auth/logout');
  const after = await ana.raw('GET', '/api/me');
  assert.equal(after.statusCode, 401);
});

test('the raw session token is never stored, only its hash', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const ana = await app.actor('ana');
  const token = ana.cookie.split('=')[1]!;
  const rows = app.ctx.store.db.prepare('SELECT token_hash FROM sessions').all() as Array<{ token_hash: string }>;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0]!.token_hash, token);
  assert.match(rows[0]!.token_hash, /^[0-9a-f]{64}$/);
});

test('the dev shortcut sign-in disappears when it is switched off', async (t) => {
  const app = await harness({ devLogin: false });
  t.after(() => app.close());

  app.ctx.store.createUser('ana', 'Ana');
  const response = await app.app.inject({
    method: 'POST', url: '/api/dev/login', payload: { handle: 'ana' },
  });
  assert.equal(response.statusCode, 404);
});

test('registration refuses a name that is already taken', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  await app.actor('ana');
  const response = await app.app.inject({
    method: 'POST', url: '/api/auth/register/options',
    payload: { handle: 'ana', displayName: 'Impostor' },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'handle_taken');
});

test('registration offers a passkey with the key-deriving extension enabled', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const response = await app.app.inject({
    method: 'POST', url: '/api/auth/register/options',
    payload: { handle: 'newcomer', displayName: 'New Comer' },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.challengeId);
  assert.deepEqual(body.options.extensions.prf, {});
  assert.equal(body.options.authenticatorSelection.residentKey, 'required');
  // No user was created yet — only a verified passkey creates an account.
  assert.equal(app.ctx.store.getUserByHandle('newcomer'), null);
});

test('an unpinned deployment takes the passkey domain from the request', async (t) => {
  const app = await harness({ domainPinned: false, rpId: 'localhost', origins: ['http://localhost:5173'] });
  t.after(() => app.close());

  const response = await app.app.inject({
    method: 'POST', url: '/api/auth/register/options',
    headers: { host: 'solder.up.railway.app', 'x-forwarded-proto': 'https' },
    payload: { handle: 'newcomer', displayName: 'New Comer' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().options.rp.id, 'solder.up.railway.app');
});

test('a browser-sent origin wins over the host header', async (t) => {
  const app = await harness({ domainPinned: false, rpId: 'localhost', origins: ['http://localhost:5173'] });
  t.after(() => app.close());

  const response = await app.app.inject({
    method: 'POST', url: '/api/auth/login/options',
    headers: { host: 'internal-proxy:8080', origin: 'https://pay.example.com' },
    payload: {},
  });
  assert.equal(response.json().options.rpId, 'pay.example.com');
});

test('an explicitly configured domain is never overridden by the request', async (t) => {
  const app = await harness({ domainPinned: true, rpId: 'solder.app', origins: ['https://solder.app'] });
  t.after(() => app.close());

  const response = await app.app.inject({
    method: 'POST', url: '/api/auth/register/options',
    headers: { host: 'evil.example.com', origin: 'https://evil.example.com' },
    payload: { handle: 'newcomer', displayName: 'New Comer' },
  });
  assert.equal(response.json().options.rp.id, 'solder.app');
});

test('the session cookie is Secure exactly when the request arrived over https', async (t) => {
  const app = await harness({ domainPinned: false, origins: ['http://localhost:5173'] });
  t.after(() => app.close());
  app.ctx.store.createUser('ana', 'Ana');

  const cookieFor = async (headers: Record<string, string>): Promise<string> => {
    const response = await app.app.inject({
      method: 'POST', url: '/api/dev/login', headers, payload: { handle: 'ana' },
    });
    const set = response.headers['set-cookie']!;
    return Array.isArray(set) ? set[0]! : String(set);
  };

  assert.match(await cookieFor({ 'x-forwarded-proto': 'https' }), /Secure/);
  // A Secure cookie over plain http is dropped, which would lock out local dev.
  assert.doesNotMatch(await cookieFor({}), /Secure/);
});

test('a pinned https origin keeps the cookie Secure whatever the request says', async (t) => {
  const app = await harness({ domainPinned: true, origins: ['https://solder.app'] });
  t.after(() => app.close());
  app.ctx.store.createUser('ana', 'Ana');

  const response = await app.app.inject({
    method: 'POST', url: '/api/dev/login',
    headers: { 'x-forwarded-proto': 'http' }, payload: { handle: 'ana' },
  });
  const set = response.headers['set-cookie']!;
  assert.match(Array.isArray(set) ? set[0]! : String(set), /Secure/);
});

test('a challenge cannot be replayed', async (t) => {
  const app = await harness();
  t.after(() => app.close());

  const { challengeId } = (await app.app.inject({
    method: 'POST', url: '/api/auth/register/options',
    payload: { handle: 'newcomer', displayName: 'New Comer' },
  })).json();

  assert.ok(app.ctx.store.takeChallenge(challengeId, 'register'));
  assert.equal(app.ctx.store.takeChallenge(challengeId, 'register'), null);
});
