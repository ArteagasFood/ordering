import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { users, stores } from '../../db/schema';
import { asyncHandler, body, send, created } from '../../lib/http';
import { notFound, conflict } from '../../lib/errors';
import { currentUser, assertRole } from '../../lib/authz';
import { hashPassword } from '../../lib/password';
import {
  zCreateUserRequest,
  zUpdateUserRequest,
  zSetPasswordRequest,
  type UserDto,
} from '@panaderia/shared';
import { toUserDto, assertStoreExistsForUser, param, type UserRow } from './admin.service';

/**
 * User administration routes (TDD §3, §4). Mounted at `/users` by the integrator.
 *
 * The admin provisions every account: role, store assignment, and password. There is no
 * self-service signup or reset. Listing is global-only (Admin/AP); creating, editing,
 * resetting passwords, and deactivating are admin-only. The `passwordHash` is never
 * selected into a response shape, so it can never leak (TDD §4.1).
 */
export const usersRouter: Router = Router();

/** The columns selected for every user DTO (note: passwordHash is intentionally absent). */
const USER_COLUMNS = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  storeId: users.storeId,
  storeName: stores.name,
  active: users.active,
} as const;

/** Select a single user DTO row by id, joined to its store name, or undefined. */
async function selectUserRow(id: string): Promise<UserRow | undefined> {
  const [row] = await db
    .select(USER_COLUMNS)
    .from(users)
    .leftJoin(stores, eq(users.storeId, stores.id))
    .where(eq(users.id, id))
    .limit(1);
  return row;
}

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin', 'accounts_payable');

    const rows: UserRow[] = await db
      .select(USER_COLUMNS)
      .from(users)
      .leftJoin(stores, eq(users.storeId, stores.id));

    send<UserDto[]>(res, rows.map(toUserDto));
  }),
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const input = body(zCreateUserRequest, req);

    // The shared schema already enforces the store_user ⇔ storeId shape; verify the
    // referenced store actually exists before we hash a password and insert.
    const storeId = await assertStoreExistsForUser(input.storeId ?? null);
    const email = input.email.toLowerCase();

    // Reject a duplicate email with a clean 409 rather than a raw unique-violation.
    const [dupe] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (dupe) throw conflict('A user with that email already exists.');

    const passwordHash = await hashPassword(input.password);
    const [inserted] = await db
      .insert(users)
      .values({ email, name: input.name, role: input.role, storeId, passwordHash })
      .returning({ id: users.id });
    if (!inserted) throw notFound('User not found after creation.');

    const row = await selectUserRow(inserted.id);
    if (!row) throw notFound('User not found after creation.');
    created(res, toUserDto(row));
  }),
);

usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const id = param(req, 'id');
    const input = body(zUpdateUserRequest, req);

    const [existing] = await db
      .select({ role: users.role, storeId: users.storeId })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!existing) throw notFound('User not found.');

    // Enforce the store_user ⇔ storeId invariant against the RESULTING state, since a
    // PATCH may change role and storeId independently (TDD §3.1).
    const nextRole = input.role ?? existing.role;
    const nextStoreId = input.storeId !== undefined ? input.storeId : existing.storeId;
    if ((nextRole === 'store_user') !== (nextStoreId !== null)) {
      throw conflict('Store Users require a store; Admin and Accounts Payable must not have one.');
    }
    if (input.storeId) await assertStoreExistsForUser(input.storeId);

    const patch: Partial<{ name: string; role: typeof nextRole; storeId: string | null; active: boolean }> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.role !== undefined) patch.role = input.role;
    if (input.storeId !== undefined) patch.storeId = input.storeId;
    if (input.active !== undefined) patch.active = input.active;

    if (Object.keys(patch).length > 0) {
      await db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, id));
    }

    const row = await selectUserRow(id);
    if (!row) throw notFound('User not found.');
    send<UserDto>(res, toUserDto(row));
  }),
);

usersRouter.post(
  '/:id/password',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const id = param(req, 'id');
    const input = body(zSetPasswordRequest, req);

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    if (!existing) throw notFound('User not found.');

    const passwordHash = await hashPassword(input.password);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id));

    // 204: the password is set; nothing safe to return.
    res.status(204).end();
  }),
);

usersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const id = param(req, 'id');

    // Soft-delete (TDD §16.1): deactivate so historical orders/audit stay intact.
    const [row] = await db
      .update(users)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });
    if (!row) throw notFound('User not found.');

    const full = await selectUserRow(id);
    if (!full) throw notFound('User not found.');
    send<UserDto>(res, toUserDto(full));
  }),
);
