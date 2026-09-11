/**
 * The success test from the original brief, section 20, run end to end in a
 * real browser:
 *
 *   1. They receive a link.      5. They send money to someone else.
 *   2. They click it.            6. The other person receives it.
 *   3. They authenticate.        7. Neither needed to understand blockchain.
 *   4. They see money.
 *
 * Step 7 is checked by reading every word on screen and failing on jargon.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const playwright = await import('/opt/node22/lib/node_modules/playwright/index.js');
const chromium = playwright.chromium ?? playwright.default.chromium;

const BASE = process.env.E2E_BASE ?? 'http://localhost:4173';
const SHOTS = join(process.cwd(), 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const BANNED = [
  'seed phrase', 'mnemonic', 'private key', 'wallet address', 'blockchain',
  'gas', 'gwei', 'ethereum', 'erc-20', 'eip-3009', 'rpc', 'testnet', 'signature',
];

let step = 0;
const pass = (name, detail = '') => console.log(`  ✓ step ${++step}: ${name}${detail ? ` — ${detail}` : ''}`);
const fail = (message) => { throw new Error(message); };

async function withPasskey(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
      hasResidentKey: true, hasUserVerification: true, hasPrf: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    },
  });
}

const phone = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true, colorScheme: 'dark',
};

const browser = await chromium.launch({ headless: true });

// Both people are real accounts created with real passkeys; nothing in this
// test takes the development shortcut.
async function onboard(page, handle, name) {
  await page.goto(`${BASE}/claim`, { waitUntil: 'load' });
  await page.waitForSelector('input[placeholder="Ana Ruiz"]');
  await page.fill('input[placeholder="Ana Ruiz"]', name);
  await page.fill('input[placeholder="ana"]', handle);
  await page.waitForSelector('.badge-good');
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('.balance', { timeout: 25000 });
}

// ---- someone with an account sends money to a person who has none ----------
const senderHandle = `sender${Math.floor(Math.random() * 9000 + 1000)}`;
const senderContext = await browser.newContext(phone);
const sender = await senderContext.newPage();
await withPasskey(senderContext, sender);
await onboard(sender, senderHandle, 'Habeeb Adeyemi');
await sender.evaluate(() => fetch('/api/dev/fund', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ micros: '100000000' }), credentials: 'include',
}));

await sender.goto(`${BASE}/link`, { waitUntil: 'load' });
await sender.waitForSelector('.keypad');
for (const key of ['2', '0']) await sender.click(`.key[aria-label="${key}"]`);
await sender.fill('.note-input', 'For Uber');
await sender.screenshot({ path: join(SHOTS, 'mvp-1-send-by-link.png') });
await sender.focus('.slider');
await sender.keyboard.press('Enter');

await sender.waitForSelector('.link-box', { timeout: 20000 });
const link = await sender.evaluate(() => {
  const shown = document.querySelector('.link-box')?.textContent ?? '';
  return shown.startsWith('http') ? shown : `${location.protocol}//${shown}`;
});
await sender.screenshot({ path: join(SHOTS, 'mvp-2-link-ready.png') });
pass('they receive a link', link.replace(/#.*/, '#…'));

// ---- a person who has never used this opens it, in a clean browser ---------
const strangerContext = await browser.newContext(phone);
const stranger = await strangerContext.newPage();
await withPasskey(strangerContext, stranger);

await stranger.goto(link, { waitUntil: 'load' });
await stranger.waitForSelector('.claim-amount');
const offered = await stranger.textContent('.claim-amount');
await stranger.screenshot({ path: join(SHOTS, 'mvp-3-claim-landing.png') });
pass('they click it', `offered ${offered} with no account`);

// They have never signed in anywhere.
const handle = `newbie${Math.floor(Math.random() * 9000 + 1000)}`;
await stranger.click('button:has-text("Create your account")');
await stranger.waitForSelector('input[placeholder="Ana Ruiz"]');
await stranger.fill('input[placeholder="Ana Ruiz"]', 'David Cole');
await stranger.fill('input[placeholder="ana"]', handle);
await stranger.waitForSelector('.badge-good');
await stranger.click('button:has-text("Continue")');
await stranger.waitForSelector('.claim-amount, .balance', { timeout: 25000 });
pass('they authenticate', 'passkey, no phrase shown');

// Back on the claim screen, now signed in.
if (await stranger.locator('.claim-amount').count() === 0) {
  await stranger.goto(link, { waitUntil: 'load' });
  await stranger.waitForSelector('.claim-amount');
}
await stranger.click('button:has-text("Pick it up")');
await stranger.waitForSelector('.success-amount', { timeout: 25000 });
await stranger.screenshot({ path: join(SHOTS, 'mvp-4-picked-up.png') });

await stranger.waitForSelector('.balance', { timeout: 20000 });
const balance = await stranger.textContent('.balance');
if (!balance?.includes('20')) fail(`expected $20 in the new account, saw ${balance}`);
await stranger.screenshot({ path: join(SHOTS, 'mvp-5-they-see-money.png') });
pass('they see money', balance);

// ---- and they can send it onward -------------------------------------------
await stranger.goto(`${BASE}/pay/${senderHandle}`, { waitUntil: 'load' });
await stranger.waitForSelector('.keypad');
await stranger.click('.key[aria-label="5"]');
await stranger.click('.template:has-text("Lunch")');
await stranger.screenshot({ path: join(SHOTS, 'mvp-6-sending-onward.png') });
await stranger.focus('.slider');
await stranger.keyboard.press('Enter');
await stranger.waitForSelector('.success', { timeout: 25000 });
pass('they send money to someone else', `$5 back to @${senderHandle}`);

// ---- the other person receives it ------------------------------------------
await sender.goto(`${BASE}/t/${handle}`, { waitUntil: 'load' });
await sender.waitForSelector('.bubble-payment', { timeout: 20000 });
await sender.waitForTimeout(1200);
// The conversation holds both payments; the newest one is the reply.
const received = await sender.locator('.bubble-amount').last().textContent();
if (!received?.includes('5')) fail(`expected the sender to see $5 back, saw ${received}`);
await sender.screenshot({ path: join(SHOTS, 'mvp-7-received.png') });
pass('the other person receives it', received);

// ---- neither of them had to understand any of it ---------------------------
const seen = new Set();
for (const [page, route] of [
  [stranger, '/'], [stranger, `/t/${senderHandle}`], [stranger, '/me'], [stranger, '/people'],
  [sender, '/'], [sender, '/settings'],
]) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  for (const word of BANNED) {
    if (new RegExp(`\\b${word}\\b`).test(text)) seen.add(`${word} (on ${route})`);
  }
}
if (seen.size > 0) fail(`jargon reached the screen: ${[...seen].join(', ')}`);
pass('neither person needed to understand any of it', `${BANNED.length} banned words, none on screen`);

await browser.close();
console.log('\nThe brief\'s section 20 success test passes end to end.');
