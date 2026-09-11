import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { COPY, normalizeHandle } from '@solder/shared';
import { Button } from '../components/Button.js';
import { Screen } from '../components/Screen.js';
import { haptic } from '../lib/haptics.js';
import { store } from '../lib/store.js';

export function Scan() {
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'unsupported' | 'denied'>('starting');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    let frame = 0;

    const start = async (): Promise<void> => {
      const Detector = (window as { BarcodeDetector?: any }).BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia) return setState('unsupported');

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }, audio: false,
        });
      } catch {
        return setState('denied');
      }
      if (cancelled || !video.current) return;

      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      setState('scanning');

      const detector = new Detector({ formats: ['qr_code'] });
      const tick = async (): Promise<void> => {
        if (cancelled || !video.current) return;
        try {
          const codes = await detector.detect(video.current);
          if (codes.length > 0) {
            haptic('success');
            open(codes[0].rawValue as string);
            return;
          }
        } catch {
          // Detection hiccups are common between frames; just try the next one.
        }
        frame = requestAnimationFrame(() => void tick());
      };
      void tick();
    };

    const open = (value: string): void => {
      const handle = handleFrom(value);
      if (!handle) return store.toast('That code is not a Solder code', 'bad');
      navigate(`/${handle}`);
    };

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [navigate]);

  return (
    <Screen title={COPY.scan.title} back="/" className="scan">
      {state === 'scanning' || state === 'starting' ? (
        <div className="scan-frame">
          <video ref={video} playsInline muted className="scan-video" />
          <span className="scan-reticle" aria-hidden="true" />
          <p className="scan-hint">{COPY.scan.hint}</p>
        </div>
      ) : (
        <div className="scan-fallback">
          <p className="empty-sub">{COPY.scan.unsupported}</p>
          <input
            className="field-input scan-input"
            value={typed}
            placeholder="@ana"
            aria-label={COPY.scan.pasteInstead}
            onChange={(event) => setTyped(event.target.value)}
          />
          <Button
            size="lg"
            disabled={!handleFrom(typed)}
            onClick={() => navigate(`/${handleFrom(typed)}`)}
          >
            Continue
          </Button>
        </div>
      )}
    </Screen>
  );
}

/** Accepts "@ana", "ana", or any solder link pointing at a person. */
function handleFrom(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/^https?:\/\/[^/]+\/@?([a-zA-Z0-9_]+)/);
  const handle = normalizeHandle(fromUrl ? fromUrl[1]! : trimmed);
  return /^[a-z][a-z0-9_]{2,19}$/.test(handle) ? handle : null;
}
