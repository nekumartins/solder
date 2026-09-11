import { api } from './api.js';
import { assertPasskey, createPasskey, passkeysSupported } from './passkey.js';
import {
  createWallet, decryptVault, deriveKeyFromPin, deriveKeyFromPrf, encryptVault, newSalt,
  saltOf, type VaultAlg, type VaultBlob,
} from './vault.js';
import { wallet } from './wallet.js';

/**
 * Sign-up, sign-in and unlocking, in one place.
 *
 * There is no phrase to write down and no password. A passkey proves who you
 * are, and the key material it derives (PRF) unwraps the money key. Devices
 * without PRF fall back to a PIN, which is weaker — see SECURITY.md.
 */

export type PinPrompt = (reason: 'create' | 'unlock') => Promise<string>;

export interface SessionUser {
  handle: string;
  displayName: string;
}

export async function signUp(
  handle: string, displayName: string, requestPin: PinPrompt,
): Promise<SessionUser> {
  if (!passkeysSupported()) throw new Error('passkeys_unsupported');

  const { challengeId, options } = await api.post<any>('/api/auth/register/options', {
    handle, displayName,
  });
  const created = await createPasskey(options);
  const verified = await api.post<{ user: SessionUser; prfSupported: boolean }>(
    '/api/auth/register/verify', { challengeId, response: created.response },
  );

  // Some authenticators only hand over PRF output on a subsequent assertion,
  // so ask once more rather than falling back to a PIN unnecessarily.
  let prfOutput = created.prfOutput;
  if (!prfOutput && verified.prfSupported) {
    prfOutput = (await assertOnce(handle)).prfOutput;
  }

  await createAndStoreWallet(prfOutput, requestPin);
  return verified.user;
}

export async function signIn(requestPin: PinPrompt, handle?: string): Promise<SessionUser> {
  if (!passkeysSupported()) throw new Error('passkeys_unsupported');

  const { user, prfOutput } = await assertOnce(handle);
  await restoreWallet(prfOutput, requestPin);
  return user;
}

/** Re-confirms it is really you, then brings the money key back into memory. */
export async function unlock(requestPin: PinPrompt, handle?: string): Promise<void> {
  if (wallet.isUnlocked()) return;
  const { prfOutput } = await assertOnce(handle);
  await restoreWallet(prfOutput, requestPin);
}

/**
 * Always asks, even if the wallet is already unlocked. Handing over the key
 * itself should never ride on a session someone else could have walked up to.
 */
export async function reauthenticate(requestPin: PinPrompt, handle?: string): Promise<void> {
  wallet.lock();
  await unlock(requestPin, handle);
}

export async function signOut(): Promise<void> {
  await api.post('/api/auth/logout');
  await wallet.forget();
}

async function assertOnce(handle?: string): Promise<{
  user: SessionUser; prfOutput: Uint8Array | null;
}> {
  const { challengeId, options } = await api.post<any>('/api/auth/login/options',
    handle ? { handle } : {});
  const asserted = await assertPasskey(options);
  const verified = await api.post<{ user: SessionUser }>('/api/auth/login/verify', {
    challengeId, response: asserted.response,
  });
  return { user: verified.user, prfOutput: asserted.prfOutput };
}

async function createAndStoreWallet(prfOutput: Uint8Array | null, requestPin: PinPrompt): Promise<void> {
  const created = createWallet();
  const salt = newSalt();
  const alg: VaultAlg = prfOutput ? 'prf-hkdf-aesgcm' : 'pin-pbkdf2-aesgcm';
  const key = prfOutput
    ? await deriveKeyFromPrf(prfOutput, salt)
    : await deriveKeyFromPin(await requestPin('create'), salt);

  const blob = await encryptVault(created.seed, key, alg, salt);
  await api.put('/api/vault', { blob: JSON.stringify(blob), alg, accountKey: created.accountKey });
  await wallet.cacheBlob(blob);
  wallet.hold(created.seed);
}

async function restoreWallet(prfOutput: Uint8Array | null, requestPin: PinPrompt): Promise<void> {
  const blob = await loadBlob();
  const salt = saltOf(blob);

  const key = blob.alg === 'prf-hkdf-aesgcm'
    ? await deriveKeyFromPrf(requirePrf(prfOutput), salt)
    : await deriveKeyFromPin(await requestPin('unlock'), salt);

  let restored;
  try {
    restored = await decryptVault(blob, key);
  } catch {
    throw new Error(blob.alg === 'prf-hkdf-aesgcm' ? 'unlock_failed' : 'wrong_pin');
  }

  await wallet.cacheBlob(blob);
  wallet.hold(restored.seed);
}

/** Prefers the local copy so an unlock works offline; falls back to the backup. */
async function loadBlob(): Promise<VaultBlob> {
  const cached = await wallet.cachedBlob();
  if (cached) return cached;
  const remote = await api.get<{ blob: string; alg: VaultAlg }>('/api/vault');
  return JSON.parse(remote.blob) as VaultBlob;
}

function requirePrf(prfOutput: Uint8Array | null): Uint8Array {
  if (!prfOutput) throw new Error('prf_unavailable');
  return prfOutput;
}

/** Development shortcut: adopt a known key without a passkey. */
export async function adoptDevWallet(secretKeyB64: string): Promise<void> {
  const seed = Uint8Array.from(atob(secretKeyB64), (char) => char.charCodeAt(0));
  wallet.hold(seed);
}
