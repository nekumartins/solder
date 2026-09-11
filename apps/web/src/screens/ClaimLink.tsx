import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { COPY, avatarFor, formatUsd, type ClaimSummary } from '@solder/shared';
import { Button } from '../components/Button.js';
import { PinSheet } from '../components/PinSheet.js';
import { api } from '../lib/api.js';
import { unlock } from '../lib/auth.js';
import { readLinkSecret, signAsHolding, stashLinkSecret, takeStashedSecret } from '../lib/claims.js';
import { haptic } from '../lib/haptics.js';
import { store, useApp } from '../lib/store.js';
import { usePinPrompt } from '../lib/usePinPrompt.js';
import { wallet } from '../lib/wallet.js';
import { friendly } from './Welcome.js';

/**
 * What a link opens: someone sent you money before you had an account.
 *
 * This is the front door for people who have never heard of any of this, so it
 * works signed out, shows a face and an amount first, and only then asks for
 * anything.
 */
export function ClaimLink() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const phase = useApp((state) => state.phase);
  const me = useApp((state) => state.me);
  const pin = usePinPrompt();

  const [claim, setClaim] = useState<ClaimSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // The secret lives in the fragment. Stash it before anything navigates away,
  // because onboarding will replace the URL.
  useEffect(() => {
    const secret = readLinkSecret();
    if (secret) stashLinkSecret(secret);
  }, []);

  useEffect(() => {
    void api.get<{ claim: ClaimSummary }>(`/api/claims/${id}`)
      .then((result) => setClaim(result.claim))
      .catch(() => setMissing(true));
  }, [id]);

  const pickUp = async (): Promise<void> => {
    setBusy(true);
    try {
      const secret = readLinkSecret() ?? takeStashedSecret();
      if (!secret) throw new Error('no_secret');
      stashLinkSecret(secret);

      if (!wallet.isUnlocked()) await unlock(pin.request, me?.user.handle);

      const prepared = await api.post<{ paymentId: string; messageB64: string }>(
        `/api/claims/${id}/prepare`);
      await api.post(`/api/claims/${id}/settle`, {
        paymentId: prepared.paymentId,
        // Signed by the holding account, whose key is only in the link.
        signatureB64: signAsHolding(secret, prepared.messageB64),
      });

      haptic('success');
      setDone(true);
      await Promise.all([store.refreshMe(), store.refreshThreads()]);
      setTimeout(() => navigate('/', { replace: true }), 1400);
    } catch (error) {
      haptic('error');
      store.toast(friendly(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  if (missing || claim?.status === 'claimed' || claim?.status === 'reclaimed') {
    return (
      <div className="profile-land">
        <p className="profile-name">{COPY.link.expiredTitle}</p>
        <p className="profile-handle">{COPY.link.gone}</p>
        <Button size="lg" variant="secondary" onClick={() => navigate('/')}>Go home</Button>
      </div>
    );
  }

  if (!claim) {
    return <div className="boot"><span className="spinner spinner-lg" aria-label="Loading" /></div>;
  }

  const amount = formatUsd(BigInt(claim.amountMicros));
  const avatar = avatarFor(claim.from.handle, claim.from.displayName);

  if (done) {
    return (
      <div className="success">
        <div className="success-mark" aria-hidden="true">
          <svg viewBox="0 0 52 52" width="76" height="76">
            <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M15 27l8 8 15-16" fill="none" stroke="currentColor" strokeWidth="4"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="success-amount num">{amount}</p>
        <p className="success-text">It’s yours</p>
      </div>
    );
  }

  return (
    <div className="profile-land claim-land">
      <span className="claim-emoji" aria-hidden="true">{claim.emoji ?? '💸'}</span>
      <span
        className="avatar avatar-xl"
        style={{ background: avatar.bg, color: avatar.fg }}
        aria-hidden="true"
      >
        {avatar.initials}
      </span>
      <p className="profile-name">{COPY.link.incoming(claim.from.displayName)}</p>
      <p className="claim-amount num">{amount}</p>
      {claim.note ? <p className="profile-reason">“{claim.note}”</p> : null}

      {phase === 'ready' && me ? (
        <Button size="lg" busy={busy} onClick={pickUp}>
          {busy ? COPY.link.accepting : COPY.link.accept}
        </Button>
      ) : (
        <>
          <Button size="lg" onClick={() => navigate(`/claim?next=/c/${id}`)}>
            {COPY.link.needAccount}
          </Button>
          <Button size="lg" variant="ghost" onClick={() => navigate(`/welcome?next=/c/${id}`)}>
            {COPY.welcome.signIn}
          </Button>
        </>
      )}

      <PinSheet open={pin.open} reason={pin.reason} onSubmit={pin.submit} onCancel={pin.cancel} />
    </div>
  );
}
