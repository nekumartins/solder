import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { haptic } from '../lib/haptics.js';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  busy?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary', size = 'md', busy = false, children, className = '', onClick, ...rest
}: Props) {
  return (
    <button
      className={`btn btn-${variant} btn-${size} ${busy ? 'is-busy' : ''} ${className}`}
      onClick={(event) => { haptic('tap'); onClick?.(event); }}
      {...rest}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span className="btn-label">{children}</span>
    </button>
  );
}
