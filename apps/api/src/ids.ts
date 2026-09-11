import { randomBytes } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** `usr_7Fk2…` — sortable enough, short enough to read in a log. */
export function newId(prefix: string, length = 22): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${prefix}_${out}`;
}
