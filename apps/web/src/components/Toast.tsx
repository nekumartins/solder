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

export function OfflineBar() {
  const online = useApp((state) => state.online);
  if (online) return null;
  return <div className="offline-bar" role="status">You’re offline</div>;
}
