import { idbDelete, idbGet, idbSet } from './idb.js';
import { accountKeyFor, signMessage, type VaultBlob } from './vault.js';

/**
 * Holds the unlocked money key in memory only, for a short while, so paying
 * twice in a row does not mean two biometric prompts — and closing the tab
 * means the key is gone.
 */
const UNLOCK_TTL_MS = 5 * 60 * 1000;
const BLOB_KEY = 'vault-blob';

let seed: Uint8Array | null = null;
let unlockedAt = 0;
let cachedAccountKey: string | null = null;

export const wallet = {
  isUnlocked(): boolean {
    if (!seed) return false;
    if (Date.now() - unlockedAt > UNLOCK_TTL_MS) {
      wallet.lock();
      return false;
    }
    return true;
  },

  accountKey(): string | null {
    return cachedAccountKey;
  },

  hold(next: Uint8Array): string {
    seed = next;
    unlockedAt = Date.now();
    cachedAccountKey = accountKeyFor(next);
    return cachedAccountKey;
  },

  /**
   * The raw key, for deriving a link's holding account. Never send this
   * anywhere — it is the money.
   */
  seedForDerivation(): Uint8Array {
    if (!seed || !wallet.isUnlocked()) throw new Error('locked');
    unlockedAt = Date.now();
    return seed;
  },

  sign(messageB64: string): string {
    if (!seed || !wallet.isUnlocked()) throw new Error('locked');
    unlockedAt = Date.now();
    return signMessage(seed, messageB64);
  },

  lock(): void {
    if (seed) seed.fill(0);
    seed = null;
    unlockedAt = 0;
  },

  async cacheBlob(blob: VaultBlob): Promise<void> {
    await idbSet(BLOB_KEY, blob);
  },

  async cachedBlob(): Promise<VaultBlob | null> {
    return idbGet<VaultBlob>(BLOB_KEY);
  },

  async forget(): Promise<void> {
    wallet.lock();
    cachedAccountKey = null;
    await idbDelete(BLOB_KEY);
  },
};
