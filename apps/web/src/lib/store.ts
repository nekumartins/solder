import { useSyncExternalStore } from 'react';
import type { MeResponse, StreamEvent, ThreadEvent, ThreadSummary } from '@solder/shared';
import { api, ApiError } from './api.js';

export type Phase = 'loading' | 'signed-out' | 'ready';

/**
 * "Offline" and "the server is not answering" look the same to a naive check
 * and need completely different words, so they are tracked apart.
 */
export type Connection = 'ok' | 'offline' | 'unreachable';

export interface AppState {
  phase: Phase;
  me: MeResponse | null;
  threads: ThreadSummary[];
  connection: Connection;
  toast: { text: string; tone: 'good' | 'bad' } | null;
}

let state: AppState = {
  phase: 'loading',
  me: null,
  threads: [],
  connection: typeof navigator === 'undefined' || navigator.onLine ? 'ok' : 'offline',
  toast: null,
};

/** Only claim someone is offline when the browser says they are. */
function connectionFor(error: unknown): Connection {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  if (error instanceof ApiError && error.code === 'offline') return 'offline';
  return 'unreachable';
}

const listeners = new Set<() => void>();
const threadListeners = new Set<(event: StreamEvent) => void>();

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function useApp<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => selector(state),
    () => selector(state),
  );
}

export const store = {
  get state(): AppState { return state; },

  async load(): Promise<void> {
    try {
      const me = await api.get<MeResponse>('/api/me');
      set({ me, phase: 'ready' });
      await store.refreshThreads();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return set({ phase: 'signed-out' });
      set({ phase: state.me ? 'ready' : 'signed-out', connection: connectionFor(error) });
    }
  },

  async refreshMe(): Promise<void> {
    try {
      set({ me: await api.get<MeResponse>('/api/me'), connection: 'ok' });
    } catch (error) {
      set({ connection: connectionFor(error) });
    }
  },

  async refreshThreads(): Promise<void> {
    try {
      const { threads } = await api.get<{ threads: ThreadSummary[] }>('/api/threads');
      set({ threads, connection: 'ok' });
    } catch (error) {
      set({ connection: connectionFor(error) });
    }
  },

  signedIn(): void {
    set({ phase: 'ready' });
  },

  signedOut(): void {
    set({ phase: 'signed-out', me: null, threads: [] });
  },

  setConnection(connection: Connection): void {
    set({ connection });
  },

  toast(text: string, tone: 'good' | 'bad' = 'good'): void {
    set({ toast: { text, tone } });
    setTimeout(() => {
      if (state.toast?.text === text) set({ toast: null });
    }, 2600);
  },

  /** Applies a live update: balance, thread list, and any open conversation. */
  apply(event: StreamEvent): void {
    if (event.type === 'balance.updated' && state.me) {
      set({ me: { ...state.me, balanceMicros: event.balanceMicros } });
    }
    if (event.type === 'event.new' || event.type === 'event.updated') {
      void store.refreshThreads();
    }
    for (const listener of threadListeners) listener(event);
  },

  onStream(listener: (event: StreamEvent) => void): () => void {
    threadListeners.add(listener);
    return () => threadListeners.delete(listener);
  },

  /** Optimistically drop an event into the visible thread list ordering. */
  mergeEvent(events: ThreadEvent[], incoming: ThreadEvent): ThreadEvent[] {
    const index = events.findIndex((event) => event.id === incoming.id);
    if (index === -1) return [...events, incoming];
    const next = [...events];
    next[index] = incoming;
    return next;
  },
};
