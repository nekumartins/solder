import type { StreamEvent } from '@solder/shared';
import { store } from './store.js';

/**
 * One SSE connection per signed-in tab, with backoff so a flaky network does
 * not hammer the server.
 */
let source: EventSource | null = null;
let retry = 0;
let timer: number | undefined;

export function connectStream(): void {
  if (source) return;

  source = new EventSource('/api/stream', { withCredentials: true });

  source.onmessage = (message) => {
    retry = 0;
    store.setOnline(true);
    try {
      store.apply(JSON.parse(message.data) as StreamEvent);
    } catch {
      // A malformed frame is not worth tearing the connection down for.
    }
  };

  source.onerror = () => {
    source?.close();
    source = null;
    store.setOnline(false);
    const delay = Math.min(1000 * 2 ** retry++, 30_000);
    window.clearTimeout(timer);
    timer = window.setTimeout(connectStream, delay);
  };
}

export function disconnectStream(): void {
  window.clearTimeout(timer);
  source?.close();
  source = null;
  retry = 0;
}
