import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settleUp, CENT,
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

test('settleUp squares a group up with as few payments as possible', () => {
  // Sarah paid 400, David 120, Habeeb 180, Ana 0 — 700 over four people is 175 each.
  const settlements = settleUp([
    { id: 'sarah', net: 225_000_000n },
    { id: 'david', net: -55_000_000n },
    { id: 'habeeb', net: 5_000_000n },
    { id: 'ana', net: -175_000_000n },
  ]);

  // Every debt is cleared and nothing is invented.
  const moved = new Map<string, bigint>();
  for (const s of settlements) {
    moved.set(s.from, (moved.get(s.from) ?? 0n) - s.micros);
    moved.set(s.to, (moved.get(s.to) ?? 0n) + s.micros);
  }
  assert.equal(moved.get('ana'), -175_000_000n);
  assert.equal(moved.get('david'), -55_000_000n);
  assert.equal(moved.get('sarah'), 225_000_000n);
  assert.equal(moved.get('habeeb'), 5_000_000n);
  // Four people, so three payments at most — never everyone paying everyone.
  assert.ok(settlements.length <= 3, `expected at most 3 payments, got ${settlements.length}`);
  assert.ok(settlements.every((s) => s.micros > 0n));
});

test('settleUp has nothing to say when everyone is square', () => {
  assert.deepEqual(settleUp([{ id: 'a', net: 0n }, { id: 'b', net: 0n }]), []);
  assert.deepEqual(settleUp([]), []);
});

test('settleUp handles one person owing several', () => {
  const settlements = settleUp([
    { id: 'ana', net: -30_000_000n },
    { id: 'b', net: 10_000_000n },
    { id: 'c', net: 10_000_000n },
    { id: 'd', net: 10_000_000n },
  ]);
  assert.equal(settlements.length, 3);
  assert.ok(settlements.every((s) => s.from === 'ana'));
  assert.equal(settlements.reduce((sum, s) => sum + s.micros, 0n), 30_000_000n);
});

test('splitShares can land on whole cents', () => {
  // $658.50 between four people is $164.625 each — which nobody can pay.
  const shares = splitShares(parseAmount('658.50'), 4, CENT);
  assert.deepEqual(shares.map((s) => formatUsd(s)), ['$164.63', '$164.63', '$164.62', '$164.62']);
  assert.equal(shares.reduce((a, b) => a + b, 0n), parseAmount('658.50'));
  for (const share of shares) assert.equal(share % CENT, 0n, 'every share is a whole number of cents');
});

test('cent-rounded splits still add up, whatever the total', () => {
  for (const [total, ways] of [['0.07', 3], ['10', 3], ['999.99', 7], ['0.01', 4]] as const) {
    const shares = splitShares(parseAmount(total), ways, CENT);
    assert.equal(shares.reduce((a, b) => a + b, 0n), parseAmount(total), `${total} / ${ways}`);
    assert.equal(shares.length, ways);
  }
});
