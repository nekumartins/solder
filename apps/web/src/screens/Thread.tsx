import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { COPY, type GroupSummary, type PublicUser, type ThreadEvent, type ThreadPage } from '@solder/shared';
import { DayDivider, EventBubble } from '../components/EventBubble.js';
import { GroupPanel } from '../components/GroupPanel.js';
import { Screen } from '../components/Screen.js';
import { ThreadAvatar } from '../components/ThreadIdentity.js';
import { api } from '../lib/api.js';
import { haptic } from '../lib/haptics.js';
import { store } from '../lib/store.js';
import { friendly } from './Welcome.js';

export function Thread() {
  // A conversation is addressed by a handle, or by its id when it is a group.
  const { handle = '' } = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState<ThreadPage | null>(null);
  const [events, setEvents] = useState<ThreadEvent[]>([]);
  const [draft, setDraft] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const peer: PublicUser | null = page?.peer ?? null;
  const isGroup = page?.kind === 'group';

  const load = useCallback(async (): Promise<void> => {
    try {
      const fetched = await api.get<ThreadPage>(`/api/threads/${handle}`);
      setPage(fetched);
      setEvents(fetched.events);
      await api.post(`/api/threads/${handle}/read`);
      void store.refreshThreads();
    } catch (error) {
      store.toast(friendly(error), 'bad');
    }
  }, [handle]);

  useEffect(() => { void load(); }, [load]);

  // Live updates for this conversation only.
  useEffect(() => store.onStream((event) => {
    if (event.type !== 'event.new' && event.type !== 'event.updated') return;
    const mine = page ? event.threadId === page.threadId
      : event.event.from === handle || event.event.to === handle;
    if (!mine) return;
    setEvents((current) => store.mergeEvent(current, event.event));
    if (event.type === 'event.new' && isGroup) void load();
    void api.post(`/api/threads/${handle}/read`);
  }), [handle, page, isGroup, load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: events.length > 12 ? 'auto' : 'smooth' });
  }, [events.length]);

  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      const { event } = await api.post<{ event: ThreadEvent }>(
        `/api/threads/${handle}/messages`, { body });
      setEvents((current) => store.mergeEvent(current, event));
      haptic('tap');
    } catch (error) {
      setDraft(body);
      store.toast(friendly(error), 'bad');
    }
  };

  const act = async (path: string): Promise<void> => {
    try {
      const { event } = await api.post<{ event: ThreadEvent }>(path);
      setEvents((current) => store.mergeEvent(current, event));
      void store.refreshThreads();
    } catch (error) {
      store.toast(friendly(error), 'bad');
    }
  };

  return (
    <Screen
      bare
      back="/"
      lead={<ThreadAvatar
        thread={{ kind: page?.kind ?? 'direct', peer, title: page?.title ?? null, emoji: page?.emoji ?? null }}
        size={38}
      />}
      title={isGroup ? page?.title ?? 'Group' : peer?.displayName ?? `@${handle}`}
      subtitle={isGroup ? COPY.group.members(page?.members.length ?? 0) : `@${handle}`}
      action={!isGroup && (
        <button className="chip chip-pay" onClick={() => navigate(`/pay/${handle}`)}>
          {COPY.thread.sendMoney}
        </button>
      )}
    >
      {isGroup && page?.group && (
        <GroupPanel threadId={page.threadId} group={page.group as GroupSummary} onChange={load} />
      )}

      <div className="scroll thread-scroll">
        {events.length === 0 && (
          <div className="empty empty-thread">
            <ThreadAvatar
              thread={{ kind: page?.kind ?? 'direct', peer, title: page?.title ?? null, emoji: page?.emoji ?? null }}
              size={64}
            />
            <p className="empty-title">{isGroup ? page?.title : peer?.displayName ?? `@${handle}`}</p>
            <p className="empty-sub">
              {isGroup ? COPY.group.emptySub : 'Send the first message — or the first few dollars.'}
            </p>
          </div>
        )}

        {events.map((event, index) => (
          <div key={event.id}>
            {needsDivider(events, index) && <DayDivider at={event.createdAt} />}
            <EventBubble
              event={event}
              showSender={isGroup}
              onReveal={(target) => act(`/api/events/${target.id}/reveal`)}
              onPay={(target) => navigate(
                `/pay/${handle}?amount=${target.amountMicros}&request=${target.id}`)}
              onDecline={(target) => act(`/api/requests/${target.id}/decline`)}
              onCancel={(target) => act(`/api/requests/${target.id}/cancel`)}
              onReact={async (target, emoji) => {
                try {
                  const { event: updated } = await api.post<{ event: ThreadEvent }>(
                    `/api/events/${target.id}/reactions`, { emoji });
                  setEvents((current) => store.mergeEvent(current, updated));
                } catch (error) {
                  store.toast(friendly(error), 'bad');
                }
              }}
            />
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <div className="composer">
        <button
          className="composer-money"
          aria-label={isGroup ? COPY.group.addExpense : COPY.thread.requestMoney}
          onClick={() => navigate(isGroup ? `/people?intent=pay&thread=${handle}` : `/request/${handle}`)}
        >
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
            <path d="M12 5v14m0 0 6-6m-6 6-6-6" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <input
          className="composer-input"
          value={draft}
          placeholder={COPY.thread.placeholder}
          aria-label={COPY.thread.placeholder}
          onChange={(event) => setDraft(event.target.value.slice(0, 500))}
          onKeyDown={(event) => { if (event.key === 'Enter') void send(); }}
        />
        <button
          className="composer-send"
          aria-label="Send message"
          disabled={draft.trim() === ''}
          onClick={send}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M5 12h13m0 0-5-5m5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </Screen>
  );
}

function needsDivider(events: ThreadEvent[], index: number): boolean {
  if (index === 0) return true;
  const previous = new Date(events[index - 1]!.createdAt).toDateString();
  return previous !== new Date(events[index]!.createdAt).toDateString();
}
