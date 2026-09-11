import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { base64ToBytes, bytesToBase64, randomBytes } from './bytes.js';

/**
 * The money key never leaves this file in the clear.
 *
 * It is generated here, encrypted with a key derived from the passkey (or, on
 * devices without PRF, from a PIN), and only the ciphertext is ever stored or
 * uploaded. The server holds a blob it has no way to open.
 */

export type VaultAlg = 'prf-hkdf-aesgcm' | 'pin-pbkdf2-aesgcm';

export interface VaultBlob {
  v: 1;
  alg: VaultAlg;
  salt: string;
  iv: string;
  ct: string;
}

const INFO = new TextEncoder().encode('solder-vault-v1');
const PBKDF2_ITERATIONS = 600_000;

export interface Wallet {
  seed: Uint8Array;
  accountKey: string;
}

export function createWallet(): Wallet {
  // Not every 32-byte string is a valid secp256k1 key; the odds of needing a
  // second draw are astronomically small, but the loop costs nothing.
  let seed = randomBytes(32);
  while (!secp256k1.utils.isValidPrivateKey(seed)) seed = randomBytes(32);
  return { seed, accountKey: accountKeyFor(seed) };
}

/** The account's Ethereum address, checksummed. */
export function accountKeyFor(seed: Uint8Array): string {
  const publicKey = secp256k1.getPublicKey(seed, false);
  return toChecksumAddress(bytesToHex(keccak_256(publicKey.subarray(1)).subarray(12)));
}

/**
 * Signs the opaque bytes the server prepared — an EIP-712 digest authorising
 * one transfer to one person. Packed as r || s || v, the shape the token
 * contract recovers from.
 */
export function signMessage(seed: Uint8Array, messageB64: string): string {
  const signature = secp256k1.sign(base64ToBytes(messageB64), seed);
  const packed = new Uint8Array(65);
  packed.set(signature.toCompactRawBytes(), 0);
  packed[64] = signature.recovery + 27;
  return bytesToBase64(packed);
}

/**
 * The key in the form every Ethereum wallet expects. Only ever called from the
 * export screen, behind a fresh identity check.
 */
export function privateKeyHex(seed: Uint8Array): string {
  return `0x${bytesToHex(seed)}`;
}

/** EIP-55: mixed case that makes a mistyped address detectable. */
function toChecksumAddress(lower: string): string {
  const hashed = bytesToHex(keccak_256(new TextEncoder().encode(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const char = lower[i]!;
    out += /[a-f]/.test(char) && parseInt(hashed[i]!, 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

function bytesToHex(input: Uint8Array): string {
  return Array.from(input, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function deriveKeyFromPrf(prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', toBuffer(prfOutput), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: toBuffer(salt), info: toBuffer(INFO) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toBuffer(salt), iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptVault(seed: Uint8Array, key: CryptoKey, alg: VaultAlg, salt: Uint8Array): Promise<VaultBlob> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toBuffer(iv) }, key, toBuffer(seed));
  return {
    v: 1,
    alg,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptVault(blob: VaultBlob, key: CryptoKey): Promise<Wallet> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(base64ToBytes(blob.iv)) },
    key,
    toBuffer(base64ToBytes(blob.ct)),
  );
  const seed = new Uint8Array(plaintext);
  return { seed, accountKey: accountKeyFor(seed) };
}

export function newSalt(): Uint8Array {
  return randomBytes(32);
}

export function saltOf(blob: VaultBlob): Uint8Array {
  return base64ToBytes(blob.salt);
}

/** WebCrypto wants a real ArrayBuffer, not a view over a larger one. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
