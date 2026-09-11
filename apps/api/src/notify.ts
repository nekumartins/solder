import type { AppContext } from './context.js';
import type { EventRow } from './db.js';
import { threadEvent } from './serialize.js';

/**
 * Both sides of a payment see the same event, but "mine" differs, so each
 * side gets its own serialization.
 */
export function publishEvent(ctx: AppContext, row: EventRow, type: 'event.new' | 'event.updated'): void {
  for (const userId of new Set([row.from_user, row.to_user])) {
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
