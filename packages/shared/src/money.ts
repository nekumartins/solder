/**
 * Money in Solder is always an integer count of micro-USDC (1 USDC = 1_000_000).
 *
 * Floats are never used for money anywhere in this codebase. Over the wire,
 * amounts travel as decimal strings ("12500000") and are parsed with BigInt()
 * at the edges.
 */

export const MICROS_PER_USDC = 1_000_000n;
export const USDC_DECIMALS = 6;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
  }
}

/**
 * Parse a human-typed amount into micro-USDC.
 * Accepts "12", "12.5", "12.50", ".5", "1,234.56", " 12 ".
 */
export function parseAmount(input: string): bigint {
  if (typeof input !== 'string') throw new AmountError('Enter an amount');
  const cleaned = input.trim().replace(/,/g, '').replace(/^\$/, '');
  if (cleaned === '') throw new AmountError('Enter an amount');
  if (cleaned.startsWith('-')) throw new AmountError("Amounts can't be negative");
  if (!/^\d*(\.\d*)?$/.test(cleaned)) throw new AmountError('That does not look like an amount');

  const [wholePart = '', fracPart = ''] = cleaned.split('.');
  if (wholePart === '' && fracPart === '') throw new AmountError('Enter an amount');
  if (fracPart.length > USDC_DECIMALS) {
    throw new AmountError(`Amounts can have at most ${USDC_DECIMALS} decimal places`);
  }

  const whole = wholePart === '' ? 0n : BigInt(wholePart);
  const frac = fracPart === '' ? 0n : BigInt(fracPart.padEnd(USDC_DECIMALS, '0'));
  return whole * MICROS_PER_USDC + frac;
}

/** Same as parseAmount but returns null instead of throwing. */
export function tryParseAmount(input: string): bigint | null {
  try {
    return parseAmount(input);
  } catch {
    return null;
  }
}

export interface FormatOptions {
  /** 'auto' (default) shows a minus for negatives only; 'always' adds +/-; 'never' is absolute. */
  sign?: 'always' | 'never' | 'auto';
  /** Omit the leading "$". */
  bare?: boolean;
}

/**
 * Render micro-USDC as money: "$12.50", "+$12.50", "-$12.50".
 * Always at least 2 decimals; shows up to 6 when sub-cent precision exists.
 */
export function formatUsd(micros: bigint, opts: FormatOptions = {}): string {
  const { sign = 'auto', bare = false } = opts;
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;

  const whole = abs / MICROS_PER_USDC;
  const frac = abs % MICROS_PER_USDC;

  let fracStr = frac.toString().padStart(USDC_DECIMALS, '0');
  fracStr = fracStr.replace(/0+$/, '');
  if (fracStr.length < 2) fracStr = fracStr.padEnd(2, '0');

  const body = `${groupDigits(whole.toString())}.${fracStr}`;
  const prefix = bare ? '' : '$';

  if (sign === 'never') return `${prefix}${body}`;
  if (negative) return `-${prefix}${body}`;
  if (sign === 'always') return `+${prefix}${body}`;
  return `${prefix}${body}`;
}

/**
 * Format the raw string a numeric keypad has accumulated, for display.
 * Keeps a trailing "." so the user sees what they typed.
 */
export function formatAmountInput(digits: string): string {
  if (digits === '' || digits === '.') return '0';
  const [wholePart = '', fracPart] = digits.split('.');
  const whole = groupDigits(wholePart === '' ? '0' : String(BigInt(wholePart)));
  if (fracPart === undefined) return whole;
  return `${whole}.${fracPart}`;
}

/**
 * Split `total` into `ways` shares that sum to exactly `total`.
 * The remainder is handed out one micro at a time to the earliest shares.
 */
export function splitShares(total: bigint, ways: number): bigint[] {
  if (!Number.isInteger(ways) || ways < 1) throw new AmountError('Need at least one person');
  if (total < 0n) throw new AmountError("Amounts can't be negative");
  const n = BigInt(ways);
  const base = total / n;
  const remainder = total % n;
  return Array.from({ length: ways }, (_, i) => (BigInt(i) < remainder ? base + 1n : base));
}

/** "1234567" -> "1,234,567" */
function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Amounts cross the wire as decimal strings; these are the two edges. */
export function microsToString(micros: bigint): string {
  return micros.toString();
}

export function microsFromString(value: string | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  return BigInt(value);
}
