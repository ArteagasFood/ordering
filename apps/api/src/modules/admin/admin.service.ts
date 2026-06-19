import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { db } from '../../db/client';
import { stores, users, appSettings } from '../../db/schema';
import { resolveCutoff } from '../../lib/settings';
import { forbidden, badRequest } from '../../lib/errors';
import type { SessionUser } from '@panaderia/shared';
import type {
  StoreDto,
  UserDto,
  FeatureFlagDto,
  UpdateStoreRequest,
} from '@panaderia/shared';
import type { Db } from '../../db/client';

/**
 * Admin-slice service (TDD §3, §5.1, §6.1). Holds the non-trivial logic behind the
 * stores/users/flags routers: row-shaping into the shared DTOs, the global-cutoff
 * lookup that feeds the settings resolver, and the field-scoping rule that limits a
 * Store User to editing only their own store's name and cutoff.
 *
 * Authorization itself lives in `lib/authz` and is asserted in the routes; this module
 * assumes the caller has already passed the relevant action/row scope checks.
 */

/** The `app_settings` key holding the admin global default cutoff (TDD §8.2). */
export const GLOBAL_CUTOFF_KEY = 'global_cutoff_time';

/**
 * Read a required route parameter as a definite string. Express types `req.params[k]`
 * as `string | undefined` under `noUncheckedIndexedAccess`; a route with `:id` always
 * supplies it, so an absent value indicates a routing misconfiguration → 400.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (value === undefined || value === '') throw badRequest(`Missing path parameter: ${name}.`);
  return value;
}

/** A row of the `stores` table, as selected for DTO shaping. */
export interface StoreRow {
  id: string;
  name: string;
  canBake: boolean;
  canSell: boolean;
  canBuy: boolean;
  cutoffTime: string | null;
  cutoffLocked: boolean;
  active: boolean;
}

/**
 * Read the admin global default cutoff from `app_settings`, or null when unset.
 *
 * The value column is jsonb; by convention the global cutoff is stored as a bare JSON
 * string (e.g. "06:00"). Any non-string payload is treated as "unset" so a malformed
 * row falls back to the system default rather than corrupting the resolved value.
 *
 * Complexity: a single indexed primary-key lookup, O(1).
 */
export async function getGlobalCutoffDefault(tx: Db = db): Promise<string | null> {
  const [row] = await tx
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, GLOBAL_CUTOFF_KEY))
    .limit(1);
  if (!row) return null;
  return typeof row.value === 'string' ? row.value : null;
}

/**
 * Shape a store row into its DTO, resolving the *effective* cutoff (TDD §5.2, §8.2).
 *
 * Precondition: `globalDefault` is the value from `getGlobalCutoffDefault` (passed in so
 * a list endpoint reads it once rather than per row). Postcondition: `cutoffTime` and
 * `cutoffLocked` reflect the resolver's result — admin lock → store value → global
 * default → system default.
 */
export function toStoreDto(row: StoreRow, globalDefault: string | null): StoreDto {
  const effective = resolveCutoff({
    storeCutoff: row.cutoffTime,
    storeLocked: row.cutoffLocked,
    globalDefault,
  });
  return {
    id: row.id,
    name: row.name,
    canBake: row.canBake,
    canSell: row.canSell,
    canBuy: row.canBuy,
    cutoffTime: effective.value,
    cutoffLocked: effective.locked,
    active: row.active,
  };
}

/**
 * The set of `stores` columns a Store User is permitted to edit on their OWN store:
 * just the display name and the cutoff time (TDD §3.1 — "Manage own store's … cutoffs").
 * A Store User may NOT change capability toggles or the active flag, and may not touch
 * any store but their own (the latter is enforced separately by `assertStoreScope`).
 */
export const STORE_USER_EDITABLE_FIELDS = ['name', 'cutoffTime'] as const;

/** The concrete column updates an update request maps to (post-scoping). */
export type StoreUpdatePatch = Partial<{
  name: string;
  canBake: boolean;
  canSell: boolean;
  canBuy: boolean;
  cutoffTime: string;
  active: boolean;
}>;

