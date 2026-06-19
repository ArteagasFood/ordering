import { eq } from 'drizzle-orm';
import type { CookieOptions, Response } from 'express';
import type { SessionUser } from '@panaderia/shared';
import { db } from '../db/client';
import { sessions, users, stores } from '../db/schema';
import { env, isProd } from '../env';

/**
 * Server-side session management (TDD §4.1, §4.2).
 *
 * The browser holds only an opaque session id in an httpOnly cookie; all session
 * state lives in the `sessions` table. This gives instant revocation (delete the row)
 * and means the same lookup that authenticates a request also yields the user, role,
 * and store the authorization module scopes by.
 */

const TTL_MS = env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Create a session row for a user and return its opaque id. */
export async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date(Date.now() + TTL_MS);
  const [row] = await db.insert(sessions).values({ userId, expiresAt }).returning({ id: sessions.id });
  return row!.id;
}

/** Delete a session row, instantly revoking it (TDD §4.1). */
export async function destroySession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

/**
 * Resolve an opaque session id to its principal, or null if the session is missing,
 * expired, or belongs to a deactivated user. Expired sessions are best-effort cleaned.
 */
export async function loadSessionUser(sessionId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      sessionExpires: sessions.expiresAt,
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      active: users.active,
      storeId: users.storeId,
      storeName: stores.name,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(stores, eq(users.storeId, stores.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  if (!row) return null;
  if (row.sessionExpires.getTime() <= Date.now()) {
    await destroySession(sessionId);
    return null;
  }
  if (!row.active) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    storeId: row.storeId ?? null,
    storeName: row.storeName ?? null,
  };
}

/**
 * Cookie attributes (TDD §4.1): httpOnly so JS can't read it; SameSite=Lax to allow
 * top-level navigation while blocking cross-site POSTs; Secure only off-localhost so
 * local HTTP dev still works. `Secure` turns on automatically in production.
 */
function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: TTL_MS,
  };
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(env.SESSION_COOKIE_NAME, sessionId, cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.SESSION_COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

export const SESSION_COOKIE_NAME = env.SESSION_COOKIE_NAME;
