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
export declare function signUp(handle: string, displayName: string, requestPin: PinPrompt): Promise<SessionUser>;
export declare function signIn(requestPin: PinPrompt, handle?: string): Promise<SessionUser>;
/** Re-confirms it is really you, then brings the money key back into memory. */
export declare function unlock(requestPin: PinPrompt, handle?: string): Promise<void>;
export declare function signOut(): Promise<void>;
/** Development shortcut: adopt a known key without a passkey. */
export declare function adoptDevWallet(secretKeyB64: string): Promise<void>;
//# sourceMappingURL=auth.d.ts.map