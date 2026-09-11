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
export interface Wallet {
    seed: Uint8Array;
    accountKey: string;
}
export declare function createWallet(): Wallet;
export declare function accountKeyFor(seed: Uint8Array): string;
/** Signs the opaque bytes the server prepared. */
export declare function signMessage(seed: Uint8Array, messageB64: string): string;
export declare function deriveKeyFromPrf(prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey>;
export declare function deriveKeyFromPin(pin: string, salt: Uint8Array): Promise<CryptoKey>;
export declare function encryptVault(seed: Uint8Array, key: CryptoKey, alg: VaultAlg, salt: Uint8Array): Promise<VaultBlob>;
export declare function decryptVault(blob: VaultBlob, key: CryptoKey): Promise<Wallet>;
export declare function newSalt(): Uint8Array;
export declare function saltOf(blob: VaultBlob): Uint8Array;
//# sourceMappingURL=vault.d.ts.map