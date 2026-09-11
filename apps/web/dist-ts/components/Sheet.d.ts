import type { ReactNode } from 'react';
interface Props {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: ReactNode;
}
export declare function Sheet({ open, onClose, title, children }: Props): import("react").JSX.Element | null;
export {};
//# sourceMappingURL=Sheet.d.ts.map