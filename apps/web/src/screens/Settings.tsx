import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COPY } from '@solder/shared';
import { api } from '../lib/api.js';
import { Button } from '../components/Button.js';
import { ExportKey } from '../components/ExportKey.js';
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
  const [exporting, setExporting] = useState(false);
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

  const addDemoMoney = async (): Promise<void> => {
    try {
      await api.post('/api/dev/fund', { micros: '25000000' });
      await store.refreshMe();
      store.toast('Added $25.00 of demo money');
    } catch {
      store.toast(COPY.errors.generic, 'bad');
    }
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
            {me?.canFund && (
              <button className="row-item row-button" onClick={addDemoMoney}>
                <span>{COPY.settings.addDemoMoney}</span>
                <span className="row-value">+$25.00</span>
              </button>
            )}
            <button className="row-item row-button" onClick={copyKey}>
              <span>{COPY.settings.accountKey}</span>
              <span className="row-value mono">{short(me?.user.accountKey)}</span>
            </button>
            <button className="row-item row-button" onClick={() => setExporting(true)}>
              <span>{COPY.export.row}</span>
              <span className="row-value">
                <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                  <path d="M12 15V4m0 0L8 8m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"
                    fill="none" stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
            <p className="advanced-note">
              Your money lives in an Ethereum account this app set up for you. Nobody, including
              this app’s servers, can move it without your face or fingerprint — and it is yours
              to take with you.
            </p>
          </div>
        )}
      </section>

      <Button size="lg" variant="danger" onClick={leave}>{COPY.settings.signOut}</Button>

      <ExportKey
        open={exporting}
        onClose={() => setExporting(false)}
        accountKey={me?.user.accountKey ?? null}
        isDemoLedger={me?.chain === 'sim'}
      />
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
