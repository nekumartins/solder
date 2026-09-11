import type { ReactNode } from 'react';
import { useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet-layer">
      <button className="sheet-scrim" aria-label="Close" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <span className="sheet-grip" aria-hidden="true" />
        {title ? <h2 className="sheet-title">{title}</h2> : null}
        {children}
      </div>
    </div>
  );
}
