import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { stores } from '../../db/schema';
import { asyncHandler, body, send, created } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { currentUser, assertRole, assertStoreScope, storeScopeId } from '../../lib/authz';
import { zCreateStoreRequest, zUpdateStoreRequest, type StoreDto } from '@panaderia/shared';
import {
  getGlobalCutoffDefault,
  toStoreDto,
  scopeStoreUpdate,
  param,
  type StoreRow,
} from './admin.service';

/**
 * Store administration routes (TDD §5.1, §6.2). Mounted at `/stores` by the integrator.
 *
 * Row scope: Admin and Accounts Payable see all stores (active and inactive); a Store
 * User sees only their own store. Action scope: only an admin may create, deactivate, or
 * edit arbitrary fields; a Store User may edit only their own store's name and cutoff
 * (enforced by `scopeStoreUpdate`). Every read shapes the row through `toStoreDto`, which
 * resolves the effective cutoff against the admin global default (TDD §5.2).
 */
export const storesRouter: Router = Router();

/** The columns selected for every store DTO. */
const STORE_COLUMNS = {
  id: stores.id,
  name: stores.name,
  canBake: stores.canBake,
  canSell: stores.canSell,
  canBuy: stores.canBuy,
  cutoffTime: stores.cutoffTime,
  cutoffLocked: stores.cutoffLocked,
  active: stores.active,
} as const;

storesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const scope = storeScopeId(user); // null = global (Admin/AP see all)

    const globalDefault = await getGlobalCutoffDefault();
    const rows: StoreRow[] = scope
      ? await db.select(STORE_COLUMNS).from(stores).where(eq(stores.id, scope))
      : await db.select(STORE_COLUMNS).from(stores);

    send<StoreDto[]>(
      res,
      rows.map((r) => toStoreDto(r, globalDefault)),
    );
  }),
);

storesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const input = body(zCreateStoreRequest, req);

    const [row] = await db
      .insert(stores)
      .values({
        name: input.name,
        canBake: input.canBake,
        canSell: input.canSell,
        canBuy: input.canBuy,
        cutoffTime: input.cutoffTime ?? null,
      })
      .returning(STORE_COLUMNS);
    if (!row) throw notFound('Store not found after creation.');

    const globalDefault = await getGlobalCutoffDefault();
    created(res, toStoreDto(row, globalDefault));
  }),
);

storesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = param(req, 'id');
    // A Store User may only read their own store; Admin/AP may read any.
    assertStoreScope(user, id);

    const [row] = await db.select(STORE_COLUMNS).from(stores).where(eq(stores.id, id)).limit(1);
    if (!row) throw notFound('Store not found.');

    const globalDefault = await getGlobalCutoffDefault();
    send<StoreDto>(res, toStoreDto(row, globalDefault));
  }),
);

storesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = param(req, 'id');
    // Row scope first: Store Users may touch only their own store.
    assertStoreScope(user, id);
    const input = body(zUpdateStoreRequest, req);

    // Field scope: admins write anything; Store Users only name + cutoffTime (403 else).
    const patch = scopeStoreUpdate(input, user.role === 'admin');

    const [existing] = await db.select({ id: stores.id }).from(stores).where(eq(stores.id, id)).limit(1);
    if (!existing) throw notFound('Store not found.');

    const [row] =
      Object.keys(patch).length > 0
        ? await db
            .update(stores)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(stores.id, id))
            .returning(STORE_COLUMNS)
        : await db.select(STORE_COLUMNS).from(stores).where(eq(stores.id, id)).limit(1);
    if (!row) throw notFound('Store not found.');

    const globalDefault = await getGlobalCutoffDefault();
    send<StoreDto>(res, toStoreDto(row, globalDefault));
  }),
);

storesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const id = param(req, 'id');

    // Soft-delete (TDD §16.1): never hard-delete; set active = false so historical
    // orders and statements referencing this store stay intact.
    const [row] = await db
      .update(stores)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(stores.id, id))
      .returning(STORE_COLUMNS);
    if (!row) throw notFound('Store not found.');

    const globalDefault = await getGlobalCutoffDefault();
    send<StoreDto>(res, toStoreDto(row, globalDefault));
  }),
);
