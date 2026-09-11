import type { FastifyInstance } from 'fastify';
import { normalizeHandle, validateHandle } from '@solder/shared';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { currentUser, requireUser } from '../session.js';
import { publicUser } from '../serialize.js';
import { handleParam } from '../validate.js';

export async function userRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store, chain, config } = ctx;

  app.get('/api/me', async (request) => {
    const user = requireUser(store, request);
    const balance = user.pubkey ? await chain.getBalance(user.pubkey) : 0n;
    const spentToday = store.sentSince(user.id, Date.now() - 24 * 60 * 60 * 1000);
    const remaining = config.dailySendLimitMicros - spentToday;
    return {
      user: {
        id: user.id,
        handle: user.handle,
        displayName: user.display_name,
        accountKey: user.pubkey,
        createdAt: user.created_at,
      },
      balanceMicros: balance.toString(),
      dailyRemainingMicros: (remaining > 0n ? remaining : 0n).toString(),
      chain: config.chain,
      devLogin: config.devLogin,
      canFund: chain.canFund,
    };
  });

  app.get('/api/users/handle-available', async (request) => {
    const { handle } = request.query as { handle?: string };
    const check = validateHandle(handle ?? '');
    if (!check.ok) return { available: false, reason: check.reason };
    if (store.getUserByHandle(check.handle)) return { available: false, reason: 'Already taken' };
    return { available: true, handle: check.handle };
  });

  app.get('/api/users/search', async (request) => {
    const user = requireUser(store, request);
    const { q } = request.query as { q?: string };
    const query = normalizeHandle(q ?? '');
    if (query.length === 0) return { results: [] };
    return { results: store.searchUsers(query, user.id).map(publicUser) };
  });

  /** Public profile — enough to show who you are paying, and nothing more. */
  app.get('/api/users/:handle', async (request) => {
    const handle = handleParam((request.params as { handle: string }).handle);
    const user = store.getUserByHandle(handle);
    if (!user) throw notFound('handle_not_found', 'No one goes by that name yet');
    const viewer = currentUser(store, request);
    return {
      user: publicUser(user),
      isYou: viewer?.id === user.id,
      canReceive: Boolean(user.pubkey),
    };
  });
}
