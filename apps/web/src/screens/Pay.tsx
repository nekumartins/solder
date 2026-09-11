import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { COPY, formatUsd, parseAmount, tryParseAmount, type PublicUser, type ThreadEvent } from '@solder/shared';
import { Avatar } from '../components/Avatar.js';
import { AmountDisplay, Keypad } from '../components/Keypad.js';
import { PinSheet } from '../components/PinSheet.js';
import { SlideToSend } from '../components/SlideToSend.js';
import { api, ApiError } from '../lib/api.js';
import { unlock } from '../lib/auth.js';
import { haptic } from '../lib/haptics.js';
import { store, useApp } from '../lib/store.js';
import { usePinPrompt } from '../lib/usePinPrompt.js';
import { wallet } from '../lib/wallet.js';
import { friendly } from './Welcome.js';

const QUICK_EMOJI = ['🍜', '☕', '🎁', '🚕', '🍻', '🎟️', '🏠', '❤️'];

interface Props { mode: 'pay' | 'request' }

export function Pay({ mode }: Props) {
  const { handle = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const me = useApp((state) => state.me);
  const online = useApp((state) => state.online);
  const pin = usePinPrompt();

  const [peer, setPeer] = useState<PublicUser | null>(null);
  const [amount, setAmount] = useState(initialAmount(params));
  const [note, setNote] = useState(params.get('for') ?? '');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const requestEventId = params.get('request');
  const balance = BigInt(me?.balanceMicros ?? '0');
  const micros = tryParseAmount(amount || '0') ?? 0n;
  const tooMuch = mode === 'pay' && micros > balance;
  const ready = micros > 0n && !tooMuch && online;

  useEffect(() => {
    void api.get<{ user: PublicUser }>(`/api/users/${handle}`)
      .then((result) => setPeer(result.user))
      .catch(() => store.toast(COPY.pay.unknownPerson, 'bad'));
  }, [handle]);

  const confirm = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (mode === 'request') {
        await api.post('/api/requests', {
          toHandle: handle, amountMicros: parseAmount(amount).toString(),
          note: note.trim() || null, emoji,
        });
      } else {
        await sendMoney();
      }
      haptic('success');
      setDone(true);
      void store.refreshMe();
      void store.refreshThreads();
      setTimeout(() => navigate(`/t/${handle}`, { replace: true }), 1100);
    } catch (error) {
      haptic('error');
      store.toast(friendly(error), 'bad');
      setBusy(false);
    }
  };

  const sendMoney = async (): Promise<void> => {
    // Confirm it is really you, then bring the key into memory just long
    // enough to sign.
    if (!wallet.isUnlocked()) await unlock(pin.request, me?.user.handle);

    const prepared = await api.post<{ paymentId: string; messageB64: string }>('/api/payments', {
      toHandle: handle,
      amountMicros: parseAmount(amount).toString(),
      note: note.trim() || null,
      emoji,
      ...(requestEventId ? { requestEventId } : {}),
    });

    await api.post<{ event: ThreadEvent }>(`/api/payments/${prepared.paymentId}/submit`, {
      signatureB64: wallet.sign(prepared.messageB64),
    });
  };

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
        <p className="success-amount num">{formatUsd(micros)}</p>
        <p className="success-text">
          {mode === 'pay' ? COPY.pay.sent : COPY.pay.requested} to {peer?.displayName ?? `@${handle}`}
        </p>
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
        <div className="pay-peer">
          <Avatar handle={handle} displayName={peer?.displayName} size={30} />
          <span>{mode === 'pay' ? 'To' : 'From'} {peer?.displayName ?? `@${handle}`}</span>
        </div>
        <span className="head-spacer" />
      </header>

      <div className="pay-body">
        <AmountDisplay
          value={amount}
          hint={tooMuch
            ? COPY.pay.insufficient
            : mode === 'pay'
              ? `${formatUsd(balance)} available`
              : `They’ll get a tap-to-pay request`}
        />

        <div className="note-row">
          <div className="emoji-row" role="group" aria-label="Add an emoji">
            {QUICK_EMOJI.map((option) => (
              <button
                key={option}
                className={`emoji-pick ${emoji === option ? 'is-on' : ''}`}
                onClick={() => { haptic('tap'); setEmoji(emoji === option ? null : option); }}
                aria-pressed={emoji === option}
              >
                {option}
              </button>
            ))}
          </div>
          <input
            className="note-input"
            value={note}
            placeholder={COPY.pay.noteePlaceholder}
            aria-label={COPY.pay.noteePlaceholder}
            onChange={(event) => setNote(event.target.value.slice(0, 140))}
          />
        </div>

        <Keypad value={amount} onChange={setAmount} />

        <div className="pay-confirm">
          {!online && <p className="pay-warn">{COPY.pay.offline}</p>}
          <SlideToSend
            label={mode === 'pay' ? COPY.pay.review : COPY.pay.reviewRequest}
            busyLabel={COPY.pay.confirming}
            disabled={!ready}
            busy={busy}
            onConfirm={confirm}
          />
        </div>
      </div>

      <PinSheet open={pin.open} reason={pin.reason} onSubmit={pin.submit} onCancel={pin.cancel} />
    </div>
  );
}

function initialAmount(params: URLSearchParams): string {
  const micros = params.get('amount');
  if (micros && /^\d+$/.test(micros)) {
    return formatUsd(BigInt(micros), { bare: true }).replace(/,/g, '');
  }
  return '';
}

export { ApiError };
