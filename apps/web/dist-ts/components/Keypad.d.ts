interface Props {
    value: string;
    onChange: (next: string) => void;
    max?: number;
}
/**
 * A purpose-built pad rather than the OS keyboard: bigger targets, no
 * accidental letters, and the amount stays the hero of the screen.
 */
export declare function Keypad({ value, onChange, max }: Props): import("react").JSX.Element;
export declare function AmountDisplay({ value, hint }: {
    value: string;
    hint?: string;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=Keypad.d.ts.map