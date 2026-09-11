import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarFor, formatHandle, normalizeHandle, validateHandle } from './handle.js';

test('normalizeHandle strips the decoration people type', () => {
  assert.equal(normalizeHandle('@Ana '), 'ana');
  assert.equal(normalizeHandle('  MARCO'), 'marco');
  assert.equal(normalizeHandle('@@jules'), 'jules');
});

test('validateHandle accepts good names', () => {
  for (const good of ['ana', 'ana_b', 'marco99', 'j_u_l_e_s']) {
    const result = validateHandle(good);
    assert.equal(result.ok, true, `${good} should be valid`);
  }
});

test('validateHandle rejects bad names with a human reason', () => {
  for (const bad of ['ab', '_ana', 'ana_', 'Ana!', 'admin', '9lives', '', 'a'.repeat(21)]) {
    const result = validateHandle(bad);
    assert.equal(result.ok, false, `${bad} should be invalid`);
    if (!result.ok) {
      assert.ok(result.reason.length > 0);
      assert.ok(!/regex|invalid input|match/i.test(result.reason), 'reason should read like a person wrote it');
    }
  }
});

test('avatarFor is stable and deterministic across devices', () => {
  const a = avatarFor('ana');
  const b = avatarFor('@ANA');
  assert.deepEqual(a, b);
  assert.match(a.bg, /^#[0-9A-F]{6}$/i);
  assert.equal(avatarFor('ana', 'Ana Ruiz').initials, 'AR');
  assert.equal(avatarFor('marco').initials, 'MA');
  assert.notEqual(avatarFor('ana').bg === avatarFor('priya').bg && avatarFor('ana').initials === avatarFor('priya').initials, true);
});

test('formatHandle always shows the @', () => {
  assert.equal(formatHandle('ana'), '@ana');
  assert.equal(formatHandle('@ana'), '@ana');
});
