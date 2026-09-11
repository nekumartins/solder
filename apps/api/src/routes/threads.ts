import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { notFound } from '../errors.js';
import { publishEvent } from '../notify.js';
import { requireUser } from '../session.js';
import { publicUser, threadEvent, threadEvents, threadSummary } from '../serialize.js';
import { asObject, handleParam, str } from '../validate.js';

const PAGE_SIZE = 30;

export async function threadRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store } = ctx;

  app.get('/api/threads', async (request) => {
    const user = requireUser(store, request);
    const threads = store.listThreads(user.id)
      .map((thread) => threadSummary(store, thread, user.id))
      .filter((summary): summary is NonNullable<typeof summary> => summary !== null);
    return { threads };
  });

  app.get('/api/threads/:handle', async (request) => {
    const user = requireUser(store, request);
    const handle = handleParam((request.params as { handle: string }).handle);
    const { before } = request.query as { before?: string };

    const peer = store.getUserByHandle(handle);
    if (!peer) throw notFound('handle_not_found', 'No one goes by that name yet');

    const thread = store.getOrCreateThread(user.id, peer.id);
    const cursor = before ? Number(before) : Number.MAX_SAFE_INTEGER;
    const rows = store.listEvents(thread.id, { before: cursor, limit: PAGE_SIZE });
    const oldest = rows[0]?.created_at ?? 0;

    return {
      threadId: thread.id,
      peer: publicUser(peer),
      events: threadEvents(store, rows, user.id),
      hasMore: rows.length === PAGE_SIZE && store.countEventsBefore(thread.id, oldest) > 0,
    };
  });

  app.post('/api/threads/:handle/messages', async (request) => {
    const user = requireUser(store, request);
    const handle = handleParam((request.params as { handle: string }).handle);
    const body = asObject(request.body);
    const text = str(body['body'], 'Message', { max: 500 });

    const peer = store.getUserByHandle(handle);
    if (!peer) throw notFound('handle_not_found', 'No one goes by that name yet');

    const thread = store.getOrCreateThread(user.id, peer.id);
    const event = store.createEvent({
      threadId: thread.id, kind: 'note', from: user.id, to: peer.id, body: text,
    });
    store.touchThread(thread.id, event.id, peer.id, true);
    publishEvent(ctx, event, 'event.new');

    return { event: threadEvent(store, event, user.id) };
  });

  app.post('/api/threads/:handle/read', async (request) => {
    const user = requireUser(store, request);
    const handle = handleParam((request.params as { handle: string }).handle);
    const peer = store.getUserByHandle(handle);
    if (!peer) throw notFound('handle_not_found', 'No one goes by that name yet');
    store.markThreadRead(store.getOrCreateThread(user.id, peer.id).id, user.id);
    return { ok: true };
  });
}
