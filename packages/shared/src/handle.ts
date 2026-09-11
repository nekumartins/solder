/**
 * Handles are how people find each other in Solder. Nobody types an account
 * address — they type "@ana".
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'admin', 'root', 'support', 'help', 'solder', 'api', 'me', 'settings', 'pay',
  'request', 'scan', 'new', 'about', 'terms', 'privacy', 'system', 'null',
  'undefined', 'security', 'wallet', 'login', 'logout', 'signup', 'welcome',
  'claim', 'people', 'split', 'stream', 'vault',
]);

/** "@Ana " -> "ana" */
export function normalizeHandle(raw: string): string {
  return String(raw ?? '').trim().replace(/^@+/, '').toLowerCase();
}

export type HandleCheck =
  | { ok: true; handle: string }
  | { ok: false; reason: string };

export function validateHandle(raw: string): HandleCheck {
  const handle = normalizeHandle(raw);
  if (handle.length === 0) return { ok: false, reason: 'Pick a name' };
  if (handle.length < HANDLE_MIN) return { ok: false, reason: `At least ${HANDLE_MIN} characters` };
  if (handle.length > HANDLE_MAX) return { ok: false, reason: `At most ${HANDLE_MAX} characters` };
  if (!/^[a-z0-9_]+$/.test(handle)) return { ok: false, reason: 'Letters, numbers and _ only' };
  if (!/^[a-z]/.test(handle)) return { ok: false, reason: 'Start with a letter' };
  if (handle.endsWith('_')) return { ok: false, reason: "Can't end with _" };
  if (RESERVED_HANDLES.has(handle)) return { ok: false, reason: 'That one is taken' };
  return { ok: true, handle };
}

/** Display form, always with the @. */
export function formatHandle(handle: string): string {
  return `@${normalizeHandle(handle)}`;
}

/**
 * A deterministic avatar so the same person looks the same on every device,
 * with no uploads and no image hosting.
 */
const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#5BE49B', fg: '#06231A' },
  { bg: '#7C8CFF', fg: '#0B1040' },
  { bg: '#FFB86B', fg: '#3A1E00' },
  { bg: '#FF7AB6', fg: '#400021' },
  { bg: '#6BD5FF', fg: '#002838' },
  { bg: '#C4A1FF', fg: '#230A45' },
  { bg: '#FFE066', fg: '#3A2F00' },
  { bg: '#7CE7D5', fg: '#00302A' },
  { bg: '#FF9B8A', fg: '#3E0F06' },
  { bg: '#9DE86B', fg: '#123A00' },
  { bg: '#A7B4FF', fg: '#0E1650' },
  { bg: '#FFA8E8', fg: '#43003A' },
];

export interface Avatar {
  bg: string;
  fg: string;
  initials: string;
}

export function avatarFor(handle: string, displayName?: string): Avatar {
  const key = normalizeHandle(handle);
  const slot = AVATAR_PALETTE[fnv1a(key) % AVATAR_PALETTE.length]!;
  return { bg: slot.bg, fg: slot.fg, initials: initialsFor(key, displayName) };
}

function initialsFor(handle: string, displayName?: string): string {
  const source = (displayName ?? '').trim();
  if (source) {
    const words = source.split(/\s+/).filter(Boolean);
    const first = words[0]?.[0] ?? '';
    const second = words.length > 1 ? words[words.length - 1]?.[0] ?? '' : '';
    const initials = `${first}${second}`.toUpperCase();
    if (initials) return initials;
  }
  return handle.slice(0, 2).toUpperCase();
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
