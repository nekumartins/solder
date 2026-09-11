import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANNED_WORDS, COPY } from './copy.js';

function collectStrings(value: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof value === 'string') { out.push([path, value]); return; }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) collectStrings(child, `${path}.${key}`, out);
  }
}

test('no crypto jargon reaches the user', () => {
  const strings: Array<[string, string]> = [];
  collectStrings(COPY, 'COPY', strings);
  assert.ok(strings.length > 40, 'expected the copy deck to be populated');

  for (const [path, text] of strings) {
    const haystack = text.toLowerCase();
    for (const banned of BANNED_WORDS) {
      const pattern = banned.includes(' ')
        ? new RegExp(banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        : new RegExp(`\\b${banned}\\b`);
      assert.ok(!pattern.test(haystack), `"${banned}" leaked into ${path}: "${text}"`);
    }
  }
});

test('USDC is named exactly once, as the balance subtitle', () => {
  const strings: Array<[string, string]> = [];
  collectStrings(COPY, 'COPY', strings);
  const mentions = strings.filter(([, text]) => /usdc/i.test(text));
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0]![0], 'COPY.home.balanceSub');
});

test('the split progress line reads naturally', () => {
  assert.equal(COPY.split.progress(1, 3), '1 of 3 paid');
});
