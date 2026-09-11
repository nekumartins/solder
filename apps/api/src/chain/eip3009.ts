import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

/**
 * EIP-3009 `transferWithAuthorization`, which is what makes a payment feel
 * free on Ethereum.
 *
 * The person sending money signs an authorisation naming the recipient, the
 * amount and a validity window. Anyone may then submit it on-chain and pay the
 * gas. Because the signature covers the recipient and amount, the relayer
 * paying that gas cannot redirect a single cent — the same property the
 * fee-payer model gave us elsewhere.
 *
 * The digest is built here by hand rather than by a library so the exact bytes
 * being signed are visible and auditable. `eip3009.test.ts` checks them against
 * viem's reference implementation.
 */

const TRANSFER_WITH_AUTHORIZATION_TYPE =
  'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)';
const EIP712_DOMAIN_TYPE =
  'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: bigint;
  verifyingContract: string;
}

export interface Authorization {
  from: string;
  to: string;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  /** 32 bytes. Arbitrary but single-use per sender. */
  nonce: Uint8Array;
}

export function domainSeparator(domain: Eip712Domain): Uint8Array {
  return keccak_256(concat(
    keccak_256(utf8(EIP712_DOMAIN_TYPE)),
    keccak_256(utf8(domain.name)),
    keccak_256(utf8(domain.version)),
    uint256(domain.chainId),
    addressWord(domain.verifyingContract),
  ));
}

export function authorizationDigest(domain: Eip712Domain, auth: Authorization): Uint8Array {
  const structHash = keccak_256(concat(
    keccak_256(utf8(TRANSFER_WITH_AUTHORIZATION_TYPE)),
    addressWord(auth.from),
    addressWord(auth.to),
    uint256(auth.value),
    uint256(auth.validAfter),
    uint256(auth.validBefore),
    word(auth.nonce),
  ));
  // EIP-191 prefix for structured data: 0x19 0x01 || domain || struct
  return keccak_256(concat(new Uint8Array([0x19, 0x01]), domainSeparator(domain), structHash));
}

/**
 * A payment's nonce is derived from its reference, so the server can rebuild
 * the exact authorisation later without storing anything extra — and two
 * payments can never collide.
 */
export function nonceFor(ref: string): Uint8Array {
  return keccak_256(utf8(`solder-authorization:${ref}`));
}

/** 65 bytes: r || s || v, the shape `ecrecover` expects. */
export function signDigest(digest: Uint8Array, privateKey: Uint8Array): Uint8Array {
  const signature = secp256k1.sign(digest, privateKey);
  const packed = new Uint8Array(65);
  packed.set(signature.toCompactRawBytes(), 0);
  // EIP-155 era contracts expect 27/28 rather than a raw recovery bit.
  packed[64] = signature.recovery + 27;
  return packed;
}

export function recoverSigner(digest: Uint8Array, signature: Uint8Array): string | null {
  if (signature.length !== 65) return null;
  const v = signature[64]!;
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) return null;
  try {
    const recovered = secp256k1.Signature
      .fromCompact(signature.subarray(0, 64))
      .addRecoveryBit(recovery)
      .recoverPublicKey(digest)
      .toRawBytes(false);
    return addressFromPublicKey(recovered);
  } catch {
    return null;
  }
}

export function addressFromPrivateKey(privateKey: Uint8Array): string {
  return addressFromPublicKey(secp256k1.getPublicKey(privateKey, false));
}

export function addressFromPublicKey(uncompressed: Uint8Array): string {
  // Drop the 0x04 prefix; the address is the last 20 bytes of the hash.
  const hashed = keccak_256(uncompressed.subarray(1));
  return toChecksumAddress(`0x${hex(hashed.subarray(12))}`);
}

/** EIP-55: mixed case that makes a mistyped address detectable. */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hashed = hex(keccak_256(utf8(lower)));
  let out = '0x';
  for (let i = 0; i < lower.length; i++) {
    const char = lower[i]!;
    out += /[a-f]/.test(char) && parseInt(hashed[i]!, 16) >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

export function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function sameAddress(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

// ---- ABI word encoding -----------------------------------------------------

function word(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 32) return bytes;
  const out = new Uint8Array(32);
  out.set(bytes.subarray(0, 32), 32 - Math.min(bytes.length, 32));
  return out;
}

function uint256(value: bigint): Uint8Array {
  if (value < 0n) throw new Error('uint256 cannot be negative');
  const out = new Uint8Array(32);
  let remaining = value;
  for (let i = 31; i >= 0 && remaining > 0n; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function addressWord(address: string): Uint8Array {
  return word(bytes(address));
}

export function bytes(hexString: string): Uint8Array {
  const clean = hexString.replace(/^0x/, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function hex(input: Uint8Array): string {
  return Array.from(input, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hex0x(input: Uint8Array): string {
  return `0x${hex(input)}`;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
