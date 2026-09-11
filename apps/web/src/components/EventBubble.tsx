import { useRef, useState } from 'react';
import { COPY, formatUsd, type ThreadEvent } from '@solder/shared';
import { haptic } from '../lib/haptics.js';

const QUICK_REACTIONS = ['❤️', '😂', '🔥', '😭', '🤝'];

interface Props {
  event: ThreadEvent;
  /** Groups need a name above each bubble; a one-to-one conversation does not. */
  showSender?: boolean;
  onReveal?: (event: ThreadEvent) => void;
  onPay?: (event: ThreadEvent) => void;
  onDecline?: (event: ThreadEvent) => void;
  onCancel?: (event: ThreadEvent) => void;
  onReact?: (event: ThreadEvent, emoji: string) => void;
}

export function EventBubble({
  event, showSender, onReveal, onPay, onDecline, onCancel, onReact,
}: Props) {
  const [picking, setPicking] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const holdStart = (): void => {
    if (!onReact || event.kind === 'system') return;
    timer.current = window.setTimeout(() => { haptic('tap'); setPicking(true); }, 420);
  };
  const holdEnd = (): void => window.clearTimeout(timer.current);

  if (event.kind === 'system') {
    return <div className="sys-line">{event.body}</div>;
  }

  const side = event.mine ? 'out' : 'in';

  return (
    <div className={`row row-${side}`}>
      {showSender && !event.mine && <span className="row-sender">{event.from}</span>}
      <div
        className={`bubble bubble-${event.kind} bubble-${side} ${event.status ? `is-${event.status}` : ''}`}
        onPointerDown={holdStart}
        onPointerUp={holdEnd}
        onPointerLeave={holdEnd}
        onContextMenu={(e) => { if (onReact) { e.preventDefault(); setPicking(true); } }}
      >
        {event.kind === 'note' ? (
          <p className="bubble-text">{event.body}</p>
        ) : event.gift && !event.revealed && !event.mine ? (
          <GiftBody event={event} onReveal={onReveal} />
        ) : (
          <MoneyBody event={event} />
        )}

        {event.kind === 'request' && event.status === 'open' && (
          <div className="bubble-actions">
            {event.mine ? (
              <button className="chip chip-quiet" onClick={() => onCancel?.(event)}>
                {COPY.thread.cancel}
              </button>
            ) : (
              <>
                <button className="chip chip-quiet" onClick={() => onDecline?.(event)}>
                  {COPY.thread.decline}
                </button>
                <button className="chip chip-pay" onClick={() => onPay?.(event)}>
                  {COPY.thread.pay} {formatUsd(BigInt(event.amountMicros ?? '0'))}
                </button>
              </>
            )}
          </div>
        )}

        <time className="bubble-time">{shortTime(event.createdAt)}</time>
      </div>

      {event.reactions.length > 0 && (
        <div className={`reactions reactions-${side}`}>
          {event.reactions.map((reaction) => (
            <span key={`${reaction.handle}-${reaction.emoji}`} className="reaction">{reaction.emoji}</span>
          ))}
        </div>
      )}

      {picking && (
        <>
          <button className="react-scrim" aria-label="Close" onClick={() => setPicking(false)} />
          <div className={`react-pop react-pop-${side}`} role="menu">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                className="react-option"
                onClick={() => { haptic('tap'); onReact?.(event, emoji); setPicking(false); }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** A surprise: the app genuinely does not know the amount until it is opened. */
function GiftBody({ event, onReveal }: { event: ThreadEvent; onReveal?: (e: ThreadEvent) => void }) {
  return (
    <div className="gift">
      <span className="gift-mark" aria-hidden="true">🎁</span>
      <p className="bubble-caption">@{event.from} {COPY.gift.waiting}</p>
      {event.note ? <p className="bubble-note">{event.note}</p> : null}
      <button className="chip chip-pay gift-open" onClick={() => onReveal?.(event)}>
        {COPY.gift.reveal}
      </button>
    </div>
  );
}

function MoneyBody({ event }: { event: ThreadEvent }) {
  const amount = formatUsd(BigInt(event.amountMicros ?? '0'));
  const isRequest = event.kind === 'request';
  const isExpense = event.kind === 'expense';

  return (
    <>
      <div className="bubble-head">
        {event.emoji ? <span className="bubble-emoji">{event.emoji}</span> : null}
        {event.gift && event.mine ? <span className="bubble-emoji">🎁</span> : null}
        <span className="bubble-amount num">{amount}</span>
      </div>
      <p className="bubble-caption">{caption(event)}</p>
      {event.note ? <p className="bubble-note">{event.note}</p> : null}

      {event.split && (
        <p className="bubble-split">
          {COPY.split.progress(event.split.paidCount, event.split.participantCount)}
        </p>
      )}

      {!isRequest && !isExpense && <StatusLine event={event} />}
      {isRequest && event.status !== 'open' && (
        <p className="bubble-status">{requestStatusLabel(event.status)}</p>
      )}
    </>
  );
}

function StatusLine({ event }: { event: ThreadEvent }) {
  if (event.status === 'pending') {
    return <p className="bubble-status is-pending"><span className="pulse" />{COPY.thread.pending}</p>;
  }
  if (event.status === 'failed') {
    return <p className="bubble-status is-failed">{COPY.thread.failed}</p>;
  }
  return (
    <p className="bubble-status is-done">
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {event.mine ? 'Sent' : 'Received'}
    </p>
  );
}

function caption(event: ThreadEvent): string {
  if (event.kind === 'expense') {
    return event.mine ? `You ${COPY.group.paid}` : `@${event.from} ${COPY.group.paid}`;
  }
  if (event.kind === 'request') {
    return event.mine ? COPY.thread.youAsked : `@${event.from} ${COPY.thread.asksYou}`;
  }
  if (event.gift && event.mine) return COPY.gift.youSent;
  return event.mine ? COPY.thread.youSent : COPY.thread.youReceived;
}

function requestStatusLabel(status: ThreadEvent['status']): string {
  if (status === 'paid') return COPY.thread.paid;
  if (status === 'declined') return COPY.thread.declined;
  return COPY.thread.cancelled;
}

function shortTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function DayDivider({ at }: { at: number }) {
  return <div className="day-divider"><span>{dayLabel(at)}</span></div>;
}

export function dayLabel(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return COPY.thread.today;
  if (same(date, yesterday)) return COPY.thread.yesterday;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
