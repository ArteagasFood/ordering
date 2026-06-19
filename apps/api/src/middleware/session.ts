import type { RequestHandler } from 'express';
import { asyncHandler } from '../lib/http';
import { loadSessionUser, SESSION_COOKIE_NAME } from '../lib/session';

/**
 * Session resolution middleware. Runs on every request: if a valid session cookie is
 * present, it attaches the resolved principal (`req.user`) and session id. It never
 * rejects — enforcement is the authorization module's job (lib/authz). This separation
 * keeps "who are you" (here) distinct from "may you do this" (there).
 */
export const sessionMiddleware: RequestHandler = asyncHandler(async (req, _res, next) => {
  const sid = req.cookies?.[SESSION_COOKIE_NAME] as unknown;
  if (typeof sid === 'string' && sid.length > 0) {
    const user = await loadSessionUser(sid);
    if (user) {
      req.user = user;
      req.sessionId = sid;
    }
  }
  next();
});
