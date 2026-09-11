import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

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

export function Screen({ title, subtitle, back, action, lead, children, bare, className = '' }: Props) {
  const navigate = useNavigate();
  const showHeader = Boolean(title || back || action || lead);

  return (
    <div className={`screen ${className}`}>
      {showHeader && (
        <header className="screen-head">
          {back ? (
            <button
              className="icon-btn"
              aria-label="Back"
              onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : <span className="head-spacer" />}

          <div className="screen-title">
            {lead}
            <div>
              {title ? <h1>{title}</h1> : null}
              {subtitle ? <p className="screen-sub">{subtitle}</p> : null}
            </div>
          </div>

          <div className="head-action">{action}</div>
        </header>
      )}
      {bare ? children : <div className="scroll screen-body">{children}</div>}
    </div>
  );
}
