import { z } from 'zod';
import type { Role } from './enums';
import type { Id } from './common';

/**
 * Authentication contract (TDD §4). Auth is self-rolled and admin-managed: there
 * is no public signup and no user-facing password reset. The only public endpoint
 * is login; everything else requires a valid session cookie.
 */

/** POST /api/auth/login request body. */
export const zLoginRequest = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof zLoginRequest>;

/**
 * The authenticated principal, returned by GET /api/auth/me and embedded in the
 * session. `storeId` is null for global roles (Admin, AP) and set for Store Users
 * (TDD §3.1). This is the exact shape the authorization module scopes queries by.
 */
export interface SessionUser {
  id: Id;
  email: string;
  name: string;
  role: Role;
  /** The store this user is bound to, or null for global Admin/AP. */
  storeId: Id | null;
  /** Convenience for the UI: the bound store's display name, when applicable. */
  storeName: string | null;
}

/** GET /api/auth/me response: the current principal, or 401 if unauthenticated. */
export interface MeResponse {
  user: SessionUser;
}

/** POST /api/auth/login response. The session cookie is set via Set-Cookie header. */
export type LoginResponse = MeResponse;
