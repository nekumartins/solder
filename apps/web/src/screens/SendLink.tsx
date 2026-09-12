import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COPY, formatUsd, parseAmount, tryParseAmount } from '@solder/shared';
import { AmountDisplay, Keypad } from '../components/Keypad.js';
import { Button } from '../components/Button.js';
import { PinSheet } from '../components/PinSheet.js';
import { SlideToSend } from '../components/SlideToSend.js';
import { api } from '../lib/api.js';
import { unlock } from '../lib/auth.js';
import { claimLink, deriveHolding, newHoldingRef } from '../lib/claims.js';
import { haptic } from '../lib/haptics.js';
import { store, useApp } from '../lib/store.js';
import { usePinPrompt } from '../lib/usePinPrompt.js';
import { wallet } from '../lib/wallet.js';
import { friendly } from './Welcome.js';

/**
 * Sending money to someone who is not here yet. They get a link; the money
 * waits in a holding account only the link can open.
 */
export function SendLink() {
  const navigate = useNavigate();
  const me = useApp((state) => state.me);
  const pin = usePinPrompt();

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const balance = BigInt(me?.balanceMicros ?? '0');
  const micros = tryParseAmount(amount || '0') ?? 0n;
  const tooMuch = micros > balance;
  const ready = micros > 0n && !tooMuch;

  const create = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (!wallet.isUnlocked()) await unlock(pin.request, me?.user.handle);

      // The holding account's key never leaves this device except inside the
      // link's fragment, which browsers do not send to servers.
      const ref = newHoldingRef();
      const holding = await deriveHolding(wallet.seedForDerivation(), ref);

      const created = await api.post<{ claimId: string; paymentId: string; messageB64: string }>(
        '/api/claims', {
          amountMicros: parseAmount(amount).toString(),
          note: note.trim() || null,
          escrowAddress: holding.address,
          derivationRef: ref,
        });
      await api.post(`/api/claims/${created.claimId}/fund`, {
        paymentId: created.paymentId,
        signatureB64: wallet.sign(created.messageB64),
      });

      haptic('success');
      setLink(claimLink(created.claimId, holding));
      void store.refreshMe();
    } catch (error) {
      haptic('error');
      store.toast(friendly(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const share = async (): Promise<void> => {
    if (!link) return;
    const text = `I sent you ${formatUsd(micros)}${note.trim() ? ` — ${note.trim()}` : ''}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Solder', text, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      store.toast(COPY.link.copied);
    } catch {
      // A cancelled share sheet is not worth shouting about.
    }
  };

  if (link) {
    return (
      <div className="screen link-done">
        <div className="success-mark" aria-hidden="true">
          <svg viewBox="0 0 52 52" width="64" height="64">
            <circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" strokeWidth="3" />
            <path d="M15 27l8 8 15-16" fill="none" stroke="currentColor" strokeWidth="4"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="success-amount num">{formatUsd(micros)}</p>
        <p className="success-text">{COPY.link.ready}</p>
        <p className="link-hint">{COPY.link.linkHint}</p>
        <code className="link-box">{link.replace(/^https?:\/\//, '')}</code>
        <Button size="lg" onClick={share}>{COPY.link.share}</Button>
        <Button size="lg" variant="ghost" onClick={() => navigate('/', { replace: true })}>
          Done
        </Button>
        <PinSheet open={pin.open} reason={pin.reason} onSubmit={pin.submit} onCancel={pin.cancel} />
      </div>
    );
  }

  return (
    <div className="screen pay">
      <header className="pay-head">
        <button className="icon-btn" aria-label="Cancel" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" />
          </svg>
        </button>
        <div className="pay-peer"><span>{COPY.link.sendByLink}</span></div>
        <span className="head-spacer" />
      </header>

      <div className="pay-body">
        <AmountDisplay
          value={amount}
          hint={tooMuch ? COPY.pay.insufficient : COPY.link.linkHint}
        />
        <div className="note-row">
          <input
            className="note-input"
            value={note}
            placeholder={COPY.pay.noteePlaceholder}
            aria-label={COPY.pay.noteePlaceholder}
            onChange={(event) => setNote(event.target.value.slice(0, 140))}
          />
        </div>
        <Keypad value={amount} onChange={setAmount} />
      </div>

      <div className="pay-confirm">
        <SlideToSend
          label={COPY.link.sendByLink}
          busyLabel={COPY.pay.confirming}
          disabled={!ready}
          busy={busy}
          onConfirm={create}
        />
      </div>

      <PinSheet open={pin.open} reason={pin.reason} onSubmit={pin.submit} onCancel={pin.cancel} />
    </div>
  );
}
