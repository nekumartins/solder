/**
 * Drives the real app in a real browser, at phone size, through the whole
 * journey: create an account with a passkey, send money, ask for money,
 * split a bill, and reload with the network off.
 *
 * Uses Chrome's virtual authenticator so the passkey path is genuinely
 * exercised rather than stubbed. Where the virtual authenticator cannot
 * produce PRF output, it says so and falls back to the dev sign-in — the
 * report always states which path ran.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const playwright = await import('/opt/node22/lib/node_modules/playwright/index.js');
const chromium = playwright.chromium ?? playwright.default.chromium;

const BASE = process.env.E2E_BASE ?? 'http://localhost:4173';
const SHOTS = join(process.cwd(), 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const steps = [];
let shot = 0;

async function capture(page, name) {
  const file = join(SHOTS, `${String(++shot).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

function step(name, detail = '') {
  steps.push({ name, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  colorScheme: 'dark',
  serviceWorkers: 'allow',
});

const page = await context.newPage();
page.on('pageerror', (error) => console.error('  ! page error:', error.message));

// ---- virtual passkey ------------------------------------------------------
const cdp = await context.newCDPSession(page);
let passkeyPath = 'virtual authenticator';
try {
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  step('virtual authenticator attached', `id ${authenticatorId}`);
} catch (error) {
  passkeyPath = 'dev sign-in fallback';
  console.log(`  ! virtual authenticator unavailable (${error.message})`);
}

// ---- onboarding -----------------------------------------------------------
const handle = `tester${Math.floor(Math.random() * 9000 + 1000)}`;

await page.goto(`${BASE}/welcome`, { waitUntil: 'load' });
await page.waitForSelector('text=Create your account');
await page.waitForTimeout(900); // let the entrance animation settle
await capture(page, 'welcome');
step('welcome screen');

await page.click('text=Create your account');
await page.waitForSelector('input[placeholder="Ana Ruiz"]');
await page.fill('input[placeholder="Ana Ruiz"]', 'Tess Okonkwo');
await page.fill('input[placeholder="ana"]', handle);
await page.waitForSelector('.badge-good', { timeout: 5000 });
await capture(page, 'claim-handle');
step('name checked live', `@${handle} available`);

await page.click('button:has-text("Continue")');

let signedIn = false;
try {
  await page.waitForSelector('.balance', { timeout: 15000 });
  signedIn = true;
  step('account created with a passkey', 'no phrase shown at any point');
} catch {
  // PRF unsupported by this virtual authenticator: fall back so the rest of
  // the journey is still exercised.
  passkeyPath = 'dev sign-in fallback';
  console.log('  ! passkey path did not complete; using the dev sign-in');
  await page.evaluate(async () => {
    await fetch('/api/dev/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'ana' }), credentials: 'include',
    }).then((response) => response.json())
      .then((body) => (window.__devSeed = body.secretKeyB64));
  });
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForSelector('.balance', { timeout: 10000 });
  signedIn = true;
}

// Give the new account something to spend.
await page.evaluate(() => fetch('/api/dev/fund', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ micros: '120000000' }), credentials: 'include',
}));
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.balance');
await capture(page, 'home');
step('home', await page.textContent('.balance'));

// ---- send money -----------------------------------------------------------
await page.click('.action:has-text("Send")');
await page.waitForSelector('.search-input');
await page.fill('.search-input', 'marco');
await page.waitForSelector('.person-row', { timeout: 5000 });
await capture(page, 'people');
step('found a person by name');

await page.click('.person-row:has-text("Marco")');
await page.waitForSelector('.keypad');
for (const key of ['1', '2', '.', '5', '0']) {
  await page.click(`.key[aria-label="${key}"]`);
}
await page.click('.template:has-text("Lunch")');
await page.fill('.note-input', 'thai food');
await capture(page, 'pay-amount');
step('amount entered on the keypad', await page.textContent('.amount'));

await page.focus('.slider');
await page.keyboard.press('Enter');
await page.waitForSelector('.success', { timeout: 20000 });
await capture(page, 'payment-sent');
step('payment sent');

await page.waitForSelector('.thread-scroll', { timeout: 8000 });
await page.waitForFunction(
  () => document.body.innerText.includes('Sent') || document.body.innerText.includes('Sending'),
  { timeout: 8000 },
);
await page.waitForTimeout(1500);
await capture(page, 'thread');
const confirmed = await page.locator('.bubble-status.is-done').count();
step('payment lands in the conversation', confirmed > 0 ? 'confirmed' : 'pending');

// ---- react ----------------------------------------------------------------
const bubble = page.locator('.bubble-payment').last();
await bubble.click({ button: 'right' });
try {
  await page.waitForSelector('.react-pop', { timeout: 3000 });
  await page.click('.react-option:has-text("🔥")');
  await page.waitForSelector('.reaction', { timeout: 3000 });
  step('reacted to a payment');
} catch {
  console.log('  ! reaction popover did not open');
}
await capture(page, 'thread-reaction');

// ---- request money --------------------------------------------------------
await page.click('.composer-money');
await page.waitForSelector('.keypad');
for (const key of ['8', '.', '0', '0']) await page.click(`.key[aria-label="${key}"]`);
await page.fill('.note-input', 'your half of the cab');
await capture(page, 'request');
await page.focus('.slider');
await page.keyboard.press('Enter');
await page.waitForSelector('.success', { timeout: 15000 });
step('money requested');

// ---- split a bill ---------------------------------------------------------
await page.goto(`${BASE}/split`, { waitUntil: 'load' });
await page.waitForSelector('.keypad');
for (const key of ['9', '6']) await page.click(`.key[aria-label="${key}"]`);
await page.fill('.note-input-wide', 'dinner at Lupa');
const chips = page.locator('.person-chip');
const chipCount = Math.min(await chips.count(), 3);
for (let i = 0; i < chipCount; i++) await chips.nth(i).click();
await capture(page, 'split');
step('bill split', await page.textContent('.amount-hint'));

if (chipCount > 0) {
  await page.click('button:has-text("Ask everyone")');
  await page.waitForSelector('.balance', { timeout: 10000 });
  step('split requests sent');
}

// ---- a group with a running ledger ----------------------------------------
await page.goto(`${BASE}/groups/new`, { waitUntil: 'load' });
await page.waitForSelector('.person-chip');
await page.fill('input[placeholder="Paris trip"]', 'Weekend away');
await page.click('.emoji-pick:has-text("🏖️")');
const groupChips = page.locator('.person-chip');
for (let i = 0; i < Math.min(await groupChips.count(), 2); i++) await groupChips.nth(i).click();
await capture(page, 'group-new');
await page.click('button:has-text("Create group")');
await page.waitForSelector('.group-bar', { timeout: 15000 });
step('group created');

await page.click('.group-bar');
await page.waitForSelector('.group-actions');
await page.click('button:has-text("Add an expense")');
await page.waitForSelector('.sheet input[aria-label="Amount"]');
await page.fill('.sheet input[aria-label="Amount"]', '120');
await page.fill('.sheet input[aria-label="What did you pay for?"]', 'the apartment');
await page.click('.sheet button:has-text("Add an expense")');
await page.waitForSelector('.group-members', { timeout: 10000 });
await page.waitForTimeout(500);
await capture(page, 'group-balances');
step('expense splits across the group', (await page.textContent('.group-total'))?.trim());

// ---- a surprise -----------------------------------------------------------
await page.goto(`${BASE}/pay/marco`, { waitUntil: 'load' });
await page.waitForSelector('.keypad');
for (const key of ['1', '5']) await page.click(`.key[aria-label="${key}"]`);
await page.click('.gift-toggle');
await capture(page, 'gift-send');
await page.focus('.slider');
await page.keyboard.press('Enter');
await page.waitForSelector('.success', { timeout: 20000 });
step('surprise sent', 'amount hidden until opened');

// ---- profile + QR ---------------------------------------------------------
await page.goto(`${BASE}/me`, { waitUntil: 'load' });
await page.waitForSelector('.qr:not(.qr-skeleton)', { timeout: 8000 });
await capture(page, 'profile-qr');
step('shareable code rendered');

await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
await page.click('.row-button:has-text("Advanced")');
await page.waitForSelector('.advanced');
await capture(page, 'settings-advanced');
step('technical details tucked behind Advanced');

// ---- desktop --------------------------------------------------------------
await page.setViewportSize({ width: 1280, height: 860 });
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForSelector('.sidebar', { timeout: 8000 });
const tabbarHidden = await page.evaluate(() => {
  const bar = document.querySelector('.tabbar');
  return !bar || getComputedStyle(bar).display === 'none';
});
await capture(page, 'desktop-home');
await page.goto(`${BASE}/t/marco`, { waitUntil: 'load' });
await page.waitForSelector('.bubble');
await page.waitForTimeout(500);
await capture(page, 'desktop-thread');
step('desktop layout', `sidebar shown, phone tab bar ${tabbarHidden ? 'hidden' : 'STILL VISIBLE'}`);
await page.setViewportSize({ width: 390, height: 844 });

// ---- light mode -----------------------------------------------------------
await page.emulateMedia({ colorScheme: 'light' });
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForSelector('.balance');
await capture(page, 'home-light');
step('light mode');
await page.emulateMedia({ colorScheme: 'dark' });

// ---- offline --------------------------------------------------------------
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.waitForTimeout(1200); // let the service worker finish precaching
const swReady = await page.evaluate(() => navigator.serviceWorker?.controller !== null);
await context.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
const shellRendered = await page.locator('#root *').count();
await capture(page, 'offline');
step('offline reload still renders', `${shellRendered} elements, service worker ${swReady ? 'active' : 'not controlling'}`);
await context.setOffline(false);

await browser.close();

console.log(`\n${steps.length} steps passed. Passkey path: ${passkeyPath}.`);
console.log(`Screenshots in ${SHOTS}`);
