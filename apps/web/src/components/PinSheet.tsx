import { useState } from 'react';
import { Button } from './Button.js';
import { Sheet } from './Sheet.js';

interface Props {
  open: boolean;
  reason: 'create' | 'unlock';
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

/**
 * Only shown on devices whose passkeys cannot derive a key on their own.
 * Still no phrase to write down — just six digits.
 */
export function PinSheet({ open, reason, onSubmit, onCancel }: Props) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const creating = reason === 'create';
  const ready = pin.length === 6 && (!creating || confirmPin === pin);

  return (
    <Sheet open={open} onClose={onCancel} title={creating ? 'Choose a 6-digit code' : 'Enter your code'}>
      <p className="sheet-body">
        {creating
          ? 'This device needs a short code to protect your money. You will need it to sign in somewhere new.'
          : 'Enter the 6-digit code you chose when you set up this account.'}
      </p>
      <input
        className="pin-input num"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        placeholder="••••••"
        aria-label="6-digit code"
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      {creating && (
        <input
          className="pin-input num"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          placeholder="Repeat"
          aria-label="Repeat code"
          value={confirmPin}
          onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      )}
      <Button size="lg" disabled={!ready} onClick={() => ready && onSubmit(pin)}>
        Continue
      </Button>
    </Sheet>
  );
}
