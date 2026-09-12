import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COPY, formatUsd, parseAmount, splitShares, tryParseAmount, type PublicUser } from '@solder/shared';
import { Avatar } from '../components/Avatar.js';
import { AmountDisplay, Keypad } from '../components/Keypad.js';
import { Button } from '../components/Button.js';
import { Screen } from '../components/Screen.js';
import { api } from '../lib/api.js';
import { peopleFrom } from '../lib/people.js';
import { haptic } from '../lib/haptics.js';
import { store, useApp } from '../lib/store.js';
import { friendly } from './Welcome.js';

export function Split() {
  const navigate = useNavigate();
  const threads = useApp((state) => state.threads);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setPeople(peopleFrom(threads)); }, [threads]);

  const total = tryParseAmount(amount || '0') ?? 0n;
  const ways = chosen.length + 1;
  const shares = total > 0n ? splitShares(total, ways) : [];
  const ready = total > 0n && chosen.length > 0;

  const toggle = (handle: string): void => {
    haptic('tap');
    setChosen((current) => current.includes(handle)
      ? current.filter((item) => item !== handle)
      : [...current, handle]);
  };

  const ask = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post('/api/splits', {
        totalMicros: parseAmount(amount).toString(),
        handles: chosen,
        note: note.trim() || null,
      });
      haptic('success');
      store.toast(`Asked ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}`);
      await store.refreshThreads();
      navigate('/', { replace: true });
    } catch (error) {
      store.toast(friendly(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={COPY.split.title}
      back="/"
      className="split"
      foot={(
        <Button size="lg" disabled={!ready || busy} busy={busy} onClick={ask}>
          {COPY.split.send}
        </Button>
      )}
    >
      <AmountDisplay
        value={amount}
        hint={ready
          ? `${formatUsd(shares[1] ?? 0n)} ${COPY.split.each} · ${ways} people`
          : COPY.split.total}
      />

      <input
        className="note-input note-input-wide"
        value={note}
        placeholder="What was it for?"
        aria-label="What was it for?"
        onChange={(event) => setNote(event.target.value.slice(0, 140))}
      />

      <p className="list-label">{COPY.split.withWhom}</p>
      {people.length === 0 ? (
        <div className="empty"><p className="empty-sub">Pay someone first, then you can split with them.</p></div>
      ) : (
        <ul className="chip-people">
          {people.map((person) => {
            const on = chosen.includes(person.handle);
            return (
              <li key={person.handle}>
                <button
                  className={`person-chip ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggle(person.handle)}
                >
                  <Avatar handle={person.handle} displayName={person.displayName} size={28} />
                  {person.displayName.split(' ')[0]}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Keypad value={amount} onChange={setAmount} />
    </Screen>
  );
}
