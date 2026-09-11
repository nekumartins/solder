/**
 * A single-store key/value cupboard. Only ever holds the *encrypted* vault
 * blob and small display cache — never a usable key.
 */
const DB_NAME = 'solder';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Private browsing and blocked storage are survivable: the encrypted
    // backup on the server is the source of truth.
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  } catch {
    // nothing to clean up
  }
}
