import type { AppContext } from './context.js';
import type { EventRow } from './db.js';
import { threadEvent } from './serialize.js';

/**
 * Everyone in the conversation sees the same event, but "mine" — and whether a
 * gift's amount is visible — differs per person, so each gets its own
 * serialization.
 */
export function publishEvent(ctx: AppContext, row: EventRow, type: 'event.new' | 'event.updated'): void {
  const audience = new Set([
    ...ctx.store.threadMemberIds(row.thread_id),
    row.from_user,
    row.to_user,
  ]);
  for (const userId of audience) {
    ctx.realtime.publish(userId, {
      type,
      threadId: row.thread_id,
      event: threadEvent(ctx.store, row, userId),
    });
  }
}

export async function publishBalance(ctx: AppContext, userId: string): Promise<void> {
  const user = ctx.store.getUser(userId);
  if (!user?.pubkey) return;
  const balance = await ctx.chain.getBalance(user.pubkey);
  ctx.realtime.publish(userId, { type: 'balance.updated', balanceMicros: balance.toString() });
}
