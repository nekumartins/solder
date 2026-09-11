import type { FastifyInstance } from 'fastify';
import { COPY, splitShares } from '@solder/shared';
import type { AppContext } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { publishEvent } from '../notify.js';
import { requireUser } from '../session.js';
import { splitProgress, threadEvent } from '../serialize.js';
import { asObject, emoji, handleArg, handleList, micros, optionalStr } from '../validate.js';

export async function requestRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { store } = ctx;

  app.post('/api/requests', async (request) => {
    const user = requireUser(store, request);
    const body = asObject(request.body);
    const toHandle = handleArg(body['toHandle']);
    const amount = micros(body['amountMicros'], 'amount');
    const note = optionalStr(body['note'], 'note', 140);
    const noteEmoji = emoji(body['emoji']);

    const peer = store.getUserByHandle(toHandle);
    if (!peer) throw notFound('handle_not_found', COPY.pay.unknownPerson);
    if (peer.id === user.id) throw badRequest('self_request', "You can't ask yourself for money");

    const thread = store.getOrCreateThread(user.id, peer.id);
    const event = store.createEvent({
      threadId: thread.id, kind: 'request', from: user.id, to: peer.id,
      amountMicros: amount, note, emoji: noteEmoji, status: 'open',
    });
    store.touchThread(thread.id, event.id, peer.id, true);
    publishEvent(ctx, event, 'event.new');

    return { event: threadEvent(store, event, user.id) };
  });

  app.post('/api/requests/:id/decline', async (request) => {
    const user = requireUser(store, request);
    const event = loadOpenRequest(store, (request.params as { id: string }).id);
    // Only the person being asked can decline.
    if (event.to_user !== user.id) throw forbidden('That request is not yours to decline');

    store.setEventStatus(event.id, 'declined');
    if (event.split_id) store.setSplitParticipantStatus(event.split_id, user.id, 'declined');
    const updated = store.getEvent(event.id)!;
    publishEvent(ctx, updated, 'event.updated');
    return { event: threadEvent(store, updated, user.id) };
  });

  app.post('/api/requests/:id/cancel', async (request) => {
    const user = requireUser(store, request);
    const event = loadOpenRequest(store, (request.params as { id: string }).id);
    // Only the person who asked can take it back.
    if (event.from_user !== user.id) throw forbidden('That request is not yours to cancel');

    store.setEventStatus(event.id, 'cancelled');
    if (event.split_id) store.setSplitParticipantStatus(event.split_id, event.to_user, 'cancelled');
    const updated = store.getEvent(event.id)!;
    publishEvent(ctx, updated, 'event.updated');
    return { event: threadEvent(store, updated, user.id) };
  });

  app.post('/api/splits', async (request) => {
    const user = requireUser(store, request);
    const body = asObject(request.body);
    const total = micros(body['totalMicros'], 'total');
    const handles = handleList(body['handles'], 'handles');
    const note = optionalStr(body['note'], 'note', 140);

    if (handles.includes(user.handle)) throw badRequest('self_split', "You're already included");

    const people = handles.map((handle) => {
      const peer = store.getUserByHandle(handle);
      if (!peer) throw notFound('handle_not_found', `No one goes by @${handle} yet`);
      return peer;
    });

    // The creator covers a share too, so the bill divides between everyone.
    const shares = splitShares(total, people.length + 1);

    const split = store.transaction(() => {
      const created = store.createSplit(user.id, total, note);
      people.forEach((peer, index) => {
        const share = shares[index + 1]!;
        const thread = store.getOrCreateThread(user.id, peer.id);
        const event = store.createEvent({
          threadId: thread.id, kind: 'request', from: user.id, to: peer.id,
          amountMicros: share, note, status: 'open', splitId: created.id,
        });
        store.touchThread(thread.id, event.id, peer.id, true);
        store.addSplitParticipant(created.id, peer.id, share, event.id);
      });
      return created;
    });

    for (const participant of store.splitParticipants(split.id)) {
      if (!participant.request_event_id) continue;
      const event = store.getEvent(participant.request_event_id);
      if (event) publishEvent(ctx, event, 'event.new');
    }

    return {
      split: splitProgress(store, split.id, (id) => store.getUser(id)),
      yourShare: shares[0]!.toString(),
    };
  });

  app.get('/api/splits/:id', async (request) => {
    const user = requireUser(store, request);
    const { id } = request.params as { id: string };
    const split = store.getSplit(id);
    if (!split) throw notFound('split_not_found', 'That bill is gone');

    const participants = store.splitParticipants(id);
    const involved = split.creator_id === user.id || participants.some((p) => p.user_id === user.id);
    if (!involved) throw forbidden('That bill is not yours');

    return { split: splitProgress(store, id, (userId) => store.getUser(userId)) };
  });

  app.post('/api/events/:id/reactions', async (request) => {
    const user = requireUser(store, request);
    const { id } = request.params as { id: string };
    const body = asObject(request.body);
    const reaction = emoji(body['emoji']);
    if (!reaction) throw badRequest('bad_emoji', 'Pick a single emoji');

    const event = store.getEvent(id);
    if (!event) throw notFound('event_not_found', 'That message is gone');
    if (event.from_user !== user.id && event.to_user !== user.id) {
      throw forbidden('That message is not yours');
    }

    const result = store.toggleReaction(id, user.id, reaction);
    publishEvent(ctx, event, 'event.updated');
    return { result, event: threadEvent(store, event, user.id) };
  });
}

function loadOpenRequest(store: AppContext['store'], id: string) {
  const event = store.getEvent(id);
  if (!event || event.kind !== 'request') throw notFound('request_not_found', 'That request is gone');
  if (event.status !== 'open') throw conflict('request_closed', 'That request is no longer open');
  return event;
}
