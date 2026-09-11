import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { requireUser } from '../session.js';
import { asObject, str } from '../validate.js';

const MAX_BLOB_BYTES = 8 * 1024;
const ALLOWED_ALGS = new Set(['prf-hkdf-aesgcm', 'pin-pbkdf2-aesgcm']);

/**
 * The encrypted-backup endpoint. The blob is ciphertext the server has no key
 * for: it is stored and handed back verbatim, never inspected, never decrypted.
 * This is what makes "no phrase to write down" survive a lost phone.
 */
export async function vaultRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store, chain } = ctx;

  app.put('/api/vault', async (request) => {
    const user = requireUser(store, request);
    const body = asObject(request.body);
    const blob = str(body['blob'], 'blob', { max: MAX_BLOB_BYTES });
    const alg = str(body['alg'], 'alg', { max: 40 });
    const pubkey = str(body['accountKey'], 'accountKey', { max: 64 });

    if (!ALLOWED_ALGS.has(alg)) throw badRequest('bad_alg', 'Unsupported backup format');
    try {
      JSON.parse(blob);
    } catch {
      throw badRequest('bad_blob', 'Unsupported backup format');
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pubkey)) {
      throw badRequest('bad_account_key', 'Unsupported account key');
    }

    if (user.pubkey && user.pubkey !== pubkey) {
      throw conflict('account_key_set', 'This account already has money set up');
    }
    const owner = store.getUserByPubkey(pubkey);
    if (owner && owner.id !== user.id) {
      throw conflict('account_key_taken', 'Unsupported account key');
    }

    store.transaction(() => {
      store.putVault(user.id, blob, alg);
      if (!user.pubkey) store.setUserPubkey(user.id, pubkey);
    });
    await chain.ensureAccount(pubkey);

    return { ok: true };
  });

  app.get('/api/vault', async (request) => {
    const user = requireUser(store, request);
    const vault = store.getVault(user.id);
    if (!vault) throw notFound('no_backup', "We couldn't find your account on this device");
    return vault;
  });
}
