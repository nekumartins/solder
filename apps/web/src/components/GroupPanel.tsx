import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COPY, formatUsd, parseAmount, tryParseAmount, type GroupSummary } from '@solder/shared';
import { Avatar } from './Avatar.js';
import { Button } from './Button.js';
import { Sheet } from './Sheet.js';
import { api } from '../lib/api.js';
import { haptic } from '../lib/haptics.js';
import { store } from '../lib/store.js';
import { friendly } from '../screens/Welcome.js';

/**
 * Who has put in what, and the shortest way to square up. This is what makes a
 * group different from a conversation with more people in it.
 */
export function GroupPanel({ threadId, group, onChange }: {
  threadId: string; group: GroupSummary; onChange: () => void;
}) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const total = BigInt(group.totalMicros);
  const micros = tryParseAmount(amount || '0') ?? 0n;

  const addExpense = async (): Promise<void> => {
    if (micros <= 0n) return;
    setBusy(true);
    try {
      await api.post(`/api/groups/${threadId}/expenses`, {
        amountMicros: parseAmount(amount).toString(),
        note: note.trim() || null,
      });
      haptic('success');
      setAmount(''); setNote(''); setAdding(false);
      onChange();
    } catch (error) {
      store.toast(friendly(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        className={`group-bar ${open ? 'is-open' : ''}`}
        onClick={() => { haptic('tap'); setOpen((on) => !on); }}
        aria-expanded={open}
      >
        <span className="group-bar-main">
          {group.youOwe.length > 0 ? (
            <>
              <span className="group-bar-label">{COPY.group.youOwe}</span>
              <span className="group-bar-amount num is-out">
                {formatUsd(BigInt(group.youOwe[0]!.micros))} to {group.youOwe[0]!.displayName.split(' ')[0]}
              </span>
            </>
          ) : group.youAreOwed.length > 0 ? (
            <>
              <span className="group-bar-label">{COPY.group.youAreOwed}</span>
              <span className="group-bar-amount num is-in">
                {formatUsd(group.youAreOwed.reduce((sum, o) => sum + BigInt(o.micros), 0n))}
              </span>
            </>
          ) : (
            <>
              <span className="group-bar-label">{COPY.group.total}</span>
              <span className="group-bar-amount num">{formatUsd(total)}</span>
            </>
          )}
        </span>
        <span className={`chevron ${open ? 'is-open' : ''}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="group-detail">
          {total === 0n ? (
            <p className="group-empty">{COPY.group.emptySub}</p>
          ) : (
            <>
              <p className="group-total num">
                {formatUsd(total)} <span>· {formatUsd(BigInt(group.perPersonMicros))} {COPY.group.each}</span>
              </p>
              <ul className="group-members">
                {group.members.map((member) => {
                  const net = BigInt(member.netMicros);
                  return (
                    <li key={member.handle}>
                      <Avatar handle={member.handle} displayName={member.displayName} size={30} />
                      <span className="group-member-name">{member.displayName.split(' ')[0]}</span>
                      <span className="group-member-paid num">
                        {formatUsd(BigInt(member.paidMicros))} {COPY.group.paid}
                      </span>
                      <span className={`group-member-net num ${net > 0n ? 'is-in' : net < 0n ? 'is-out' : ''}`}>
                        {net === 0n ? '—' : formatUsd(net, { sign: 'always' })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="group-actions">
            <Button variant="secondary" onClick={() => setAdding(true)}>{COPY.group.addExpense}</Button>
            {group.youOwe.map((owed) => (
              <Button
                key={owed.handle}
                onClick={() => navigate(
                  `/pay/${owed.handle}?amount=${owed.micros}&thread=${threadId}`)}
              >
                {COPY.group.settle} · {formatUsd(BigInt(owed.micros))}
              </Button>
            ))}
            {group.settlements.length === 0 && total > 0n && (
              <span className="group-square">{COPY.group.settled}</span>
            )}
          </div>
        </div>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title={COPY.group.addExpense}>
        <input
          className="field-input"
          inputMode="decimal"
          value={amount}
          placeholder="0.00"
          aria-label="Amount"
          onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
        />
        <input
          className="field-input"
          value={note}
          placeholder={COPY.group.expensePlaceholder}
          aria-label={COPY.group.expensePlaceholder}
          onChange={(event) => setNote(event.target.value.slice(0, 140))}
        />
        <Button size="lg" disabled={micros <= 0n || busy} busy={busy} onClick={addExpense}>
          {COPY.group.addExpense}
        </Button>
      </Sheet>
    </>
  );
}
