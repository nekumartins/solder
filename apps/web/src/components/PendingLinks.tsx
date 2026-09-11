import { useEffect, useState } from 'react';
import { COPY, formatUsd, type ClaimSummary } from '@solder/shared';
import { api } from '../lib/api.js';
import { deriveHolding, signAsHolding } from '../lib/claims.js';
import { unlock } from '../lib/auth.js';
import { store } from '../lib/store.js';
import { wallet } from '../lib/wallet.js';
import { usePinPrompt } from '../lib/usePinPrompt.js';
import { PinSheet } from './PinSheet.js';
import { friendly } from '../screens/Welcome.js';

/**
 * Money you sent as a link that nobody has picked up yet — with a way to take
 * it back, which works even on a device that never saw the link.
 */
export function PendingLinks() {
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const pin = usePinPrompt();

  const load = () => api.get<{ claims: ClaimSummary[] }>('/api/claims')
    .then((result) => setClaims(result.claims.filter((claim) => claim.status === 'open')))
    .catch(() => setClaims([]));

  useEffect(() => { void load(); }, []);

  const takeBack = async (claim: ClaimSummary): Promise<void> => {
    setBusy(claim.id);
    try {
      if (!wallet.isUnlocked()) await unlock(pin.request);
      if (!claim.derivationRef) throw new Error('no_ref');

      // Rebuild the holding account's key from our own, then sign as it.
      const holding = await deriveHolding(wallet.seedForDerivation(), claim.derivationRef);
      const prepared = await api.post<{ paymentId: string; messageB64: string }>(
        `/api/claims/${claim.id}/prepare`);
      await api.post(`/api/claims/${claim.id}/settle`, {
        paymentId: prepared.paymentId,
        signatureB64: signAsHolding(holding.seed, prepared.messageB64),
      });

      store.toast(COPY.link.reclaimed);
      await Promise.all([store.refreshMe(), load()]);
    } catch (error) {
      store.toast(friendly(error), 'bad');
    } finally {
      setBusy(null);
    }
  };

  if (claims.length === 0) return null;

  return (
    <section className="pending">
      <p className="list-label">{COPY.link.waiting}</p>
      <ul className="pending-list">
        {claims.map((claim) => (
          <li key={claim.id} className="pending-row">
            <span className="pending-emoji" aria-hidden="true">{claim.emoji ?? '🔗'}</span>
            <span className="pending-main">
              <span className="pending-amount num">{formatUsd(BigInt(claim.amountMicros))}</span>
              <span className="pending-note">{claim.note ?? COPY.link.linkHint}</span>
            </span>
            <button
              className="chip chip-quiet"
              disabled={busy === claim.id}
              onClick={() => takeBack(claim)}
            >
              {busy === claim.id ? '…' : COPY.link.reclaim}
            </button>
          </li>
        ))}
      </ul>
      <PinSheet open={pin.open} reason={pin.reason} onSubmit={pin.submit} onCancel={pin.cancel} />
    </section>
  );
}
