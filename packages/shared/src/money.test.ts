import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AmountError, MICROS_PER_USDC, formatAmountInput, formatUsd, microsFromString,
  parseAmount, splitShares, tryParseAmount,
} from './money.js';

test('parseAmount handles the shapes people actually type', () => {
  assert.equal(parseAmount('12'), 12_000_000n);
  assert.equal(parseAmount('12.5'), 12_500_000n);
  assert.equal(parseAmount('12.50'), 12_500_000n);
  assert.equal(parseAmount('.5'), 500_000n);
  assert.equal(parseAmount('1,234.56'), 1_234_560_000n);
  assert.equal(parseAmount('  12  '), 12_000_000n);
  assert.equal(parseAmount('$7.25'), 7_250_000n);
  assert.equal(parseAmount('0'), 0n);
  assert.equal(parseAmount('0.000001'), 1n);
});

test('parseAmount rejects what it should', () => {
  assert.throws(() => parseAmount('12.3456789'), AmountError);
  assert.throws(() => parseAmount('-5'), AmountError);
  assert.throws(() => parseAmount(''), AmountError);
  assert.throws(() => parseAmount('   '), AmountError);
  assert.throws(() => parseAmount('abc'), AmountError);
  assert.throws(() => parseAmount('1.2.3'), AmountError);
  assert.throws(() => parseAmount('1e6'), AmountError);
  assert.equal(tryParseAmount('nope'), null);
});

test('formatUsd round-trips with parseAmount', () => {
  for (const input of ['0', '0.01', '7.25', '12.50', '1234.56', '999999.99']) {
    const micros = parseAmount(input);
    assert.equal(parseAmount(formatUsd(micros)), micros, `round-trip failed for ${input}`);
  }
});

test('formatUsd renders money the way a person reads it', () => {
  assert.equal(formatUsd(12_500_000n), '$12.50');
  assert.equal(formatUsd(0n), '$0.00');
  assert.equal(formatUsd(1_234_560_000n), '$1,234.56');
  assert.equal(formatUsd(12_500_000n, { sign: 'always' }), '+$12.50');
  assert.equal(formatUsd(-12_500_000n), '-$12.50');
  assert.equal(formatUsd(-12_500_000n, { sign: 'never' }), '$12.50');
  assert.equal(formatUsd(12_500_000n, { bare: true }), '12.50');
  // sub-cent precision is shown rather than silently rounded away
  assert.equal(formatUsd(1n), '$0.000001');
  assert.equal(formatUsd(1_000_500n), '$1.0005');
});

test('formatAmountInput follows the keypad', () => {
  assert.equal(formatAmountInput(''), '0');
  assert.equal(formatAmountInput('0'), '0');
  assert.equal(formatAmountInput('12'), '12');
  assert.equal(formatAmountInput('12.'), '12.');
  assert.equal(formatAmountInput('12.5'), '12.5');
  assert.equal(formatAmountInput('1234'), '1,234');
  assert.equal(formatAmountInput('.'), '0');
});

test('splitShares always sums to the total', () => {
  assert.deepEqual(splitShares(1000n, 3), [334n, 333n, 333n]);
  assert.deepEqual(splitShares(1000n, 1), [1000n]);
  assert.deepEqual(splitShares(0n, 4), [0n, 0n, 0n, 0n]);
  for (const [total, ways] of [[10_000_001n, 7], [1n, 3], [99_999_999n, 11]] as const) {
    const shares = splitShares(total, ways);
    assert.equal(shares.length, ways);
    assert.equal(shares.reduce((a, b) => a + b, 0n), total);
    // fair: no two shares differ by more than one micro
    assert.ok(shares[0]! - shares[shares.length - 1]! <= 1n);
  }
  assert.throws(() => splitShares(100n, 0), AmountError);
});

test('wire encoding keeps precision', () => {
  const micros = parseAmount('1234.567891');
  assert.equal(microsFromString(micros.toString()), micros);
  assert.equal(microsFromString(null), 0n);
  assert.equal(micros / MICROS_PER_USDC, 1234n);
});
