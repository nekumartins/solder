interface Props {
    label: string;
    busyLabel?: string;
    disabled?: boolean;
    busy?: boolean;
    onConfirm: () => void;
}
/**
 * A deliberate gesture for an irreversible action: you have to mean it.
 * Keyboard users get the same commitment via Enter or Space.
 */
export declare function SlideToSend({ label, busyLabel, disabled, busy, onConfirm }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=SlideToSend.d.ts.map