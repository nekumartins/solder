/**
 * Android and desktop hand us an install event; iOS never does, so it gets
 * the "Add to Home Screen" instruction instead.
 */
export declare function useInstallPrompt(): {
    available: boolean;
    ios: boolean;
    prompt: () => Promise<void>;
};
//# sourceMappingURL=useInstallPrompt.d.ts.map