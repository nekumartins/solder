import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANNED_WORDS, COPY, EXEMPT_FROM_BAN } from './copy.js';

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
    if (EXEMPT_FROM_BAN.some((exempt) => path.startsWith(exempt))) continue;
    const haystack = text.toLowerCase();
    for (const banned of BANNED_WORDS) {
      const pattern = banned.includes(' ')
        ? new RegExp(banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        : new RegExp(`\\b${banned}\\b`);
      assert.ok(!pattern.test(haystack), `"${banned}" leaked into ${path}: "${text}"`);
    }
  }
});

test('the jargon ban has exactly one exemption, and it is argued for', () => {
  // Exporting a key is the one screen where the real words help rather than
  // hinder. If this list ever grows, that should be a decision someone makes
  // on purpose.
  assert.deepEqual(EXEMPT_FROM_BAN, ['COPY.export']);

  const strings: Array<[string, string]> = [];
  collectStrings(COPY, 'COPY', strings);

  // And the banned words really do appear nowhere else.
  const offenders = strings
    .filter(([path]) => !path.startsWith('COPY.export'))
    .filter(([, text]) => /private key|seed phrase|mnemonic/i.test(text));
  assert.deepEqual(offenders, []);

  // The exempt section warns before it reveals anything.
  assert.match(COPY.export.warning, /anyone who has it can spend your money/i);
  assert.match(COPY.export.neverShare, /never share/i);
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
