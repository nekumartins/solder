import type { PublicUser, ThreadSummary } from '@solder/shared';
import { Avatar } from './Avatar.js';

/** A conversation is either a person or a room; both need a face and a name. */
export function threadTitle(thread: {
  kind: string; peer: PublicUser | null; title: string | null;
}): string {
  if (thread.kind === 'group') return thread.title ?? 'Group';
  return thread.peer?.displayName ?? 'Someone';
}

export function threadHref(thread: ThreadSummary): string {
  return thread.kind === 'group' ? `/t/${thread.id}` : `/t/${thread.peer?.handle ?? ''}`;
}

export function ThreadAvatar({ thread, size = 46 }: {
  thread: { kind: string; peer: PublicUser | null; title: string | null; emoji: string | null };
  size?: number;
}) {
  if (thread.kind === 'group') {
    return (
      <span
        className="avatar group-avatar"
        aria-hidden="true"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
      >
        {thread.emoji ?? '👥'}
      </span>
    );
  }
  return (
    <Avatar
      handle={thread.peer?.handle ?? 'someone'}
      displayName={thread.peer?.displayName}
      size={size}
    />
  );
}
