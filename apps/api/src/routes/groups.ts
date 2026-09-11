import type { FastifyInstance } from 'fastify';
import { COPY } from '@solder/shared';
import type { AppContext } from '../context.js';
import type { UserRow } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { publishEvent } from '../notify.js';
import { requireUser } from '../session.js';
import { groupSummary, publicUser, threadEvent } from '../serialize.js';
import { asObject, emoji, handleList, micros, optionalStr, str } from '../validate.js';

/**
 * Groups: a trip, a flat, a table at dinner.
 *
 * A group is a thread with more than two members, so chat, payments, requests
 * and reactions all work inside one without any new machinery. What groups add
 * is a ledger — who paid for what, and the shortest way to square up.
 */
export async function groupRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store } = ctx;

  app.post('/api/groups', async (request) => {
    const user = requireUser(store, request);
    const body = asObject(request.body);
    const title = str(body['title'], 'Name', { max: 40 });
    const groupEmoji = emoji(body['emoji']);
    const handles = handleList(body['handles'], 'handles');

    if (handles.includes(user.handle)) throw badRequest('self_member', "You're already in it");
    const members = handles.map((handle) => {
      const member = store.getUserByHandle(handle);
      if (!member) throw notFound('handle_not_found', `No one goes by @${handle} yet`);
      return member;
    });

    const thread = store.createGroupThread(user.id, title, groupEmoji, members.map((m) => m.id));
    const event = store.createEvent({
      threadId: thread.id, kind: 'system', from: user.id, to: thread.id,
      body: `${user.display_name} started ${title}`,
    });
    store.touchThread(thread.id, event.id, user.id);
    publishEvent(ctx, event, 'event.new');

    return {
      threadId: thread.id,
      title,
      emoji: groupEmoji,
      members: [user, ...members].map(publicUser),
    };
  });

  app.get('/api/groups/:id', async (request) => {
    const { user, thread } = requireGroup(ctx, request);
    return {
      threadId: thread.id,
      title: thread.title,
      emoji: thread.emoji,
      group: groupSummary(store, thread, user.id),
    };
  });

  /** An expense is money one member already spent on everyone's behalf. */
  app.post('/api/groups/:id/expenses', async (request) => {
    const { user, thread } = requireGroup(ctx, request);
    const body = asObject(request.body);
    const amount = micros(body['amountMicros'], 'amount');
    const note = optionalStr(body['note'], 'note', 140);
    const expenseEmoji = emoji(body['emoji']);

    const event = store.createEvent({
      threadId: thread.id, kind: 'expense', from: user.id, to: thread.id,
      amountMicros: amount, note, emoji: expenseEmoji,
    });
    store.touchThread(thread.id, event.id, user.id);
    publishEvent(ctx, event, 'event.new');

    return {
      event: threadEvent(store, event, user.id),
      group: groupSummary(store, thread, user.id),
    };
  });

  app.post('/api/groups/:id/members', async (request) => {
    const { user, thread } = requireGroup(ctx, request);
    const body = asObject(request.body);
    const handles = handleList(body['handles'], 'handles');

    const added: UserRow[] = [];
    for (const handle of handles) {
      const member = store.getUserByHandle(handle);
      if (!member) throw notFound('handle_not_found', `No one goes by @${handle} yet`);
      if (store.isThreadMember(thread.id, member.id)) continue;
      store.addThreadMember(thread.id, member.id);
      added.push(member);
    }
    if (added.length === 0) return { added: [] };

    const event = store.createEvent({
      threadId: thread.id, kind: 'system', from: user.id, to: thread.id,
      body: `${user.display_name} added ${added.map((m) => m.display_name).join(', ')}`,
    });
    store.touchThread(thread.id, event.id, user.id);
    publishEvent(ctx, event, 'event.new');

    return { added: added.map(publicUser) };
  });

  /** Opening a gift. Only the person it was sent to, and only once. */
  app.post('/api/events/:id/reveal', async (request) => {
    const user = requireUser(store, request);
    const { id } = request.params as { id: string };
    const event = store.getEvent(id);
    if (!event || event.gift !== 1) throw notFound('event_not_found', 'That message is gone');
    if (event.to_user !== user.id) throw forbidden(COPY.gift.notYours);

    store.revealEvent(id);
    const revealed = store.getEvent(id)!;
    publishEvent(ctx, revealed, 'event.updated');
    return { event: threadEvent(store, revealed, user.id) };
  });
}

function requireGroup(ctx: AppContext, request: Parameters<typeof requireUser>[1]) {
  const user = requireUser(ctx.store, request);
  const { id } = request.params as { id: string };
  const thread = ctx.store.getThread(id);
  if (!thread || thread.kind !== 'group') throw notFound('group_not_found', 'That group is gone');
  if (!ctx.store.isThreadMember(thread.id, user.id)) throw forbidden('That group is not yours');
  return { user, thread };
}
