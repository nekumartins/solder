import { type ThreadEvent } from '@solder/shared';
interface Props {
    event: ThreadEvent;
    onPay?: (event: ThreadEvent) => void;
    onDecline?: (event: ThreadEvent) => void;
    onCancel?: (event: ThreadEvent) => void;
    onReact?: (event: ThreadEvent, emoji: string) => void;
}
export declare function EventBubble({ event, onPay, onDecline, onCancel, onReact }: Props): import("react").JSX.Element;
export declare function DayDivider({ at }: {
    at: number;
}): import("react").JSX.Element;
export declare function dayLabel(at: number): string;
export {};
//# sourceMappingURL=EventBubble.d.ts.map