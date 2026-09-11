import { secp256k1 } from '@noble/curves/secp256k1';
import { accountKeyFor, signMessage } from './vault.js';
import { bytesToBase64Url, base64UrlToBytes, randomBytes } from './bytes.js';

/**
 * Money sent to someone who has no account yet waits in a holding account.
 *
 * Its key is derived on this device and travels in the link's `#fragment`,
 * which browsers never send to a server. So whoever holds the link can take
 * the money, the sender can take it back, and nobody else — including us —
 * can touch it.
 */

const INFO = new TextEncoder().encode('solder-claim-v1');

export interface Holding {
  seed: Uint8Array;
  address: string;
  /** Salt for re-deriving this later. Safe to store; useless without the sender's key. */
  ref: string;
}

export async function deriveHolding(senderSeed: Uint8Array, ref: string): Promise<Holding> {
  const material = await crypto.subtle.importKey('raw', copy(senderSeed), 'HKDF', false, ['deriveBits']);
  let seed = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: copy(base64UrlToBytes(ref)), info: copy(INFO) },
    material, 256,
  ));
  // Vanishingly unlikely, but a key must be in range.
  let attempt = 0;
  while (!secp256k1.utils.isValidPrivateKey(seed) && attempt < 8) {
    seed = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: copy(base64UrlToBytes(ref)), info: copy(new TextEncoder().encode(`solder-claim-v1:${++attempt}`)) },
      material, 256,
    ));
  }
  return { seed, address: accountKeyFor(seed), ref };
}

export function newHoldingRef(): string {
  return bytesToBase64Url(randomBytes(16));
}

/** The whole secret lives after the `#`, so it never reaches the server. */
export function claimLink(claimId: string, holding: Holding): string {
  return `${location.origin}/c/${claimId}#${bytesToBase64Url(holding.seed)}`;
}

export function readLinkSecret(): Uint8Array | null {
  const fragment = location.hash.replace(/^#/, '');
  if (!fragment) return null;
  try {
    const seed = base64UrlToBytes(fragment);
    return seed.length === 32 ? seed : null;
  } catch {
    return null;
  }
}

/**
 * Kept for the length of the tab only, so the secret survives the trip through
 * onboarding without ever being written to disk.
 */
const STASH_KEY = 'solder-claim-secret';

export function stashLinkSecret(seed: Uint8Array): void {
  try {
    sessionStorage.setItem(STASH_KEY, bytesToBase64Url(seed));
  } catch {
    // Private browsing: the link still works if they do not navigate away.
  }
}

export function takeStashedSecret(): Uint8Array | null {
  try {
    const stored = sessionStorage.getItem(STASH_KEY);
    if (!stored) return null;
    sessionStorage.removeItem(STASH_KEY);
    const seed = base64UrlToBytes(stored);
    return seed.length === 32 ? seed : null;
  } catch {
    return null;
  }
}

/** Signs on behalf of the holding account, using only the link's secret. */
export function signAsHolding(seed: Uint8Array, messageB64: string): string {
  return signMessage(seed, messageB64);
}

function copy(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
