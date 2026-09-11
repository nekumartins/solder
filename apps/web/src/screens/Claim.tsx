import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { COPY, avatarFor, validateHandle } from '@solder/shared';
import { Button } from '../components/Button.js';
import { PinSheet } from '../components/PinSheet.js';
import { Screen } from '../components/Screen.js';
import { api } from '../lib/api.js';
import { signUp } from '../lib/auth.js';
import { store } from '../lib/store.js';
import { usePinPrompt } from '../lib/usePinPrompt.js';
import { friendly } from './Welcome.js';

type Availability = { state: 'idle' | 'checking' | 'free' | 'taken'; reason?: string };

export function Claim() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Onboarding can be interrupted by a link; come back to it afterwards.
  const next = params.get('next') ?? '/';
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const pin = usePinPrompt();

  useEffect(() => {
    const check = validateHandle(handle);
    if (!check.ok) {
      setAvailability(handle ? { state: 'taken', reason: check.reason } : { state: 'idle' });
      return;
    }
    setAvailability({ state: 'checking' });
    const timer = setTimeout(async () => {
      try {
        const result = await api.get<{ available: boolean; reason?: string }>(
          `/api/users/handle-available?handle=${encodeURIComponent(check.handle)}`);
        setAvailability(result.available
          ? { state: 'free' }
          : { state: 'taken', reason: result.reason });
      } catch {
        setAvailability({ state: 'idle' });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [handle]);

  const ready = availability.state === 'free' && displayName.trim().length > 1;
  const avatar = avatarFor(handle || 'you', displayName);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      await signUp(handle, displayName.trim(), pin.request);
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
    <Screen title={COPY.claim.title} subtitle={COPY.claim.sub} back="/welcome" className="claim">
      <div className="claim-preview">
        <span
          className="avatar avatar-xl"
          style={{ background: avatar.bg, color: avatar.fg }}
          aria-hidden="true"
        >
          {avatar.initials}
        </span>
        <p className="claim-preview-name">{displayName.trim() || 'Your name'}</p>
        <p className="claim-preview-handle">@{handle || 'you'}</p>
      </div>

      <label className="field">
        <span className="field-label">{COPY.claim.displayLabel}</span>
        <input
          className="field-input"
          value={displayName}
          autoComplete="name"
          placeholder="Ana Ruiz"
          onChange={(event) => setDisplayName(event.target.value.slice(0, 40))}
        />
      </label>

      <label className="field">
        <span className="field-label">{COPY.claim.handleLabel}</span>
        <div className="field-row">
          <span className="field-prefix">@</span>
          <input
            className="field-input"
            value={handle}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            placeholder="ana"
            onChange={(event) => setHandle(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          />
          <AvailabilityBadge availability={availability} />
        </div>
      </label>

      <p className="claim-note">{COPY.claim.biometric}</p>

      <Button size="lg" disabled={!ready || busy} busy={busy} onClick={create}>
        {busy ? COPY.claim.creating : COPY.claim.submit}
      </Button>

      <PinSheet open={pin.open} reason={pin.reason} onSubmit={pin.submit} onCancel={pin.cancel} />
    </Screen>
  );
}

function AvailabilityBadge({ availability }: { availability: Availability }) {
  if (availability.state === 'idle') return null;
  if (availability.state === 'checking') return <span className="badge">{COPY.claim.checking}</span>;
  if (availability.state === 'free') return <span className="badge badge-good">{COPY.claim.available}</span>;
  return <span className="badge badge-bad">{availability.reason ?? COPY.claim.taken}</span>;
}
