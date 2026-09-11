import { NavLink, useLocation } from 'react-router-dom';
import { haptic } from '../lib/haptics.js';

const TABS = [
  {
    to: '/', label: 'Home', exact: true,
    icon: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z',
  },
  {
    to: '/people', label: 'Send',
    icon: 'M4 12h13m0 0-5-5m5 5-5 5M20 5v14',
  },
  {
    to: '/scan', label: 'Scan',
    icon: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M7 12h10',
  },
  {
    to: '/me', label: 'You',
    icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0',
  },
];

export function TabBar() {
  const { pathname } = useLocation();
  // Conversations, payment flows and onboarding own their full height — a
  // conversation has its own composer where the tab bar would sit.
  const hidden = ['/pay', '/request', '/welcome', '/claim', '/split', '/t/', '/link', '/c/', '/groups/new'].some((prefix) =>
    pathname.startsWith(prefix));
  if (hidden) return null;

  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.exact}
          className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}
          onClick={() => haptic('tap')}
        >
          <svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true">
            <path d={tab.icon} fill="none" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
