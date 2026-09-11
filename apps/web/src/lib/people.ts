import type { PublicUser, ThreadSummary } from '@solder/shared';

/**
 * Everyone you have talked to, most recent first. A group contributes each of
 * its members, so people you have only met in a group are still reachable.
 */
export function peopleFrom(threads: ThreadSummary[]): PublicUser[] {
  const seen = new Map<string, PublicUser>();
  for (const thread of threads) {
    const people = thread.kind === 'group' ? thread.members : [thread.peer];
    for (const person of people) {
      if (person && !seen.has(person.handle)) seen.set(person.handle, person);
    }
  }
  return [...seen.values()];
}