/**
 * Compute the column updates to apply for a store-update request, ENFORCING the field
 * scope of the requesting role. This is the security-critical core of `PATCH /stores/:id`
 * and is deliberately a pure function so it can be unit-tested in isolation.
 *
 * Rules (TDD §3.1):
 *   - An admin may set any provided field.
 *   - A Store User may set ONLY `name` and `cutoffTime`. If the request carries any
 *     other field (capability toggle or `active`), that is an attempt to act outside the
 *     allowed scope and we reject the whole request with 403 rather than silently
 *     dropping the field — failing loud keeps the boundary honest and avoids a partial,
 *     surprising update.
 *
 * Preconditions: `req` has already passed `assertStoreScope` (the Store User owns the
 * target store). `isAdmin` is the resolved role check from the caller.
 * Postcondition: the returned patch contains only fields the role may write; it may be
 * empty (a no-op update) which the caller may choose to treat as "nothing to do".
 *
 * @throws forbidden (403) when a non-admin includes a field outside its allowed set.
 */
export function scopeStoreUpdate(req: UpdateStoreRequest, isAdmin: boolean): StoreUpdatePatch {
  if (isAdmin) {
    // Admin: copy through every field that was actually provided.
    const patch: StoreUpdatePatch = {};
    if (req.name !== undefined) patch.name = req.name;
    if (req.canBake !== undefined) patch.canBake = req.canBake;
    if (req.canSell !== undefined) patch.canSell = req.canSell;
    if (req.canBuy !== undefined) patch.canBuy = req.canBuy;
    if (req.cutoffTime !== undefined) patch.cutoffTime = req.cutoffTime;
    if (req.active !== undefined) patch.active = req.active;
    return patch;
  }

  // Store User: any field outside the allowed set is forbidden.
  const allowed = new Set<string>(STORE_USER_EDITABLE_FIELDS);
  const offending = (['canBake', 'canSell', 'canBuy', 'active'] as const).filter(
    (k) => req[k] !== undefined && !allowed.has(k),
  );
  if (offending.length > 0) {
    throw forbidden('You may only edit your store’s name and cutoff time.');
  }

  const patch: StoreUpdatePatch = {};
  if (req.name !== undefined) patch.name = req.name;
  if (req.cutoffTime !== undefined) patch.cutoffTime = req.cutoffTime;
  return patch;
}

/** A `users` row joined to its store name, as selected for DTO shaping. */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserDto['role'];
  storeId: string | null;
  storeName: string | null;
  active: boolean;
}

/**
 * Shape a user row into its DTO. The `passwordHash` is NEVER selected into this shape,
 * so it cannot leak through the API (TDD §4.1).
 */
export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    storeId: row.storeId,
    storeName: row.storeName,
    active: row.active,
  };
}

/** A `feature_flags` row, as selected for DTO shaping. */
export interface FlagRow {
  id: string;
  key: string;
  description: string;
  enabled: boolean;
}

/** Shape a feature-flag row into its DTO. */
export function toFlagDto(row: FlagRow): FeatureFlagDto {
  return { id: row.id, key: row.key, description: row.description, enabled: row.enabled };
}

/**
 * Validate the Store-User ⇔ storeId invariant for a user mutation (TDD §3.1): a
 * Store User must reference an existing, active store; Admin/AP must not carry a store.
 * The shared Zod schema already checks the *shape* of the rule; this verifies the
 * referenced store actually exists so we return a clean 422-style failure rather than a
 * foreign-key error from the database.
 *
 * @returns the (possibly null) storeId to persist.
 * @throws forbidden when a referenced store does not exist.
 */
export async function assertStoreExistsForUser(
  storeId: string | null,
  tx: Db = db,
): Promise<string | null> {
  if (storeId === null) return null;
  const [row] = await tx.select({ id: stores.id }).from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!row) throw forbidden('The assigned store does not exist.');
  return storeId;
}

/** Re-export the principal type for route handlers that need it without a second import. */
export type { SessionUser };
