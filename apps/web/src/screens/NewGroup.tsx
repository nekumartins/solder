import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COPY, type PublicUser } from '@solder/shared';
import { Avatar } from '../components/Avatar.js';
import { Button } from '../components/Button.js';
import { Screen } from '../components/Screen.js';
import { api } from '../lib/api.js';
import { haptic } from '../lib/haptics.js';
import { peopleFrom } from '../lib/people.js';
import { store, useApp } from '../lib/store.js';
import { friendly } from './Welcome.js';

const GROUP_EMOJI = ['🗼', '🏠', '🍽️', '🏖️', '🎿', '🎉', '🚐', '⚽'];

export function NewGroup() {
  const navigate = useNavigate();
  const threads = useApp((state) => state.threads);
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState<string>('🗼');
  const [chosen, setChosen] = useState<string[]>([]);
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setPeople(peopleFrom(threads)); }, [threads]);

  const ready = title.trim().length > 1 && chosen.length > 0;

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const group = await api.post<{ threadId: string }>('/api/groups', {
        title: title.trim(), emoji, handles: chosen,
      });
      haptic('success');
      await store.refreshThreads();
      navigate(`/t/${group.threadId}`, { replace: true });
    } catch (error) {
      store.toast(friendly(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={COPY.group.newTitle} back="/">
      <div className="group-identity">
        <span className="avatar group-avatar avatar-xl" aria-hidden="true">{emoji}</span>
        <div className="emoji-row" role="group" aria-label="Pick an icon">
          {GROUP_EMOJI.map((option) => (
            <button
              key={option}
              className={`emoji-pick ${emoji === option ? 'is-on' : ''}`}
              aria-pressed={emoji === option}
              onClick={() => { haptic('tap'); setEmoji(option); }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span className="field-label">Name</span>
        <input
          className="field-input"
          value={title}
          placeholder={COPY.group.namePlaceholder}
          onChange={(event) => setTitle(event.target.value.slice(0, 40))}
        />
      </label>

      <p className="list-label">{COPY.group.who}</p>
      {people.length === 0 ? (
        <div className="empty"><p className="empty-sub">Pay someone first, then you can start a group with them.</p></div>
      ) : (
        <ul className="chip-people">
          {people.map((person) => {
            const on = chosen.includes(person.handle);
            return (
              <li key={person.handle}>
                <button
                  className={`person-chip ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    haptic('tap');
                    setChosen((current) => current.includes(person.handle)
                      ? current.filter((item) => item !== person.handle)
                      : [...current, person.handle]);
                  }}
                >
                  <Avatar handle={person.handle} displayName={person.displayName} size={28} />
                  {person.displayName.split(' ')[0]}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button size="lg" disabled={!ready || busy} busy={busy} onClick={create}>
        {COPY.group.create}
      </Button>
    </Screen>
  );
}
