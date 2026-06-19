import type { SessionUser } from '@panaderia/shared';

/**
 * Express request augmentation. The session middleware attaches the resolved
 * principal and the opaque session id to every request; downstream handlers and the
 * authorization module read them. Both are optional here because they are absent on
 * unauthenticated requests — the authorization helpers narrow them to non-null.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

export {};
