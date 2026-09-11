import type { ButtonHTMLAttributes, ReactNode } from 'react';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'md' | 'lg';
    busy?: boolean;
    children: ReactNode;
}
export declare function Button({ variant, size, busy, children, className, onClick, ...rest }: Props): import("react").JSX.Element;
export {};
//# sourceMappingURL=Button.d.ts.map