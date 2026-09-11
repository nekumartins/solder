import type { ReactNode } from 'react';
interface Props {
    title?: ReactNode;
    subtitle?: ReactNode;
    back?: boolean | string;
    action?: ReactNode;
    lead?: ReactNode;
    children: ReactNode;
    bare?: boolean;
    className?: string;
}
export declare function Screen({ title, subtitle, back, action, lead, children, bare, className }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=Screen.d.ts.map