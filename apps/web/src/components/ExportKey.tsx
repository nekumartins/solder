import { useEffect, useState } from 'react';
import { COPY } from '@solder/shared';
import { Button } from './Button.js';
import { PinSheet } from './PinSheet.js';
import { Sheet } from './Sheet.js';
import { reauthenticate } from '../lib/auth.js';
import { haptic } from '../lib/haptics.js';
import { store } from '../lib/store.js';
import { usePinPrompt } from '../lib/usePinPrompt.js';
import { privateKeyHex } from '../lib/vault.js';
import { wallet } from '../lib/wallet.js';
import { friendly } from '../screens/Welcome.js';

/**
 * Letting someone leave with their key.
 *
 * Self-custody that you cannot exercise is just a nicer word for custody, so
 * this exists — but it is the one door in the app worth making deliberately
 * awkward: a warning first, a fresh face or fingerprint check even if the app
 * is already unlocked, and the key blurred until it is asked for a second time.
 *
 * The key is derived and shown entirely on this device. Nothing here talks to
 * the server.
 */
export function ExportKey({ open, onClose, accountKey, isDemoLedger }: {
  open: boolean;
  onClose: () => void;
  accountKey: string | null;
  isDemoLedger: boolean;
}) {
  const [key, setKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const pin = usePinPrompt();

  // Never leave the key sitting in memory behind a closed sheet.
  useEffect(() => {
    if (!open) { setKey(null); setVisible(false); }
  }, [open]);

  const reveal = async (): Promise<void> => {
    setBusy(true);
    try {
      await reauthenticate(pin.request);
      setKey(privateKeyHex(wallet.seedForDerivation()));
      haptic('tap');
    } catch (error) {
      store.toast(friendly(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      store.toast(COPY.export.copied);
    } catch {
      store.toast('Select the key and copy it by hand', 'bad');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={COPY.export.title}>
      {key === null ? (
        <>
          <p className="export-warning">{COPY.export.warning}</p>
          <p className="sheet-body">{COPY.export.neverShare}</p>
          <Button size="lg" variant="danger" busy={busy} onClick={reveal}>
            {COPY.export.confirm}
          </Button>
        </>
      ) : (
        <>
          <div className="export-field">
            <span className="export-label">{COPY.export.addressLabel}</span>
            <code className="export-value mono">{accountKey}</code>
          </div>

          <div className="export-field">
            <span className="export-label">{COPY.export.keyLabel}</span>
            <button
              className={`export-value export-secret mono ${visible ? 'is-visible' : ''}`}
              onClick={() => { haptic('tap'); setVisible(true); }}
              aria-label={visible ? COPY.export.keyLabel : COPY.export.tapToReveal}
            >
              {visible ? key : <span className="export-cover">{COPY.export.tapToReveal}</span>}
            </button>
          </div>

          <p className="sheet-body">
            {isDemoLedger ? COPY.export.simNote : COPY.export.importHint}
          </p>

          <div className="export-actions">
            <Button variant="secondary" onClick={copy}>{COPY.export.copy}</Button>
            <Button onClick={onClose}>{COPY.export.done}</Button>
          </div>
        </>
      )}

      <PinSheet open={pin.open} reason={pin.reason} onSubmit={pin.submit} onCancel={pin.cancel} />
    </Sheet>
  );
}
