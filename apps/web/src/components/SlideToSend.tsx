import { useEffect, useRef, useState } from 'react';
import { haptic } from '../lib/haptics.js';

interface Props {
  label: string;
  busyLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}

/**
 * A deliberate gesture for an irreversible action: you have to mean it.
 * Keyboard users get the same commitment via Enter or Space.
 */
export function SlideToSend({ label, busyLabel = 'Sending…', disabled, busy, onConfirm }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [armed, setArmed] = useState(false);
  const dragging = useRef(false);

  useEffect(() => { if (!busy) setOffset(0); }, [busy]);

  const travel = (): number => {
    const track = trackRef.current;
    if (!track) return 0;
    return Math.max(track.clientWidth - 62, 1);
  };

  const move = (clientX: number): void => {
    const track = trackRef.current;
    if (!track) return;
    const next = Math.min(Math.max(clientX - track.getBoundingClientRect().left - 31, 0), travel());
    setOffset(next);
    const nowArmed = next > travel() * 0.9;
    if (nowArmed && !armed) haptic('tap');
    setArmed(nowArmed);
  };

  const release = (): void => {
    if (!dragging.current) return;
    dragging.current = false;
    if (offset > travel() * 0.9) {
      haptic('success');
      onConfirm();
    } else {
      setOffset(0);
      setArmed(false);
    }
  };

  const pct = Math.round((offset / Math.max(travel(), 1)) * 100);

  return (
    <div
      ref={trackRef}
      className={`slider ${disabled ? 'is-disabled' : ''} ${busy ? 'is-busy' : ''} ${armed ? 'is-armed' : ''}`}
      role="button"
      tabIndex={disabled || busy ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || busy}
      aria-valuenow={pct}
      onKeyDown={(event) => {
        if (disabled || busy) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          haptic('success');
          onConfirm();
        }
      }}
      onPointerDown={(event) => {
        if (disabled || busy) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event.clientX);
      }}
      onPointerMove={(event) => { if (dragging.current) move(event.clientX); }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span className="slider-label">{busy ? busyLabel : label}</span>
      <span
        className="slider-knob"
        style={{ transform: `translateX(${busy ? travel() : offset}px)` }}
        aria-hidden="true"
      >
        {busy ? <span className="spinner" /> : (
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M5 12h13m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </div>
  );
}
