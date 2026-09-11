/**
 * Bridges the promise-based auth flow to a rendered sheet: auth asks for a
 * code, the sheet collects it, the promise resolves.
 */
export declare function usePinPrompt(): {
    open: boolean;
    reason: "create" | "unlock";
    request: (next: "create" | "unlock") => Promise<string>;
    submit: (pin: string) => void;
    cancel: () => void;
};
//# sourceMappingURL=usePinPrompt.d.ts.map