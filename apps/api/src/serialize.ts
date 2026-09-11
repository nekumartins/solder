import {
  CENT, settleUp, splitShares,
  type GroupSummary, type PublicUser, type Reaction, type SplitProgress, type ThreadEvent,
  type ThreadSummary,
} from '@solder/shared';
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

  const reactions = store.reactionsForEvents([row.id]);
  return shape(store, row, viewerId, lookup, reactions);
}

/**
 * The single place that decides what one event looks like to one person —
 * including whether they are allowed to know the amount yet.
 */
function shape(
  store: Store, row: EventRow, viewerId: string,
  lookup: (id: string) => UserRow | null, reactions: ReactionRow[],
): ThreadEvent {
  const from = lookup(row.from_user);
  const to = lookup(row.to_user);
  const mine = row.from_user === viewerId;
  const isGift = row.gift === 1;
  const revealed = row.revealed_at !== null;

  // A surprise stays a surprise: the recipient is not sent the amount at all
  // until they open it, so it cannot be read out of the network response.
  const hideAmount = isGift && !revealed && !mine;

  return {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind as ThreadEvent['kind'],
    from: from?.handle ?? 'someone',
    to: to?.handle ?? 'someone',
    mine,
    amountMicros: hideAmount ? null : row.amount_micros,
    note: row.note,
    emoji: row.emoji,
    body: row.body,
    status: row.status as ThreadEvent['status'],
    reference: row.chain_signature,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    reactions: reactions.map((reaction) => toReaction(store, reaction, viewerId, lookup)),
    split: row.split_id ? splitProgress(store, row.split_id, lookup) : null,
    gift: isGift,
    revealed,
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

  const byEvent = new Map<string, ReactionRow[]>();
  for (const reaction of store.reactionsForEvents(rows.map((row) => row.id))) {
    const list = byEvent.get(reaction.event_id) ?? [];
    list.push(reaction);
    byEvent.set(reaction.event_id, list);
  }

  return rows.map((row) => shape(store, row, viewerId, lookup, byEvent.get(row.id) ?? []));
}

export function threadSummary(store: Store, thread: ThreadRow, viewerId: string): ThreadSummary | null {
  const members = store.threadMemberIds(thread.id)
    .map((id) => store.getUser(id))
    .filter((user): user is UserRow => user !== null);

  const peer = thread.kind === 'direct'
    ? members.find((member) => member.id !== viewerId) ?? null
    : null;
  if (thread.kind === 'direct' && !peer) return null;

  const lastRow = thread.last_event_id ? store.getEvent(thread.last_event_id) : null;
  return {
    id: thread.id,
    kind: thread.kind,
    peer: peer ? publicUser(peer) : null,
    title: thread.title,
    emoji: thread.emoji,
    members: members.map(publicUser),
    lastEvent: lastRow ? threadEvent(store, lastRow, viewerId) : null,
    unread: store.unreadFor(thread.id, viewerId),
    updatedAt: thread.updated_at,
  };
}

/**
 * Who has put in what, and the shortest way to square up.
 *
 * An expense is money one member spent on behalf of everyone. A payment inside
 * the group is a settlement, which moves the debt without changing the total.
 */
export function groupSummary(store: Store, thread: ThreadRow, viewerId: string): GroupSummary {
  const memberIds = store.threadMemberIds(thread.id);
  const members = memberIds.map((id) => store.getUser(id))
    .filter((user): user is UserRow => user !== null);

  const paid = new Map<string, bigint>(members.map((member) => [member.id, 0n]));
  const settled = new Map<string, bigint>(members.map((member) => [member.id, 0n]));
  let total = 0n;

  for (const row of store.groupLedger(thread.id)) {
    const amount = BigInt(row.amount_micros ?? '0');
    if (row.kind === 'expense') {
      total += amount;
      paid.set(row.from_user, (paid.get(row.from_user) ?? 0n) + amount);
    } else {
      settled.set(row.from_user, (settled.get(row.from_user) ?? 0n) + amount);
      settled.set(row.to_user, (settled.get(row.to_user) ?? 0n) - amount);
    }
  }

  // Whole cents, and the parts still add back to exactly the total.
  const shares = splitShares(total, Math.max(members.length, 1), CENT);
  const balances = members.map((member, index) => ({
    id: member.id,
    net: (paid.get(member.id) ?? 0n) + (settled.get(member.id) ?? 0n) - (shares[index] ?? 0n),
  }));

  const byId = new Map(members.map((member) => [member.id, member]));
  const name = (id: string) => byId.get(id);
  const settlements = settleUp(balances);

  return {
    totalMicros: total.toString(),
    perPersonMicros: (shares[0] ?? 0n).toString(),
    members: members.map((member, index) => ({
      handle: member.handle,
      displayName: member.display_name,
      paidMicros: (paid.get(member.id) ?? 0n).toString(),
      netMicros: (balances[index]?.net ?? 0n).toString(),
    })),
    settlements: settlements.map((s) => ({
      from: name(s.from)?.handle ?? 'someone',
      to: name(s.to)?.handle ?? 'someone',
      micros: s.micros.toString(),
    })),
    youOwe: settlements.filter((s) => s.from === viewerId).map((s) => ({
      handle: name(s.to)?.handle ?? 'someone',
      displayName: name(s.to)?.display_name ?? 'Someone',
      micros: s.micros.toString(),
    })),
    youAreOwed: settlements.filter((s) => s.to === viewerId).map((s) => ({
      handle: name(s.from)?.handle ?? 'someone',
      displayName: name(s.from)?.display_name ?? 'Someone',
      micros: s.micros.toString(),
    })),
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
