import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newId } from './ids.js';

/**
 * All SQL in the project lives in this file. Everything else talks to the
 * `Store` class.
 *
 * Money columns are TEXT holding a decimal micro-USDC value, so bigints
 * survive the round-trip without ever touching a float.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  pubkey TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL, counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT, prf_supported INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY, challenge TEXT NOT NULL, kind TEXT NOT NULL,
  handle TEXT, display_name TEXT, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS vaults (
  user_id TEXT PRIMARY KEY REFERENCES users(id), blob TEXT NOT NULL,
  alg TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, user_a TEXT NOT NULL, user_b TEXT NOT NULL,
  last_event_id TEXT, updated_at INTEGER NOT NULL,
  unread_a INTEGER NOT NULL DEFAULT 0, unread_b INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_a, user_b));
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
  kind TEXT NOT NULL, from_user TEXT NOT NULL, to_user TEXT NOT NULL,
  amount_micros TEXT, note TEXT, emoji TEXT, body TEXT,
  status TEXT, chain_signature TEXT, split_id TEXT, request_event_id TEXT,
  created_at INTEGER NOT NULL, confirmed_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_events_thread ON events(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_sender ON events(from_user, kind, created_at DESC);
CREATE TABLE IF NOT EXISTS reactions (
  event_id TEXT NOT NULL REFERENCES events(id), user_id TEXT NOT NULL,
  emoji TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(event_id, user_id));
CREATE TABLE IF NOT EXISTS splits (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, total_micros TEXT NOT NULL,
  note TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS split_participants (
  split_id TEXT NOT NULL REFERENCES splits(id), user_id TEXT NOT NULL,
  share_micros TEXT NOT NULL, request_event_id TEXT, status TEXT NOT NULL DEFAULT 'open',
  PRIMARY KEY(split_id, user_id));
CREATE TABLE IF NOT EXISTS prepared_payments (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, event_id TEXT NOT NULL,
  message_b64 TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sim_accounts (
  pubkey TEXT PRIMARY KEY, balance_micros TEXT NOT NULL DEFAULT '0');
CREATE TABLE IF NOT EXISTS sim_txs (
  signature TEXT PRIMARY KEY, ref TEXT UNIQUE, from_pubkey TEXT, to_pubkey TEXT,
  amount_micros TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, confirm_at INTEGER NOT NULL);
`;

export interface UserRow {
  id: string; handle: string; display_name: string; pubkey: string | null; created_at: number;
}
export interface CredentialRow {
  id: string; user_id: string; public_key: Uint8Array<ArrayBuffer>; counter: number;
  transports: string | null; prf_supported: number; created_at: number;
}
export interface ThreadRow {
  id: string; user_a: string; user_b: string; last_event_id: string | null;
  updated_at: number; unread_a: number; unread_b: number;
}
export interface EventRow {
  id: string; thread_id: string; kind: string; from_user: string; to_user: string;
  amount_micros: string | null; note: string | null; emoji: string | null; body: string | null;
  status: string | null; chain_signature: string | null; split_id: string | null;
  request_event_id: string | null; created_at: number; confirmed_at: number | null;
}
export interface ReactionRow {
  event_id: string; user_id: string; emoji: string; created_at: number;
}
export interface SplitRow {
  id: string; creator_id: string; total_micros: string; note: string | null; created_at: number;
}
export interface SplitParticipantRow {
  split_id: string; user_id: string; share_micros: string;
  request_event_id: string | null; status: string;
}
export interface PreparedRow {
  id: string; user_id: string; event_id: string; message_b64: string;
  expires_at: number; consumed: number;
}
export interface SimTxRow {
  signature: string; ref: string; from_pubkey: string; to_pubkey: string;
  amount_micros: string; status: string; created_at: number; confirm_at: number;
}

export class Store {
  readonly db: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  private q(sql: string): StatementSync {
    let stmt = this.cache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.cache.set(sql, stmt);
    }
    return stmt;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // ---- users ---------------------------------------------------------------

  createUser(handle: string, displayName: string): UserRow {
    const row: UserRow = {
      id: newId('usr'), handle, display_name: displayName, pubkey: null, created_at: Date.now(),
    };
    this.q('INSERT INTO users (id, handle, display_name, pubkey, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.handle, row.display_name, null, row.created_at);
    return row;
  }

  getUser(id: string): UserRow | null {
    return (this.q('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
  }

  getUserByHandle(handle: string): UserRow | null {
    return (this.q('SELECT * FROM users WHERE handle = ?').get(handle) as UserRow | undefined) ?? null;
  }

  /** Addresses are compared case-insensitively: the checksum casing is cosmetic. */
  getUserByPubkey(pubkey: string): UserRow | null {
    const row = this.q('SELECT * FROM users WHERE lower(pubkey) = lower(?)').get(pubkey);
    return (row as UserRow | undefined) ?? null;
  }

  setUserPubkey(id: string, pubkey: string): void {
    this.q('UPDATE users SET pubkey = ? WHERE id = ?').run(pubkey, id);
  }

  searchUsers(query: string, excludeId: string, limit = 10): UserRow[] {
    const like = `%${query.replace(/[%_]/g, '')}%`;
    return this.q(
      `SELECT * FROM users WHERE id != ? AND (handle LIKE ? OR lower(display_name) LIKE ?)
       ORDER BY length(handle) ASC, handle ASC LIMIT ?`,
    ).all(excludeId, like, like, limit) as unknown as UserRow[];
  }

  // ---- passkey credentials -------------------------------------------------

  addCredential(row: Omit<CredentialRow, 'created_at'>): void {
    this.q(
      `INSERT INTO credentials (id, user_id, public_key, counter, transports, prf_supported, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.user_id, row.public_key, row.counter, row.transports, row.prf_supported, Date.now());
  }

  getCredential(id: string): CredentialRow | null {
    return (this.q('SELECT * FROM credentials WHERE id = ?').get(id) as CredentialRow | undefined) ?? null;
  }

  getCredentialsForUser(userId: string): CredentialRow[] {
    return this.q('SELECT * FROM credentials WHERE user_id = ?').all(userId) as unknown as CredentialRow[];
  }

  updateCredentialCounter(id: string, counter: number): void {
    this.q('UPDATE credentials SET counter = ? WHERE id = ?').run(counter, id);
  }

  // ---- webauthn challenges -------------------------------------------------

  putChallenge(kind: string, challenge: string, extra: { handle?: string; displayName?: string } = {}): string {
    const id = newId('chal');
    this.q(
      'INSERT INTO challenges (id, challenge, kind, handle, display_name, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, challenge, kind, extra.handle ?? null, extra.displayName ?? null, Date.now() + 5 * 60_000);
    this.q('DELETE FROM challenges WHERE expires_at < ?').run(Date.now());
    return id;
  }

  /** Challenges are single-use: reading one removes it. */
  takeChallenge(id: string, kind: string): { challenge: string; handle: string | null; display_name: string | null } | null {
    const row = this.q('SELECT * FROM challenges WHERE id = ? AND kind = ?').get(id, kind) as
      | { challenge: string; handle: string | null; display_name: string | null; expires_at: number }
      | undefined;
    if (!row) return null;
    this.q('DELETE FROM challenges WHERE id = ?').run(id);
    if (row.expires_at < Date.now()) return null;
    return { challenge: row.challenge, handle: row.handle, display_name: row.display_name };
  }

  // ---- sessions ------------------------------------------------------------

  createSession(tokenHash: string, userId: string, ttlMs: number): void {
    const now = Date.now();
    this.q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, userId, now, now + ttlMs);
    this.q('DELETE FROM sessions WHERE expires_at < ?').run(now);
  }

  getSessionUser(tokenHash: string): UserRow | null {
    const row = this.q(
      `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
    ).get(tokenHash, Date.now()) as UserRow | undefined;
    return row ?? null;
  }

  deleteSession(tokenHash: string): void {
    this.q('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  // ---- encrypted vault -----------------------------------------------------

  putVault(userId: string, blob: string, alg: string): void {
    this.q(
      `INSERT INTO vaults (user_id, blob, alg, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET blob = excluded.blob, alg = excluded.alg, updated_at = excluded.updated_at`,
    ).run(userId, blob, alg, Date.now());
  }

  getVault(userId: string): { blob: string; alg: string } | null {
    const row = this.q('SELECT blob, alg FROM vaults WHERE user_id = ?').get(userId) as
      | { blob: string; alg: string } | undefined;
    return row ?? null;
  }

  // ---- threads -------------------------------------------------------------

  getOrCreateThread(userOne: string, userTwo: string): ThreadRow {
    const [a, b] = userOne < userTwo ? [userOne, userTwo] : [userTwo, userOne];
    const existing = this.q('SELECT * FROM threads WHERE user_a = ? AND user_b = ?').get(a, b) as
      | ThreadRow | undefined;
    if (existing) return existing;
    const row: ThreadRow = {
      id: newId('thr'), user_a: a, user_b: b, last_event_id: null,
      updated_at: Date.now(), unread_a: 0, unread_b: 0,
    };
    this.q(
      `INSERT INTO threads (id, user_a, user_b, last_event_id, updated_at, unread_a, unread_b)
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
    ).run(row.id, row.user_a, row.user_b, null, row.updated_at);
    return row;
  }

  getThread(id: string): ThreadRow | null {
    return (this.q('SELECT * FROM threads WHERE id = ?').get(id) as ThreadRow | undefined) ?? null;
  }

  listThreads(userId: string): ThreadRow[] {
    return this.q(
      `SELECT * FROM threads WHERE (user_a = ? OR user_b = ?) AND last_event_id IS NOT NULL
       ORDER BY updated_at DESC LIMIT 100`,
    ).all(userId, userId) as unknown as ThreadRow[];
  }

  /** Bump a thread to the top and raise the recipient's unread count. */
  touchThread(threadId: string, eventId: string, recipientId: string, bumpUnread = true): void {
    const thread = this.getThread(threadId);
    if (!thread) return;
    const column = thread.user_a === recipientId ? 'unread_a' : 'unread_b';
    const increment = bumpUnread ? 1 : 0;
    this.q(
      `UPDATE threads SET last_event_id = ?, updated_at = ?, ${column} = ${column} + ? WHERE id = ?`,
    ).run(eventId, Date.now(), increment, threadId);
  }

  markThreadRead(threadId: string, userId: string): void {
    const thread = this.getThread(threadId);
    if (!thread) return;
    const column = thread.user_a === userId ? 'unread_a' : 'unread_b';
    this.q(`UPDATE threads SET ${column} = 0 WHERE id = ?`).run(threadId);
  }

  // ---- events --------------------------------------------------------------

  createEvent(input: {
    threadId: string; kind: string; from: string; to: string;
    amountMicros?: bigint | null; note?: string | null; emoji?: string | null; body?: string | null;
    status?: string | null; splitId?: string | null; requestEventId?: string | null;
    createdAt?: number;
  }): EventRow {
    const row: EventRow = {
      id: newId('evt'),
      thread_id: input.threadId,
      kind: input.kind,
      from_user: input.from,
      to_user: input.to,
      amount_micros: input.amountMicros === undefined || input.amountMicros === null
        ? null : input.amountMicros.toString(),
      note: input.note ?? null,
      emoji: input.emoji ?? null,
      body: input.body ?? null,
      status: input.status ?? null,
      chain_signature: null,
      split_id: input.splitId ?? null,
      request_event_id: input.requestEventId ?? null,
      created_at: input.createdAt ?? Date.now(),
      confirmed_at: null,
    };
    this.q(
      `INSERT INTO events (id, thread_id, kind, from_user, to_user, amount_micros, note, emoji, body,
        status, chain_signature, split_id, request_event_id, created_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id, row.thread_id, row.kind, row.from_user, row.to_user, row.amount_micros, row.note,
      row.emoji, row.body, row.status, row.chain_signature, row.split_id, row.request_event_id,
      row.created_at, row.confirmed_at,
    );
    return row;
  }

  getEvent(id: string): EventRow | null {
    return (this.q('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined) ?? null;
  }

  listEvents(threadId: string, opts: { before?: number; limit?: number } = {}): EventRow[] {
    const { before = Number.MAX_SAFE_INTEGER, limit = 30 } = opts;
    // rowid breaks ties so two events in the same millisecond keep the order
    // they were written in.
    const rows = this.q(
      `SELECT * FROM events WHERE thread_id = ? AND created_at < ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    ).all(threadId, before, limit) as unknown as EventRow[];
    return rows.reverse();
  }

  countEventsBefore(threadId: string, before: number): number {
    const row = this.q('SELECT COUNT(*) AS n FROM events WHERE thread_id = ? AND created_at < ?')
      .get(threadId, before) as { n: number };
    return row.n;
  }

  setEventStatus(id: string, status: string, extra: { signature?: string | null; confirmedAt?: number | null } = {}): void {
    this.q('UPDATE events SET status = ?, chain_signature = COALESCE(?, chain_signature), confirmed_at = COALESCE(?, confirmed_at) WHERE id = ?')
      .run(status, extra.signature ?? null, extra.confirmedAt ?? null, id);
  }

  /** Used by the seed script to lay out a plausible history. */
  setEventTimestamps(id: string, createdAt: number, confirmedAt: number | null): void {
    this.q('UPDATE events SET created_at = ?, confirmed_at = ? WHERE id = ?')
      .run(createdAt, confirmedAt, id);
  }

  setThreadUpdatedAt(threadId: string, updatedAt: number): void {
    this.q('UPDATE threads SET updated_at = ? WHERE id = ?').run(updatedAt, threadId);
  }

  getEventBySignature(signature: string): EventRow | null {
    return (this.q('SELECT * FROM events WHERE chain_signature = ?').get(signature) as EventRow | undefined) ?? null;
  }

  pendingPayments(): EventRow[] {
    return this.q(
      "SELECT * FROM events WHERE kind = 'payment' AND status = 'pending' AND chain_signature IS NOT NULL",
    ).all() as unknown as EventRow[];
  }

  /** Total confirmed + in-flight spend in the last 24h, for the daily cap. */
  sentSince(userId: string, since: number): bigint {
    const rows = this.q(
      `SELECT amount_micros FROM events WHERE from_user = ? AND kind = 'payment'
       AND status IN ('pending', 'confirmed') AND created_at >= ?`,
    ).all(userId, since) as Array<{ amount_micros: string | null }>;
    return rows.reduce((sum, row) => sum + BigInt(row.amount_micros ?? '0'), 0n);
  }

  // ---- reactions -----------------------------------------------------------

  toggleReaction(eventId: string, userId: string, emoji: string): 'added' | 'removed' | 'replaced' {
    const existing = this.q('SELECT * FROM reactions WHERE event_id = ? AND user_id = ?')
      .get(eventId, userId) as ReactionRow | undefined;
    if (existing && existing.emoji === emoji) {
      this.q('DELETE FROM reactions WHERE event_id = ? AND user_id = ?').run(eventId, userId);
      return 'removed';
    }
    this.q(
      `INSERT INTO reactions (event_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = excluded.created_at`,
    ).run(eventId, userId, emoji, Date.now());
    return existing ? 'replaced' : 'added';
  }

  reactionsForEvents(eventIds: string[]): ReactionRow[] {
    if (eventIds.length === 0) return [];
    const placeholders = eventIds.map(() => '?').join(',');
    return this.q(`SELECT * FROM reactions WHERE event_id IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...eventIds) as unknown as ReactionRow[];
  }

  // ---- splits --------------------------------------------------------------

  createSplit(creatorId: string, totalMicros: bigint, note: string | null): SplitRow {
    const row: SplitRow = {
      id: newId('spl'), creator_id: creatorId, total_micros: totalMicros.toString(),
      note, created_at: Date.now(),
    };
    this.q('INSERT INTO splits (id, creator_id, total_micros, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.creator_id, row.total_micros, row.note, row.created_at);
    return row;
  }

  addSplitParticipant(splitId: string, userId: string, shareMicros: bigint, requestEventId: string): void {
    this.q(
      `INSERT INTO split_participants (split_id, user_id, share_micros, request_event_id, status)
       VALUES (?, ?, ?, ?, 'open')`,
    ).run(splitId, userId, shareMicros.toString(), requestEventId);
  }

  getSplit(id: string): SplitRow | null {
    return (this.q('SELECT * FROM splits WHERE id = ?').get(id) as SplitRow | undefined) ?? null;
  }

  splitParticipants(splitId: string): SplitParticipantRow[] {
    return this.q('SELECT * FROM split_participants WHERE split_id = ?').all(splitId) as unknown as SplitParticipantRow[];
  }

  setSplitParticipantStatus(splitId: string, userId: string, status: string): void {
    this.q('UPDATE split_participants SET status = ? WHERE split_id = ? AND user_id = ?')
      .run(status, splitId, userId);
  }

  // ---- prepared payments ---------------------------------------------------

  createPrepared(row: Omit<PreparedRow, 'consumed'>): void {
    this.q(
      `INSERT INTO prepared_payments (id, user_id, event_id, message_b64, expires_at, consumed)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run(row.id, row.user_id, row.event_id, row.message_b64, row.expires_at);
  }

  getPrepared(id: string): PreparedRow | null {
    return (this.q('SELECT * FROM prepared_payments WHERE id = ?').get(id) as PreparedRow | undefined) ?? null;
  }

  /** Prepared transfers nobody signed in time — cleaned up so no ghost payments linger. */
  expiredPrepared(now: number): PreparedRow[] {
    return this.q('SELECT * FROM prepared_payments WHERE consumed = 0 AND expires_at < ?')
      .all(now) as unknown as PreparedRow[];
  }

  deletePrepared(id: string): void {
    this.q('DELETE FROM prepared_payments WHERE id = ?').run(id);
  }

  deleteEvent(id: string): void {
    this.q('DELETE FROM reactions WHERE event_id = ?').run(id);
    this.q('DELETE FROM events WHERE id = ?').run(id);
  }

  /** Returns true only for the first caller — this is the replay guard. */
  consumePrepared(id: string): boolean {
    const result = this.q('UPDATE prepared_payments SET consumed = 1 WHERE id = ? AND consumed = 0').run(id);
    return Number(result.changes) === 1;
  }

  // ---- simulated ledger ----------------------------------------------------

  simEnsureAccount(pubkey: string): void {
    this.q('INSERT INTO sim_accounts (pubkey, balance_micros) VALUES (?, \'0\') ON CONFLICT(pubkey) DO NOTHING')
      .run(pubkey);
  }

  simBalance(pubkey: string): bigint {
    const row = this.q('SELECT balance_micros FROM sim_accounts WHERE pubkey = ?').get(pubkey) as
      | { balance_micros: string } | undefined;
    return BigInt(row?.balance_micros ?? '0');
  }

  simCredit(pubkey: string, micros: bigint): void {
    this.simEnsureAccount(pubkey);
    this.q('UPDATE sim_accounts SET balance_micros = ? WHERE pubkey = ?')
      .run((this.simBalance(pubkey) + micros).toString(), pubkey);
  }

  simDebit(pubkey: string, micros: bigint): void {
    this.simCredit(pubkey, -micros);
  }

  simInsertTx(row: SimTxRow): void {
    this.q(
      `INSERT INTO sim_txs (signature, ref, from_pubkey, to_pubkey, amount_micros, status, created_at, confirm_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.signature, row.ref, row.from_pubkey, row.to_pubkey, row.amount_micros, row.status,
      row.created_at, row.confirm_at);
  }

  simTx(signature: string): SimTxRow | null {
    return (this.q('SELECT * FROM sim_txs WHERE signature = ?').get(signature) as SimTxRow | undefined) ?? null;
  }

  simTxByRef(ref: string): SimTxRow | null {
    return (this.q('SELECT * FROM sim_txs WHERE ref = ?').get(ref) as SimTxRow | undefined) ?? null;
  }

  simConfirmDue(now: number): SimTxRow[] {
    const rows = this.q("SELECT * FROM sim_txs WHERE status = 'pending' AND confirm_at <= ?")
      .all(now) as unknown as SimTxRow[];
    for (const row of rows) {
      this.q("UPDATE sim_txs SET status = 'confirmed' WHERE signature = ?").run(row.signature);
    }
    return rows;
  }

  /** Used by the seed script to start from a clean slate. */
  wipe(): void {
    for (const table of [
      'reactions', 'split_participants', 'splits', 'prepared_payments', 'events', 'threads',
      'sessions', 'challenges', 'vaults', 'credentials', 'sim_txs', 'sim_accounts', 'users',
    ]) {
      this.db.exec(`DELETE FROM ${table}`);
    }
  }
}

export function openStore(path: string): Store {
  return new Store(path);
}
