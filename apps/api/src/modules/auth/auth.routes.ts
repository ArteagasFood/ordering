import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import { zLoginRequest, type LoginResponse, type MeResponse, type SessionUser } from '@panaderia/shared';
import { db } from '../../db/client';
import { users, stores } from '../../db/schema';
import { asyncHandler, body, send } from '../../lib/http';
import { unauthorized } from '../../lib/errors';
import { verifyPassword, hashPassword } from '../../lib/password';
import { createSession, destroySession, setSessionCookie, clearSessionCookie } from '../../lib/session';
import { currentUser } from '../../lib/authz';
import { loginLimiter } from '../../middleware/rateLimit';

/**
 * Authentication routes (TDD §4). The only unauthenticated endpoint is login. There is
 * deliberately no signup or self-service reset — accounts are admin-managed.
 *
 * Anti-enumeration: a wrong email and a wrong password return the identical generic
 * 401, and a dummy hash verification runs even when the user is absent so the response
 * time does not reveal whether an email exists.
 */
export const authRouter: Router = Router();

/** A precomputed throwaway hash to equalize timing on the user-not-found path. */
const DUMMY_HASH_PROMISE = hashPassword('timing-equalizer-not-a-real-password');

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const input = body(zLoginRequest, req);
    const email = input.email.toLowerCase();

    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        active: users.active,
        passwordHash: users.passwordHash,
        storeId: users.storeId,
        storeName: stores.name,
      })
      .from(users)
      .leftJoin(stores, eq(users.storeId, stores.id))
      .where(eq(users.email, email))
      .limit(1);

    let passwordOk = false;
    if (row && row.active) {
      passwordOk = await verifyPassword(row.passwordHash, input.password);
    } else {
      // Burn a comparable amount of time on the not-found/inactive path so the
      // response latency does not reveal whether the email exists.
      const dummyHash = await DUMMY_HASH_PROMISE;
      await verifyPassword(dummyHash, input.password);
    }

    if (!row || !row.active || !passwordOk) {
      throw unauthorized('Incorrect email or password.');
    }

    const sessionId = await createSession(row.id);
    setSessionCookie(res, sessionId);

    const user: SessionUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      storeId: row.storeId ?? null,
      storeName: row.storeName ?? null,
    };
    send<LoginResponse>(res, { user });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    if (req.sessionId) await destroySession(req.sessionId);
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    send<MeResponse>(res, { user });
  }),
);
