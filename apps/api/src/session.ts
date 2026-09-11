import { createHash, randomBytes } from 'node:crypto';
import '@fastify/cookie'; // type augmentation for request.cookies / reply.setCookie
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Store, UserRow } from './db.js';
import { unauthorized } from './errors.js';

export const SESSION_COOKIE = 'solder_session';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * The raw token only ever exists in the cookie; the database stores its hash,
 * so a database leak cannot be replayed as a login.
 */
export function issueSession(
  store: Store, config: Config, reply: FastifyReply, userId: string,
): void {
  const token = randomBytes(32).toString('base64url');
  store.createSession(hash(token), userId, config.sessionTtlMs);
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: config.origins.some((origin) => origin.startsWith('https://')),
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  });
}

export function clearSession(store: Store, request: FastifyRequest, reply: FastifyReply): void {
  const token = request.cookies[SESSION_COOKIE];
  if (token) store.deleteSession(hash(token));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function currentUser(store: Store, request: FastifyRequest): UserRow | null {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  return store.getSessionUser(hash(token));
}

export function requireUser(store: Store, request: FastifyRequest): UserRow {
  const user = currentUser(store, request);
  if (!user) throw unauthorized();
  return user;
}
