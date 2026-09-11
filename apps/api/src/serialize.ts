import type { PublicUser, Reaction, SplitProgress, ThreadEvent, ThreadSummary } from '@solder/shared';
import type { EventRow, ReactionRow, Store, ThreadRow, UserRow } from './db.js';

export function publicUser(user: UserRow): PublicUser {
  return { handle: user.handle, displayName: user.display_name };
}

/**
 * Turns a stored event into the shape the app renders. Handles — never account
 * keys — identify the people involved.
 */
export function threadEvent(
  store: Store,
  row: EventRow,
  viewerId: string,
  cache = new Map<string, UserRow>(),
): ThreadEvent {
  const lookup = (id: string): UserRow | null => {
    if (cache.has(id)) return cache.get(id)!;
    const user = store.getUser(id);
    if (user) cache.set(id, user);
    return user;
  };

  const from = lookup(row.from_user);
  const to = lookup(row.to_user);
  const reactions = store.reactionsForEvents([row.id]);

  return {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind as ThreadEvent['kind'],
    from: from?.handle ?? 'someone',
    to: to?.handle ?? 'someone',
    mine: row.from_user === viewerId,
    amountMicros: row.amount_micros,
    note: row.note,
    emoji: row.emoji,
    body: row.body,
    status: row.status as ThreadEvent['status'],
    reference: row.chain_signature,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    reactions: reactions.map((reaction) => toReaction(store, reaction, viewerId, lookup)),
    split: row.split_id ? splitProgress(store, row.split_id, lookup) : null,
  };
}

/** Batch variant that shares one user cache and one reactions query. */
export function threadEvents(store: Store, rows: EventRow[], viewerId: string): ThreadEvent[] {
  const cache = new Map<string, UserRow>();
  const lookup = (id: string): UserRow | null => {
    if (cache.has(id)) return cache.get(id)!;
    const user = store.getUser(id);
    if (user) cache.set(id, user);
    return user;
  };

  const reactionRows = store.reactionsForEvents(rows.map((row) => row.id));
  const byEvent = new Map<string, ReactionRow[]>();
  for (const reaction of reactionRows) {
    const list = byEvent.get(reaction.event_id) ?? [];
    list.push(reaction);
    byEvent.set(reaction.event_id, list);
  }

  return rows.map((row) => {
    const from = lookup(row.from_user);
    const to = lookup(row.to_user);
    return {
      id: row.id,
      threadId: row.thread_id,
      kind: row.kind as ThreadEvent['kind'],
      from: from?.handle ?? 'someone',
      to: to?.handle ?? 'someone',
      mine: row.from_user === viewerId,
      amountMicros: row.amount_micros,
      note: row.note,
      emoji: row.emoji,
      body: row.body,
      status: row.status as ThreadEvent['status'],
      reference: row.chain_signature,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      reactions: (byEvent.get(row.id) ?? []).map((reaction) => toReaction(store, reaction, viewerId, lookup)),
      split: row.split_id ? splitProgress(store, row.split_id, lookup) : null,
    };
  });
}

export function threadSummary(store: Store, thread: ThreadRow, viewerId: string): ThreadSummary | null {
  const peerId = thread.user_a === viewerId ? thread.user_b : thread.user_a;
  const peer = store.getUser(peerId);
  if (!peer) return null;
  const lastRow = thread.last_event_id ? store.getEvent(thread.last_event_id) : null;
  return {
    id: thread.id,
    peer: publicUser(peer),
    lastEvent: lastRow ? threadEvent(store, lastRow, viewerId) : null,
    unread: thread.user_a === viewerId ? thread.unread_a : thread.unread_b,
    updatedAt: thread.updated_at,
  };
}

function toReaction(
  store: Store, row: ReactionRow, viewerId: string, lookup: (id: string) => UserRow | null,
): Reaction {
  const user = lookup(row.user_id);
  return { emoji: row.emoji, handle: user?.handle ?? 'someone', mine: row.user_id === viewerId };
}

export function splitProgress(
  store: Store, splitId: string, lookup: (id: string) => UserRow | null,
): SplitProgress | null {
  const split = store.getSplit(splitId);
  if (!split) return null;
  const participants = store.splitParticipants(splitId);
  return {
    splitId,
    totalMicros: split.total_micros,
    paidCount: participants.filter((p) => p.status === 'paid').length,
    participantCount: participants.length,
    participants: participants.map((p) => {
      const user = lookup(p.user_id);
      return {
        handle: user?.handle ?? 'someone',
        displayName: user?.display_name ?? 'Someone',
        shareMicros: p.share_micros,
        status: p.status as SplitProgress['participants'][number]['status'],
      };
    }),
  };
}
