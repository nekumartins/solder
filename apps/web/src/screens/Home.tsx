import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { COPY, formatUsd, type ThreadSummary } from '@solder/shared';
import { Avatar } from '../components/Avatar.js';
import { api } from '../lib/api.js';
import { store, useApp } from '../lib/store.js';
import { dayLabel } from '../components/EventBubble.js';

export function Home() {
  const navigate = useNavigate();
  const me = useApp((state) => state.me);
  const threads = useApp((state) => state.threads);

  useEffect(() => { void store.refreshThreads(); }, []);

  const balance = BigInt(me?.balanceMicros ?? '0');

  const addMoney = async (): Promise<void> => {
    try {
      await api.post('/api/dev/fund', { micros: '25000000' });
      await store.refreshMe();
      store.toast('Added $25.00 of demo money');
    } catch {
      store.toast(COPY.errors.generic, 'bad');
    }
  };

  return (
    <div className="screen home">
      <header className="home-head">
        <div>
          <p className="home-greeting">{greeting()}</p>
          <p className="home-name">{me?.user.displayName ?? ''}</p>
        </div>
        <Link to="/me" aria-label="Your profile">
          <Avatar handle={me?.user.handle ?? 'you'} displayName={me?.user.displayName} size={40} />
        </Link>
      </header>

      <div className="scroll home-body">
        <section className="balance-card">
          <p className="balance-label">{COPY.home.balanceLabel}</p>
          <p className="balance num">{formatUsd(balance)}</p>
          <p className="balance-sub">{COPY.home.balanceSub}</p>
          {me?.canFund && (
            <button className="chip chip-ghost balance-add" onClick={addMoney}>
              + {COPY.home.addMoney}
            </button>
          )}
        </section>

        <nav className="actions" aria-label="Quick actions">
          <button className="action" onClick={() => navigate('/people?intent=pay')}>
            <span className="action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path d="M12 19V5m0 0-6 6m6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {COPY.home.send}
          </button>
          <button className="action" onClick={() => navigate('/people?intent=request')}>
            <span className="action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path d="M12 5v14m0 0 6-6m-6 6-6-6" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {COPY.home.request}
          </button>
          <button className="action" onClick={() => navigate('/split')}>
            <span className="action-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.9" />
                <path d="M12 4v16" fill="none" stroke="currentColor" strokeWidth="1.9"
                  strokeLinecap="round" />
                <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" opacity="0.35" />
              </svg>
            </span>
            {COPY.home.split}
          </button>
        </nav>

        {threads.length === 0 ? (
          <div className="empty">
            <p className="empty-title">{COPY.home.empty}</p>
            <p className="empty-sub">{COPY.home.emptySub}</p>
          </div>
        ) : (
          <ul className="thread-list">
            {threads.map((thread) => <ThreadRow key={thread.id} thread={thread} />)}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThreadRow({ thread }: { thread: ThreadSummary }) {
  const event = thread.lastEvent;
  const amount = event?.amountMicros ? BigInt(event.amountMicros) : null;
  const incoming = event ? !event.mine : false;

  return (
    <li>
      <Link className="thread-row" to={`/t/${thread.peer.handle}`}>
        <Avatar handle={thread.peer.handle} displayName={thread.peer.displayName} size={46} />
        <span className="thread-main">
          <span className="thread-top">
            <span className="thread-name">{thread.peer.displayName}</span>
            <span className="thread-when">{event ? dayLabel(event.createdAt) : ''}</span>
          </span>
          <span className="thread-bottom">
            <span className="thread-preview">{preview(thread)}</span>
            {amount !== null && event?.kind === 'payment' && (
              <span className={`thread-amount num ${incoming ? 'is-in' : 'is-out'}`}>
                {incoming ? '+' : ''}{formatUsd(amount, { sign: 'never' })}
              </span>
            )}
          </span>
        </span>
        {thread.unread > 0 && <span className="unread" aria-label={`${thread.unread} new`} />}
      </Link>
    </li>
  );
}

function preview(thread: ThreadSummary): string {
  const event = thread.lastEvent;
  if (!event) return 'Say hello';
  if (event.kind === 'note') return event.body ?? '';
  if (event.kind === 'request') {
    const amount = formatUsd(BigInt(event.amountMicros ?? '0'));
    if (event.status === 'paid') return `${amount} · paid`;
    return event.mine ? `You asked for ${amount}` : `Asks for ${amount}`;
  }
  const note = event.note ? ` · ${event.note}` : '';
  const emoji = event.emoji ? `${event.emoji} ` : '';
  if (event.status === 'pending') return `${emoji}Sending…`;
  return `${emoji}${event.mine ? 'You sent' : 'Received'}${note}`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Late one';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
