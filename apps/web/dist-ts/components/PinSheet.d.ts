interface Props {
    open: boolean;
    reason: 'create' | 'unlock';
    onSubmit: (pin: string) => void;
    onCancel: () => void;
}
/**
 * Only shown on devices whose passkeys cannot derive a key on their own.
 * Still no phrase to write down — just six digits.
 */
export declare function PinSheet({ open, reason, onSubmit, onCancel }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=PinSheet.d.ts.map