import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../../db/client';
import { featureFlags } from '../../db/schema';
import { asyncHandler, body, send, created } from '../../lib/http';
import { notFound, conflict } from '../../lib/errors';
import { currentUser, assertRole } from '../../lib/authz';
import { zCreateFlagRequest, zUpdateFlagRequest, type FeatureFlagDto } from '@panaderia/shared';
import { toFlagDto, param } from './admin.service';

/**
 * Feature-flag administration routes (TDD §6.1). Mounted at `/flags` by the integrator.
 *
 * Flags are a first-class, admin-only registry that gate application capabilities (never
 * catalog or menu structure). All three endpoints require the admin role.
 */
export const flagsRouter: Router = Router();

/** The columns selected for every flag DTO. */
const FLAG_COLUMNS = {
  id: featureFlags.id,
  key: featureFlags.key,
  description: featureFlags.description,
  enabled: featureFlags.enabled,
} as const;

flagsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');

    const rows = await db.select(FLAG_COLUMNS).from(featureFlags).orderBy(asc(featureFlags.key));
    send<FeatureFlagDto[]>(res, rows.map(toFlagDto));
  }),
);

flagsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const input = body(zCreateFlagRequest, req);

    // Keys are unique; reject a duplicate with a clean 409 rather than a raw DB error.
    const [dupe] = await db
      .select({ id: featureFlags.id })
      .from(featureFlags)
      .where(eq(featureFlags.key, input.key))
      .limit(1);
    if (dupe) throw conflict('A flag with that key already exists.');

    const [row] = await db
      .insert(featureFlags)
      .values({ key: input.key, description: input.description, enabled: input.enabled })
      .returning(FLAG_COLUMNS);
    if (!row) throw notFound('Feature flag not found after creation.');
    created(res, toFlagDto(row));
  }),
);

flagsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const id = param(req, 'id');
    const input = body(zUpdateFlagRequest, req);

    const patch: Partial<{ description: string; enabled: boolean }> = {};
    if (input.description !== undefined) patch.description = input.description;
    if (input.enabled !== undefined) patch.enabled = input.enabled;

    const [row] =
      Object.keys(patch).length > 0
        ? await db
            .update(featureFlags)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(featureFlags.id, id))
            .returning(FLAG_COLUMNS)
        : await db.select(FLAG_COLUMNS).from(featureFlags).where(eq(featureFlags.id, id)).limit(1);
    if (!row) throw notFound('Feature flag not found.');

    send<FeatureFlagDto>(res, toFlagDto(row));
  }),
);
