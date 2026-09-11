import { Link, NavLink, useLocation } from 'react-router-dom';
import { COPY, formatUsd } from '@solder/shared';
import { Avatar } from './Avatar.js';
import { ThreadAvatar, threadHref, threadTitle } from './ThreadIdentity.js';
import { useApp } from '../lib/store.js';

/**
 * Desktop only. A phone shows one thing at a time; a wide screen can show the
 * list and the conversation at once, which is what people expect from a
 * messaging app on a laptop.
 */
export function Sidebar() {
  const me = useApp((state) => state.me);
  const threads = useApp((state) => state.threads);
  const { pathname } = useLocation();

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <Link to="/me" className="sidebar-me" aria-label="Your profile">
          <Avatar handle={me?.user.handle ?? 'you'} displayName={me?.user.displayName} size={36} />
          <span className="sidebar-me-text">
            <span className="sidebar-name">{me?.user.displayName}</span>
            <span className="sidebar-handle">@{me?.user.handle}</span>
          </span>
        </Link>
      </header>

      <Link to="/" className="sidebar-balance">
        <span className="sidebar-balance-label">{COPY.home.balanceLabel}</span>
        <span className="sidebar-balance-amount num">
          {formatUsd(BigInt(me?.balanceMicros ?? '0'))}
        </span>
      </Link>

      <nav className="sidebar-actions" aria-label="Quick actions">
        <NavLink to="/people?intent=pay" className="sidebar-action">{COPY.home.send}</NavLink>
        <NavLink to="/people?intent=request" className="sidebar-action">{COPY.home.request}</NavLink>
        <NavLink to="/groups/new" className="sidebar-action">{COPY.home.groups}</NavLink>
      </nav>

      <p className="list-label sidebar-label">Conversations</p>
      <ul className="sidebar-threads">
        {threads.map((thread) => {
          const href = threadHref(thread);
          return (
            <li key={thread.id}>
              <Link
                to={href}
                className={`sidebar-thread ${pathname === href ? 'is-active' : ''}`}
              >
                <ThreadAvatar thread={thread} size={34} />
                <span className="sidebar-thread-main">
                  <span className="sidebar-thread-name">{threadTitle(thread)}</span>
                  <span className="sidebar-thread-preview">
                    {thread.lastEvent?.body ?? thread.lastEvent?.note ?? ''}
                  </span>
                </span>
                {thread.unread > 0 && <span className="unread" aria-label={`${thread.unread} new`} />}
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
