import { normalizeHandle, validateHandle } from '@solder/shared';
import { badRequest } from './errors.js';

export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('bad_body', 'Expected a JSON object');
  }
  return value as Record<string, unknown>;
}

export function str(value: unknown, field: string, opts: { min?: number; max?: number } = {}): string {
  const { min = 1, max = 500 } = opts;
  if (typeof value !== 'string') throw badRequest('bad_field', `${field} is required`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest('bad_field', `${field} is required`);
  if (trimmed.length > max) throw badRequest('bad_field', `${field} is too long`);
  return trimmed;
}

export function optionalStr(value: unknown, field: string, max = 500): string | null {
  if (value === undefined || value === null || value === '') return null;
  return str(value, field, { max });
}

/** Amounts arrive as decimal strings of micro-USDC. */
export function micros(value: unknown, field: string): bigint {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw badRequest('bad_amount', 'Enter an amount');
  }
  let parsed: bigint;
  try {
    parsed = BigInt(String(value));
  } catch {
    throw badRequest('bad_amount', 'Enter an amount');
  }
  if (parsed <= 0n) throw badRequest('bad_amount', 'Enter an amount above zero');
  if (parsed > 1_000_000_000_000n) throw badRequest('bad_amount', 'That amount is too large');
  return parsed;
}

export function handleArg(value: unknown, field = 'name'): string {
  const raw = typeof value === 'string' ? value : '';
  const result = validateHandle(raw);
  if (!result.ok) throw badRequest('bad_handle', result.reason);
  return result.handle;
}

/** Accepts a `@handle` path param. */
export function handleParam(value: unknown): string {
  return handleArg(normalizeHandle(String(value ?? '')));
}

const EMOJI_RE = /^\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|\p{Emoji_Modifier}|️)*$/u;

export function emoji(value: unknown, field = 'emoji'): string | null {
  if (value === undefined || value === null || value === '') return null;
  const candidate = String(value);
  if (!EMOJI_RE.test(candidate)) throw badRequest('bad_emoji', 'Pick a single emoji');
  return candidate;
}

export function handleList(value: unknown, field: string, max = 12): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest('bad_field', `Choose who to include`);
  }
  if (value.length > max) throw badRequest('bad_field', `At most ${max} people`);
  const handles = value.map((v) => handleArg(v, field));
  const unique = [...new Set(handles)];
  if (unique.length !== handles.length) throw badRequest('bad_field', 'Someone is listed twice');
  return unique;
}
