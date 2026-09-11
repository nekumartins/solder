import { COPY } from '@solder/shared';
import { useApp } from '../lib/store.js';

export function Toast() {
  const toast = useApp((state) => state.toast);
  if (!toast) return null;
  return (
    <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}

/**
 * Sits above the app rather than over it — a warning that hides the heading it
 * is warning you about is worse than no warning.
 */
export function ConnectionBar() {
  const connection = useApp((state) => state.connection);
  if (connection === 'ok') return null;
  return (
    <div className="connection-bar" role="status">
      {connection === 'offline' ? COPY.connection.offline : COPY.connection.unreachable}
    </div>
  );
}
