import { type VaultBlob } from './vault.js';
export declare const wallet: {
    isUnlocked(): boolean;
    accountKey(): string | null;
    hold(next: Uint8Array): string;
    sign(messageB64: string): string;
    lock(): void;
    cacheBlob(blob: VaultBlob): Promise<void>;
    cachedBlob(): Promise<VaultBlob | null>;
    forget(): Promise<void>;
};
//# sourceMappingURL=wallet.d.ts.map