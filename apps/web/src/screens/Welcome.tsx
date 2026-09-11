import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { COPY } from '@solder/shared';
import { Button } from '../components/Button.js';
import { PinSheet } from '../components/PinSheet.js';
import { signIn } from '../lib/auth.js';
import { store } from '../lib/store.js';
import { usePinPrompt } from '../lib/usePinPrompt.js';

export function Welcome() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Onboarding can be interrupted by a link; come back to it afterwards.
  const next = params.get('next') ?? '/';
  const [busy, setBusy] = useState(false);
  const pin = usePinPrompt();

  const returning = async (): Promise<void> => {
    setBusy(true);
    try {
      await signIn(pin.request);
      store.signedIn();
      await store.load();
      navigate(next, { replace: true });
    } catch (error) {
      store.toast(friendly(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-art" aria-hidden="true">
        <span className="orb orb-1" />
        <span className="orb orb-2" />
        <div className="welcome-cards">
          <div className="wcard wcard-in">
            <span className="wcard-amount num">+$24.00</span>
            <span className="wcard-note">dinner at Lupa 🍝</span>
          </div>
          <div className="wcard wcard-out">
            <span className="wcard-amount num">$8.50</span>
            <span className="wcard-note">coffee ☕</span>
          </div>
        </div>
      </div>

      <div className="welcome-copy">
        <h1>{COPY.welcome.headline}</h1>
        <p>{COPY.welcome.sub}</p>
      </div>

      <div className="welcome-actions">
        <Button size="lg" onClick={() => navigate('/claim')}>{COPY.welcome.create}</Button>
        <Button size="lg" variant="ghost" busy={busy} onClick={returning}>
          {COPY.welcome.signIn}
        </Button>
        <p className="welcome-foot">{COPY.welcome.reassure}</p>
      </div>

      <PinSheet open={pin.open} reason={pin.reason} onSubmit={pin.submit} onCancel={pin.cancel} />
    </div>
  );
}

export function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'cancelled' || (error as { name?: string })?.name === 'NotAllowedError') {
    return COPY.errors.passkeyFailed;
  }
  if (message === 'passkeys_unsupported') return COPY.errors.passkeyUnsupported;
  if (message === 'wrong_pin') return 'That code did not match';
  if (message === 'unlock_failed' || message === 'prf_unavailable') return COPY.errors.passkeyFailed;
  if ((error as { code?: string })?.code === 'no_backup') return COPY.errors.noBackup;
  if ((error as { code?: string })?.code === 'offline') return COPY.errors.offline;
  return (error as { message?: string })?.message ?? COPY.errors.generic;
}
