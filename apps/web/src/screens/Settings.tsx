import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COPY } from '@solder/shared';
import { Button } from '../components/Button.js';
import { Screen } from '../components/Screen.js';
import { signOut } from '../lib/auth.js';
import { store, useApp } from '../lib/store.js';
import { useInstallPrompt } from '../lib/useInstallPrompt.js';

/**
 * The one place technical detail is allowed to exist. Everything here is
 * optional reading — the app works without ever opening it.
 */
export function Settings() {
  const navigate = useNavigate();
  const me = useApp((state) => state.me);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const install = useInstallPrompt();

  const leave = async (): Promise<void> => {
    await signOut();
    store.signedOut();
    navigate('/welcome', { replace: true });
  };

  const copyKey = async (): Promise<void> => {
    if (!me?.user.accountKey) return;
    await navigator.clipboard.writeText(me.user.accountKey);
    store.toast('Copied');
  };

  return (
    <Screen title={COPY.settings.title} back="/me">
      <section className="rows">
        <p className="list-label">{COPY.settings.account}</p>
        <div className="row-item">
          <span>Name</span>
          <span className="row-value">{me?.user.displayName}</span>
        </div>
        <div className="row-item">
          <span>Your link</span>
          <span className="row-value">/@{me?.user.handle}</span>
        </div>
      </section>

      {install.available && (
        <section className="install-card">
          <p className="install-title">{COPY.settings.installTitle}</p>
          <p className="install-body">
            {install.ios ? COPY.settings.iosInstall : COPY.settings.installBody}
          </p>
          {!install.ios && (
            <Button variant="secondary" onClick={install.prompt}>{COPY.settings.install}</Button>
          )}
        </section>
      )}

      <section className="rows">
        <button className="row-item row-button" onClick={() => setShowAdvanced((on) => !on)}>
          <span>{COPY.settings.advanced}</span>
          <span className={`chevron ${showAdvanced ? 'is-open' : ''}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>

        {showAdvanced && (
          <div className="advanced">
            <p className="advanced-note">{COPY.settings.advancedNote}</p>
            <div className="row-item">
              <span>{COPY.settings.network}</span>
              <span className="row-value">{networkLabel(me?.chain)}</span>
            </div>
            <button className="row-item row-button" onClick={copyKey}>
              <span>{COPY.settings.accountKey}</span>
              <span className="row-value mono">{short(me?.user.accountKey)}</span>
            </button>
            <p className="advanced-note">
              Your money lives in an Ethereum account this app set up for you. Nobody, including
              this app’s servers, can move it without your face or fingerprint.
            </p>
          </div>
        )}
      </section>

      <Button size="lg" variant="danger" onClick={leave}>{COPY.settings.signOut}</Button>
    </Screen>
  );
}

function networkLabel(chain?: string): string {
  if (chain === 'ethereum') return 'Ethereum';
  if (chain === 'base') return 'Base';
  if (chain === 'sepolia') return 'Ethereum (test network)';
  if (chain === 'base-sepolia') return 'Base (test network)';
  return 'Local demo ledger';
}

function short(key?: string | null): string {
  if (!key) return '—';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
