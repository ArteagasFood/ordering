import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, type Db } from '../../db/client';
import { storeMenuItems, globalPrices, priceOverrides } from '../../db/schema';
import { asyncHandler, body, query, send, created } from '../../lib/http';
import { notFound, conflict } from '../../lib/errors';
import { currentUser, assertRole, assertStoreScope } from '../../lib/authz';
import { writeAudit } from '../../lib/audit';
import {
  zMenuListQuery,
  zOrderableMenuQuery,
  zCreateMenuItemRequest,
  zUpdateMenuItemRequest,
  zSetGlobalPriceRequest,
  zSetPriceOverrideRequest,
  type StoreMenuItemDto,
} from '@panaderia/shared';
import {
  listStoreMenu,
  listOrderableMenu,
  getMenuItemRow,
  toStoreMenuItemDto,
  hasLockedOverride,
} from './menu.service';

/**
 * Store menu routes (TDD §6.3, §7, §9.1). Mounted by the integrator at `/menu`.
 *
 * A store_user manages their OWN store's menu (price, par, visibility, availability);
 * a global Admin may manage any store's. Effective price and orderability are resolved
 * by the shared lib helpers via the service so the orders slice snapshots identical
 * prices (TDD §7.2). Price edits are rejected with 409 when a locked admin override
 * fixes the price (§7.1).
 */
export const menuRouter: Router = Router();

// A path :id must be a UUID; reject early with a clear error rather than a DB error.
const zUuidParam = z.string().uuid();
function parseId(raw: string | undefined): string {
  const result = zUuidParam.safeParse(raw);
  if (!result.success) throw notFound('Menu item not found.');
  return result.data;
}

/** A transaction handle, structurally usable wherever a `Db` is accepted. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asDb = (conn: Tx): Db => conn as unknown as Db;

/** GET /?storeId=<id> — a store's full menu. Store users may read only their own store. */
menuRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { storeId } = query(zMenuListQuery, req);
    assertStoreScope(user, storeId); // 403 unless global or the user's own store
    const items = await listStoreMenu(storeId);
    send<StoreMenuItemDto[]>(res, items);
  }),
);

/**
 * GET /orderable?producerStoreId=<id> — only items a buyer may order right now, with
 * effective prices. Any authenticated user may read it (buyers shop across stores).
 */
menuRouter.get(
  '/orderable',
  asyncHandler(async (req, res) => {
    currentUser(req); // 401 if unauthenticated
    const { producerStoreId } = query(zOrderableMenuQuery, req);
    const items = await listOrderableMenu(producerStoreId);
    send<StoreMenuItemDto[]>(res, items);
  }),
);

/** POST / — add a catalog item to a store's menu (owner store_user or admin). */
menuRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = body(zCreateMenuItemRequest, req);
    // Menu creation is store-scoped. A store_user always acts on their own bound store;
    // a global admin has no bound store, so must name the target via `storeId` in the
    // body. `assertStoreScope` is the real guard on whichever id we resolve.
    const storeId = resolveTargetStore(user, req);
    assertStoreScope(user, storeId);

    const [row] = await db
      .insert(storeMenuItems)
      .values({
        storeId,
        catalogItemId: input.catalogItemId,
        categoryId: input.categoryId,
        storePriceCents: input.storePriceCents,
        visible: input.visible,
        availableFrom: input.availableFrom,
        par: input.par,
      })
      .returning({ id: storeMenuItems.id });
    if (!row) throw conflict('Could not create the menu item.');

    const dtoRow = await getMenuItemRow(row.id);
    if (!dtoRow) throw notFound('Menu item not found.');
    created<StoreMenuItemDto>(res, toStoreMenuItemDto(dtoRow));
  }),
);

/**
 * PATCH /:id — edit a store's own menu item. A `storePriceCents` change is rejected
 * with 409 when a locked admin override fixes the price (TDD §7.1).
 */
menuRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = body(zUpdateMenuItemRequest, req);

    const existing = await getMenuItemRow(parseId(req.params.id));
    if (!existing) throw notFound('Menu item not found.');
    assertStoreScope(user, existing.storeId);

    // §7.1: a locked override fixes the price, so the store cannot edit storePriceCents.
    const changesPrice =
      input.storePriceCents !== undefined && input.storePriceCents !== existing.storePriceCents;
    if (changesPrice && hasLockedOverride(existing)) {
      throw conflict('This price is locked by an admin override and cannot be changed.');
    }

    // Only assign columns the caller actually supplied (PATCH semantics).
    const patch: Partial<typeof storeMenuItems.$inferInsert> = { updatedAt: new Date() };
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.storePriceCents !== undefined) patch.storePriceCents = input.storePriceCents;
    if (input.visible !== undefined) patch.visible = input.visible;
    if (input.availableFrom !== undefined) patch.availableFrom = input.availableFrom;
    if (input.par !== undefined) patch.par = input.par;

    await db.update(storeMenuItems).set(patch).where(eq(storeMenuItems.id, existing.id));

    const updated = await getMenuItemRow(existing.id);
    if (!updated) throw notFound('Menu item not found.');
    send<StoreMenuItemDto>(res, toStoreMenuItemDto(updated));
  }),
);

