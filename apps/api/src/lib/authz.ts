import type { Request, RequestHandler } from 'express';
import type { Role, SessionUser } from '@panaderia/shared';
import { unauthorized, forbidden } from './errors';

/**
 * The authorization module — the single security boundary (TDD §2.3, §3).
 *
 * Per the MVP security decision (see tdd.md §2.3 "Deferred hardening" and
 * DECISIONS.md §2), authorization is enforced here in the application rather than in
 * Postgres RLS. EVERY data route must pass through these helpers, which compose two
 * scoping concepts (TDD §3.2):
 *
 *   - Action scope — which verbs a role may perform → `assertRole` / `requireRole`.
 *   - Row scope     — which rows a role may touch  → `assertStoreScope` /
 *                     `storeScopeId` (Store Users are pinned to their own store; the
 *                     global Admin/AP roles are unscoped).
 *
 * Keeping all of this in one module is what makes the boundary auditable and what
 * makes a future move to RLS a localized change rather than a rewrite.
 */

/** Roles with global (cross-store) visibility (TDD §3.1). */
const GLOBAL_ROLES: ReadonlySet<Role> = new Set<Role>(['admin', 'accounts_payable']);

/** Read the authenticated principal or throw 401. The primary in-handler accessor. */
export function currentUser(req: Request): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** True if the user holds a global role (Admin or AP). */
export function isGlobal(user: SessionUser): boolean {
  return GLOBAL_ROLES.has(user.role);
}

/** Assert the user holds one of the allowed roles, else 403. */
export function assertRole(user: SessionUser, ...allowed: Role[]): void {
  if (!allowed.includes(user.role)) {
    throw forbidden(`This action requires one of: ${allowed.join(', ')}.`);
  }
}

/**
 * Assert the user may act on rows belonging to `storeId`. Global roles may act on any
 * store; a Store User may act only on their own store. A Store User with no bound
 * store (which should never happen) is denied.
 */
export function assertStoreScope(user: SessionUser, storeId: string): void {
  if (isGlobal(user)) return;
  if (user.storeId && user.storeId === storeId) return;
  throw forbidden('You can only act within your own store.');
}

/**
 * The store id a query must be filtered by for this user, or null when the user is
 * global and therefore unscoped. Slices use this to add a mandatory `store_id` filter:
 *   const scope = storeScopeId(user);
 *   if (scope) query = query.where(eq(table.storeId, scope));
 */
export function storeScopeId(user: SessionUser): string | null {
  if (isGlobal(user)) return null;
  // A Store User must be bound to a store; a missing binding is an invariant
  // violation, so fail closed rather than returning a value that matches no/any row.
  if (!user.storeId) throw forbidden('Your account is not assigned to a store.');
  return user.storeId;
}

// --- Route-level middleware forms (for guarding whole routers) ---

/** Middleware: require any authenticated user. */
export const authenticated: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  next();
};

/** Middleware factory: require one of the given roles (implies authentication). */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(forbidden(`This action requires one of: ${allowed.join(', ')}.`));
    }
    next();
  };
}

/** Middleware: require a global role (Admin or AP). */
export const requireGlobal = requireRole('admin', 'accounts_payable');

/** Middleware: require the Admin role. */
export const requireAdmin = requireRole('admin');
