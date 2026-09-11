import { formatAmountInput } from '@solder/shared';
import { haptic } from '../lib/haptics.js';

interface Props {
  value: string;
  onChange: (next: string) => void;
  max?: number;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/**
 * A purpose-built pad rather than the OS keyboard: bigger targets, no
 * accidental letters, and the amount stays the hero of the screen.
 */
export function Keypad({ value, onChange, max = 9 }: Props) {
  const press = (key: string): void => {
    haptic('tap');
    if (key === 'back') return onChange(value.slice(0, -1));
    if (key === '.') {
      if (value.includes('.')) return;
      return onChange(value === '' ? '0.' : `${value}.`);
    }
    const [, fraction] = value.split('.');
    if (fraction !== undefined && fraction.length >= 2) return;
    if (value.replace('.', '').length >= max) return;
    if (value === '0') return onChange(key);
    onChange(value + key);
  };

  return (
    <div className="keypad" role="group" aria-label="Amount keypad">
      {KEYS.map((key) => (
        <button
          key={key}
          className={`key ${key === 'back' ? 'key-back' : ''}`}
          onClick={() => press(key)}
          aria-label={key === 'back' ? 'Delete' : key}
        >
          {key === 'back' ? (
            <svg viewBox="0 0 24 24" width="25" height="25" aria-hidden="true">
              <path d="M9.5 5h9.5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9.5L3 12z" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M11.5 9.5l5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" />
            </svg>
          ) : key}
        </button>
      ))}
    </div>
  );
}

export function AmountDisplay({ value, hint }: { value: string; hint?: string }) {
  const display = formatAmountInput(value);
  return (
    <div className="amount-display">
      <div className={`amount num ${value === '' ? 'is-empty' : ''}`}>
        <span className="amount-sign">$</span>
        {display}
      </div>
      {hint ? <p className="amount-hint">{hint}</p> : null}
    </div>
  );
}
