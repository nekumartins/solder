import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { COPY } from '@solder/shared';
import { Avatar } from '../components/Avatar.js';
import { Button } from '../components/Button.js';
import { Screen } from '../components/Screen.js';
import { store, useApp } from '../lib/store.js';

export function Me() {
  const me = useApp((state) => state.me);
  const [qr, setQr] = useState<string | null>(null);
  const handle = me?.user.handle ?? '';
  const link = `${location.origin}/${handle}`;

  useEffect(() => {
    if (!handle) return;
    void QRCode.toDataURL(link, {
      margin: 1, width: 560, errorCorrectionLevel: 'M',
      color: { dark: '#0b0d10', light: '#ffffff' },
    }).then(setQr).catch(() => setQr(null));
  }, [handle, link]);

  const share = async (): Promise<void> => {
    const payload = { title: 'Solder', text: `Pay me at @${handle}`, url: link };
    try {
      if (navigator.share) { await navigator.share(payload); return; }
      await navigator.clipboard.writeText(link);
      store.toast(COPY.profile.copied);
    } catch {
      // A cancelled share sheet is not an error worth shouting about.
    }
  };

  return (
    <Screen
      title="You"
      action={<Link className="icon-btn" to="/settings" aria-label={COPY.settings.title}>
        <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
          <path d="M19.4 13.6a7.8 7.8 0 0 0 0-3.2l1.8-1.3-2-3.4-2.1.8a7.8 7.8 0 0 0-2.8-1.6L14 2.5h-4l-.3 2.4a7.8 7.8 0 0 0-2.8 1.6l-2.1-.8-2 3.4 1.8 1.3a7.8 7.8 0 0 0 0 3.2l-1.8 1.3 2 3.4 2.1-.8a7.8 7.8 0 0 0 2.8 1.6l.3 2.4h4l.3-2.4a7.8 7.8 0 0 0 2.8-1.6l2.1.8 2-3.4z"
            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </Link>}
    >
      <div className="me-card">
        <Avatar handle={handle || 'you'} displayName={me?.user.displayName} size={72} />
        <p className="me-name">{me?.user.displayName}</p>
        <p className="me-handle">@{handle}</p>
      </div>

      <section className="qr-card">
        <p className="qr-label">{COPY.profile.yourCode}</p>
        {qr ? <img className="qr" src={qr} alt={`QR code for @${handle}`} /> : <div className="qr qr-skeleton" />}
        <p className="qr-hint">{COPY.profile.scanToPay}</p>
      </section>

      <Button size="lg" variant="secondary" onClick={share}>{COPY.profile.share}</Button>
    </Screen>
  );
}