/** DELETE /:id — soft-delete (active=false), never hard-delete (TDD §16.1). */
menuRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const existing = await getMenuItemRow(parseId(req.params.id));
    if (!existing) throw notFound('Menu item not found.');
    assertStoreScope(user, existing.storeId);

    await db
      .update(storeMenuItems)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(storeMenuItems.id, existing.id));

    res.status(204).end();
  }),
);

/**
 * Resolve the store a menu mutation targets. A store_user acts on their bound store; an
 * admin must name the store via `req.body.storeId`. `assertStoreScope` is the real guard
 * that follows — this only picks the candidate id to check.
 */
function resolveTargetStore(
  user: ReturnType<typeof currentUser>,
  req: Parameters<typeof body>[1],
): string {
  if (user.storeId) return user.storeId;
  const bodyStoreId = (req.body as { storeId?: unknown }).storeId;
  if (typeof bodyStoreId === 'string') return bodyStoreId;
  // No store to act on: assertStoreScope will turn this into a clear 403.
  return '';
}

/**
 * Admin pricing routes (TDD §7.1). Mounted by the integrator at `/prices`. Only the
 * Admin may set global prices or lock/clear per-store overrides; every override change
 * is audited with a reason (TDD §16.2).
 */
export const pricesRouter: Router = Router();

/** POST /global — upsert the admin global default price for a catalog item. */
pricesRouter.post(
  '/global',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const input = body(zSetGlobalPriceRequest, req);

    await db
      .insert(globalPrices)
      .values({ catalogItemId: input.catalogItemId, priceCents: input.priceCents })
      .onConflictDoUpdate({
        target: globalPrices.catalogItemId,
        set: { priceCents: input.priceCents, updatedAt: new Date() },
      });

    send(res, { catalogItemId: input.catalogItemId, priceCents: input.priceCents });
  }),
);

/**
 * POST /override — set (and lock) a per-store price override, audited with a reason.
 * The insert and the audit entry commit atomically.
 */
pricesRouter.post(
  '/override',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const input = body(zSetPriceOverrideRequest, req);

    const target = await getMenuItemRow(input.storeMenuItemId);
    if (!target) throw notFound('Menu item not found.');

    await db.transaction(async (tx) => {
      const before =
        target.overrideCents != null
          ? { priceCents: target.overrideCents, locked: target.overrideLocked }
          : null;

      await tx
        .insert(priceOverrides)
        .values({
          storeMenuItemId: input.storeMenuItemId,
          priceCents: input.priceCents,
          locked: true,
          reason: input.reason,
          createdBy: user.id,
        })
        .onConflictDoUpdate({
          target: priceOverrides.storeMenuItemId,
          set: {
            priceCents: input.priceCents,
            locked: true,
            reason: input.reason,
            createdBy: user.id,
            createdAt: new Date(),
          },
        });

      await writeAudit(
        {
          actorId: user.id,
          action: 'admin_price_override',
          target: `store_menu_item:${input.storeMenuItemId}`,
          before,
          after: { priceCents: input.priceCents, locked: true },
          reason: input.reason,
        },
        asDb(tx),
      );
    });

    const updated = await getMenuItemRow(input.storeMenuItemId);
    if (!updated) throw notFound('Menu item not found.');
    send<StoreMenuItemDto>(res, toStoreMenuItemDto(updated));
  }),
);

/**
 * DELETE /override/:storeMenuItemId — remove a price override, audited. A reason is
 * required by the audit log, so the body carries one; the store reverts to its own
 * price (or the global default) afterward.
 */
pricesRouter.delete(
  '/override/:storeMenuItemId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const storeMenuItemId = parseId(req.params.storeMenuItemId);

    const [existing] = await db
      .select({ priceCents: priceOverrides.priceCents, locked: priceOverrides.locked })
      .from(priceOverrides)
      .where(eq(priceOverrides.storeMenuItemId, storeMenuItemId))
      .limit(1);
    if (!existing) throw notFound('No price override exists for that item.');

    const reason =
      typeof (req.body as { reason?: unknown })?.reason === 'string' && (req.body as { reason: string }).reason.trim()
        ? (req.body as { reason: string }).reason
        : 'Override removed by admin.';

    await db.transaction(async (tx) => {
      await tx.delete(priceOverrides).where(eq(priceOverrides.storeMenuItemId, storeMenuItemId));
      await writeAudit(
        {
          actorId: user.id,
          action: 'admin_price_override',
          target: `store_menu_item:${storeMenuItemId}`,
          before: { priceCents: existing.priceCents, locked: existing.locked },
          after: null,
          reason,
        },
        asDb(tx),
      );
    });

    res.status(204).end();
  }),
);
