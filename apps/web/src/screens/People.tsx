import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { COPY, type PublicUser } from '@solder/shared';
import { Avatar } from '../components/Avatar.js';
import { Screen } from '../components/Screen.js';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.js';

export function People() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const intent = params.get('intent') === 'request' ? 'request' : 'pay';
  const threads = useApp((state) => state.threads);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[] | null>(null);

  useEffect(() => {
    if (query.trim().length === 0) { setResults(null); return; }
    const timer = setTimeout(async () => {
      try {
        const found = await api.get<{ results: PublicUser[] }>(
          `/api/users/search?q=${encodeURIComponent(query.trim())}`);
        setResults(found.results);
      } catch {
        setResults([]);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const recents = threads.map((thread) => thread.peer);
  const list = results ?? recents;

  return (
    <Screen title={COPY.people.title} back="/">
      <div className="search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M16 16l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          className="search-input"
          value={query}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={COPY.people.search}
          aria-label={COPY.people.search}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {results === null && recents.length > 0 && (
        <p className="list-label">{COPY.people.recents}</p>
      )}

      {list.length === 0 ? (
        <div className="empty"><p className="empty-sub">{COPY.people.noResults}</p></div>
      ) : (
        <ul className="people-list">
          {list.map((person) => (
            <li key={person.handle}>
              <button
                className="person-row"
                onClick={() => navigate(`/${intent}/${person.handle}`)}
              >
                <Avatar handle={person.handle} displayName={person.displayName} size={44} />
                <span className="person-main">
                  <span className="person-name">{person.displayName}</span>
                  <span className="person-handle">@{person.handle}</span>
                </span>
                <span className="person-go" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
