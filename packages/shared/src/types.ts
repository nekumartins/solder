/**
 * DTOs shared by the API and the web app.
 * Money fields are decimal strings of micro-USDC — parse with BigInt().
 */

export type EventKind = 'payment' | 'request' | 'note' | 'system' | 'expense';
export type PaymentStatus = 'pending' | 'confirmed' | 'failed';
export type RequestStatus = 'open' | 'paid' | 'declined' | 'cancelled';
export type ChainKind = 'sim' | 'ethereum' | 'sepolia' | 'base' | 'base-sepolia';

export interface PublicUser {
  handle: string;
  displayName: string;
}

export interface Me extends PublicUser {
  id: string;
  /** The account's Ethereum address. Only ever surfaced under Settings -> Advanced. */
  accountKey: string | null;
  createdAt: number;
}

export interface MeResponse {
  user: Me;
  balanceMicros: string;
  dailyRemainingMicros: string;
  chain: ChainKind;
  /** True when this build allows the dev-only shortcut sign-in. */
  devLogin: boolean;
  /** True on the local demo ledger, where money can be topped up on request. */
  canFund: boolean;
}

export interface Reaction {
  emoji: string;
  handle: string;
  mine: boolean;
}

export interface SplitProgress {
  splitId: string;
  totalMicros: string;
  paidCount: number;
  participantCount: number;
  participants: Array<{ handle: string; displayName: string; shareMicros: string; status: RequestStatus }>;
}

export interface GroupMemberBalance {
  handle: string;
  displayName: string;
  /** What they have put in. */
  paidMicros: string;
  /** Positive when the group owes them, negative when they owe the group. */
  netMicros: string;
}

export interface GroupSummary {
  totalMicros: string;
  perPersonMicros: string;
  members: GroupMemberBalance[];
  /** The shortest set of payments that squares everyone up. */
  settlements: Array<{ from: string; to: string; micros: string }>;
  /** What the signed-in person should do about it, if anything. */
  youOwe: Array<{ handle: string; displayName: string; micros: string }>;
  youAreOwed: Array<{ handle: string; displayName: string; micros: string }>;
}

export interface ClaimSummary {
  id: string;
  from: PublicUser;
  amountMicros: string;
  note: string | null;
  emoji: string | null;
  status: 'funding' | 'open' | 'settling' | 'claimed' | 'reclaimed';
  createdAt: number;
  /** Only returned to the sender, for rebuilding the holding account's key. */
  derivationRef?: string | null;
}

export interface ThreadEvent {
  id: string;
  threadId: string;
  kind: EventKind;
  /** Handle of the sender. */
  from: string;
  /** Handle of the recipient. */
  to: string;
  /** True when the signed-in user sent this. */
  mine: boolean;
  amountMicros: string | null;
  note: string | null;
  emoji: string | null;
  body: string | null;
  status: PaymentStatus | RequestStatus | null;
  /** Chain reference. Never shown in the main UI. */
  reference: string | null;
  createdAt: number;
  confirmedAt: number | null;
  reactions: Reaction[];
  split: SplitProgress | null;
  /** A surprise: the amount is withheld from the recipient until they open it. */
  gift: boolean;
  revealed: boolean;
}

export type ThreadKind = 'direct' | 'group';

export interface ThreadSummary {
  id: string;
  kind: ThreadKind;
  /** Set for a one-to-one conversation. */
  peer: PublicUser | null;
  /** Set for a group. */
  title: string | null;
  emoji: string | null;
  members: PublicUser[];
  lastEvent: ThreadEvent | null;
  unread: number;
  updatedAt: number;
}

export interface ThreadPage {
  threadId: string;
  kind: ThreadKind;
  peer: PublicUser | null;
  title: string | null;
  emoji: string | null;
  members: PublicUser[];
  events: ThreadEvent[];
  hasMore: boolean;
  group: GroupSummary | null;
}

export interface PreparedPayment {
  paymentId: string;
  eventId: string;
  /** Opaque bytes the client signs. Never interpreted client-side. */
  messageB64: string;
  expiresAt: number;
}

export interface SubmittedPayment {
  event: ThreadEvent;
  balanceMicros: string;
}

export type StreamEvent =
  | { type: 'event.new'; event: ThreadEvent; threadId: string }
  | { type: 'event.updated'; event: ThreadEvent; threadId: string }
  | { type: 'balance.updated'; balanceMicros: string }
  | { type: 'hello'; at: number };

export interface ApiErrorBody {
  error: { code: string; message: string };
}
