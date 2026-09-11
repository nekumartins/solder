/**
 * DTOs shared by the API and the web app.
 * Money fields are decimal strings of micro-USDC — parse with BigInt().
 */

export type EventKind = 'payment' | 'request' | 'note' | 'system';
export type PaymentStatus = 'pending' | 'confirmed' | 'failed';
export type RequestStatus = 'open' | 'paid' | 'declined' | 'cancelled';
export type ChainKind = 'sim' | 'devnet' | 'mainnet';

export interface PublicUser {
  handle: string;
  displayName: string;
}

export interface Me extends PublicUser {
  id: string;
  /** Base58 account key. Only ever surfaced under Settings -> Advanced. */
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
}

export interface ThreadSummary {
  id: string;
  peer: PublicUser;
  lastEvent: ThreadEvent | null;
  unread: number;
  updatedAt: number;
}

export interface ThreadPage {
  peer: PublicUser;
  events: ThreadEvent[];
  hasMore: boolean;
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
