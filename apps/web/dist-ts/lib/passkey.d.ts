export interface PasskeyResult {
    /** Serialized for the server to verify. */
    response: Record<string, unknown>;
    /** 32 bytes from the authenticator, or null when the device lacks PRF. */
    prfOutput: Uint8Array | null;
}
export declare function passkeysSupported(): boolean;
export declare function platformAuthenticatorAvailable(): Promise<boolean>;
export declare function createPasskey(options: any): Promise<PasskeyResult>;
export declare function assertPasskey(options: any): Promise<PasskeyResult>;
//# sourceMappingURL=passkey.d.ts.map