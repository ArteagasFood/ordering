import { Router } from 'express';
import { zBakeListQuery, type BakeListDto, type DistributionDto } from '@panaderia/shared';
import { asyncHandler, query, send } from '../../lib/http';
import { currentUser, assertStoreScope } from '../../lib/authz';
import { getBakeList, getDistribution } from './bakelist.service';

/**
 * Bake list & distribution routes (TDD §9). Mounted at `/bake-list`.
 *
 * Both endpoints are read-only views of frozen orders for one producing store on one
 * service day. Authorization (TDD §3.2): a Store User may see only their own store's
 * bake list — `assertStoreScope` rejects any other producerStoreId with 403 — while a
 * global role (Admin/AP) may view any producer's list.
 */
export const bakeListRouter: Router = Router();

bakeListRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { producerStoreId, serviceDay } = query(zBakeListQuery, req);
    assertStoreScope(user, producerStoreId);
    const dto = await getBakeList(producerStoreId, serviceDay);
    send<BakeListDto>(res, dto);
  }),
);

bakeListRouter.get(
  '/distribution',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { producerStoreId, serviceDay } = query(zBakeListQuery, req);
    assertStoreScope(user, producerStoreId);
    const dto = await getDistribution(producerStoreId, serviceDay);
    send<DistributionDto>(res, dto);
  }),
);
