import type { MeResponse, StreamEvent, ThreadEvent, ThreadSummary } from '@solder/shared';
export type Phase = 'loading' | 'signed-out' | 'ready';
export interface AppState {
    phase: Phase;
    me: MeResponse | null;
    threads: ThreadSummary[];
    online: boolean;
    toast: {
        text: string;
        tone: 'good' | 'bad';
    } | null;
}
export declare function useApp<T>(selector: (state: AppState) => T): T;
export declare const store: {
    readonly state: AppState;
    load(): Promise<void>;
    refreshMe(): Promise<void>;
    refreshThreads(): Promise<void>;
    signedIn(): void;
    signedOut(): void;
    setOnline(online: boolean): void;
    toast(text: string, tone?: "good" | "bad"): void;
    /** Applies a live update: balance, thread list, and any open conversation. */
    apply(event: StreamEvent): void;
    onStream(listener: (event: StreamEvent) => void): () => void;
    /** Optimistically drop an event into the visible thread list ordering. */
    mergeEvent(events: ThreadEvent[], incoming: ThreadEvent): ThreadEvent[];
};
//# sourceMappingURL=store.d.ts.map