import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { ThreadRow, UserRow } from '../db.js';
import { forbidden, notFound } from '../errors.js';
import { publishEvent } from '../notify.js';
import { requireUser } from '../session.js';
import { groupSummary, publicUser, threadEvent, threadEvents, threadSummary } from '../serialize.js';
import { asObject, handleParam, str } from '../validate.js';

const PAGE_SIZE = 30;

/**
 * A conversation is addressed either by the other person's handle or, for a
 * group, by its id. Everything downstream treats the two the same.
 */
export function resolveThread(ctx: AppContext, user: UserRow, ref: string): {
  thread: ThreadRow; peer: UserRow | null;
} {
  const { store } = ctx;

  if (ref.startsWith('thr_')) {
    const thread = store.getThread(ref);
    if (!thread) throw notFound('thread_not_found', 'That conversation is gone');
    if (!store.isThreadMember(thread.id, user.id)) throw forbidden('That conversation is not yours');
    const peer = thread.kind === 'direct'
      ? store.threadMemberIds(thread.id).filter((id) => id !== user.id)
          .map((id) => store.getUser(id))[0] ?? null
      : null;
    return { thread, peer };
  }

  const peer = store.getUserByHandle(handleParam(ref));
  if (!peer) throw notFound('handle_not_found', 'No one goes by that name yet');
  return { thread: store.getOrCreateThread(user.id, peer.id), peer };
}

export async function threadRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store } = ctx;

  app.get('/api/threads', async (request) => {
    const user = requireUser(store, request);
    const threads = store.listThreads(user.id)
      .map((thread) => threadSummary(store, thread, user.id))
      .filter((summary): summary is NonNullable<typeof summary> => summary !== null);
    return { threads };
  });

  app.get('/api/threads/:ref', async (request) => {
    const user = requireUser(store, request);
    const { thread, peer } = resolveThread(ctx, user, (request.params as { ref: string }).ref);
    const { before } = request.query as { before?: string };

    const cursor = before ? Number(before) : Number.MAX_SAFE_INTEGER;
    const rows = store.listEvents(thread.id, { before: cursor, limit: PAGE_SIZE });
    const oldest = rows[0]?.created_at ?? 0;
    const members = store.threadMemberIds(thread.id)
      .map((id) => store.getUser(id))
      .filter((member): member is UserRow => member !== null);

    return {
      threadId: thread.id,
      kind: thread.kind,
      peer: peer ? publicUser(peer) : null,
      title: thread.title,
      emoji: thread.emoji,
      members: members.map(publicUser),
      events: threadEvents(store, rows, user.id),
      hasMore: rows.length === PAGE_SIZE && store.countEventsBefore(thread.id, oldest) > 0,
      group: thread.kind === 'group' ? groupSummary(store, thread, user.id) : null,
    };
  });

  app.post('/api/threads/:ref/messages', async (request) => {
    const user = requireUser(store, request);
    const { thread, peer } = resolveThread(ctx, user, (request.params as { ref: string }).ref);
    const body = asObject(request.body);
    const text = str(body['body'], 'Message', { max: 500 });

    const event = store.createEvent({
      threadId: thread.id, kind: 'note', from: user.id,
      // In a group a message is addressed to the room, not one person.
      to: peer?.id ?? thread.id, body: text,
    });
    store.touchThread(thread.id, event.id, user.id);
    publishEvent(ctx, event, 'event.new');

    return { event: threadEvent(store, event, user.id) };
  });

  app.post('/api/threads/:ref/read', async (request) => {
    const user = requireUser(store, request);
    const { thread } = resolveThread(ctx, user, (request.params as { ref: string }).ref);
    store.markThreadRead(thread.id, user.id);
    return { ok: true };
  });
}
