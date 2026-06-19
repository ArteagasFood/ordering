import { Router } from 'express';
import { z } from 'zod';
import {
  zCreateProductTypeRequest,
  zCreateCatalogItemRequest,
  zUpdateCatalogItemRequest,
  zCreateDepartmentRequest,
  zCreateCategoryRequest,
  zUpdateTaxonomyNodeRequest,
  type ProductTypeDto,
  type CatalogItemDto,
  type DepartmentDto,
  type CategoryDto,
} from '@panaderia/shared';
import { asyncHandler, body, query, send, created } from '../../lib/http';
import { notFound, conflict, badRequest } from '../../lib/errors';
import { currentUser, assertRole } from '../../lib/authz';
import {
  listProductTypes,
  createProductType,
  listCatalogItems,
  createCatalogItem,
  updateCatalogItem,
  getCatalogItem,
  productTypeExists,
  resolveCreatedByStore,
  listDepartments,
  createDepartment,
  updateDepartment,
  listCategories,
  createCategory,
  updateCategory,
  departmentExists,
  getCategory,
} from './catalog.service';

/**
 * Catalog & taxonomy routes (TDD §5.1, §5.3). Three named routers are exported for the
 * integrator to mount:
 *
 *   - productTypesRouter → /product-types  (typing dimension; admin defines, anyone reads)
 *   - catalogRouter      → /catalog         (shared, immediately-global items)
 *   - taxonomyRouter     → /taxonomy        (admin-defined departments & categories)
 *
 * The catalog is shared and immediate (§5.3): any authenticated store user or admin may
 * create an item and it is globally visible at once — reads are therefore never
 * store-scoped. Taxonomy is centralized: only the admin creates or edits it. Every
 * write validates its body with the shared Zod schema, and every handler resolves the
 * principal and enforces the action scope before touching data.
 */

// A path :id must be a UUID; reject early with a clear error rather than a DB error.
const zUuidParam = z.string().uuid();
function parseId(raw: string | undefined): string {
  const result = zUuidParam.safeParse(raw);
  if (!result.success) throw badRequest('Invalid identifier.');
  return result.data;
}

// Unique-name collisions surface from Postgres as this error code.
const UNIQUE_VIOLATION = '23505';
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

// ==========================================================================
// Product types  (mount at /product-types)
// ==========================================================================

export const productTypesRouter: Router = Router();

/** GET /product-types — any authenticated user lists the typing dimension. */
productTypesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    currentUser(req); // 401 if unauthenticated
    send<ProductTypeDto[]>(res, await listProductTypes());
  }),
);

/** POST /product-types — admin defines a new product type. */
productTypesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const input = body(zCreateProductTypeRequest, req);
    try {
      created<ProductTypeDto>(res, await createProductType(input.name));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A product type with that name already exists.');
      throw err;
    }
  }),
);

// ==========================================================================
// Catalog items  (mount at /catalog)
// ==========================================================================

export const catalogRouter: Router = Router();

const zListCatalogQuery = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
});

/**
 * GET /catalog — any authenticated user browses the shared catalog (CatalogItemDto[]
 * with productTypeName joined). Defaults to active items only; `?includeInactive=true`
 * is honored only for admins (soft-deleted items are an admin concern).
 */
catalogRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { includeInactive } = query(zListCatalogQuery, req);
    const allowInactive = includeInactive === 'true' && user.role === 'admin';
    send<CatalogItemDto[]>(res, await listCatalogItems(allowInactive));
  }),
);

/**
 * POST /catalog — any store_user or admin creates a shared catalog item. When the
 * creator is a store_user the item is attributed to their store; an admin creates an
 * unattributed (system) item. The item is globally visible immediately (§5.3).
 */
catalogRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'store_user', 'admin');
    const input = body(zCreateCatalogItemRequest, req);

    if (!(await productTypeExists(input.productTypeId))) {
      throw badRequest('That product type does not exist.', { productTypeId: 'Unknown product type.' });
    }

    const createdByStore = resolveCreatedByStore(user);
    const dto = await createCatalogItem({
      name: input.name,
      description: input.description ?? '',
      productTypeId: input.productTypeId,
      createdByStore,
    });
    created<CatalogItemDto>(res, dto);
  }),
);

/**
 * PATCH /catalog/:id — admin edits a catalog item, including soft-delete via
 * `active: false`. Reassigning the product type is validated against existing types.
 */
catalogRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const id = parseId(req.params.id);
    const patch = body(zUpdateCatalogItemRequest, req);

    if (patch.productTypeId && !(await productTypeExists(patch.productTypeId))) {
      throw badRequest('That product type does not exist.', { productTypeId: 'Unknown product type.' });
    }

    const existing = await getCatalogItem(id);
    if (!existing) throw notFound('Catalog item not found.');

    const updated = await updateCatalogItem(id, patch);
    if (!updated) throw notFound('Catalog item not found.');
    send<CatalogItemDto>(res, updated);
  }),
);

// ==========================================================================
// Taxonomy: departments & categories  (mount at /taxonomy)
// ==========================================================================

export const taxonomyRouter: Router = Router();

/** GET /taxonomy/departments — any authenticated user reads the central taxonomy. */
taxonomyRouter.get(
  '/departments',
  asyncHandler(async (req, res) => {
    currentUser(req);
    send<DepartmentDto[]>(res, await listDepartments());
  }),
);

/** POST /taxonomy/departments — admin defines a department. */
taxonomyRouter.post(
  '/departments',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const input = body(zCreateDepartmentRequest, req);
    try {
      created<DepartmentDto>(res, await createDepartment(input.name));
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A department with that name already exists.');
      throw err;
    }
  }),
);

/** PATCH /taxonomy/departments/:id — admin renames or (de)activates a department. */
taxonomyRouter.patch(
  '/departments/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const id = parseId(req.params.id);
    const patch = body(zUpdateTaxonomyNodeRequest, req);
    try {
      const updated = await updateDepartment(id, patch);
      if (!updated) throw notFound('Department not found.');
      send<DepartmentDto>(res, updated);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('A department with that name already exists.');
      throw err;
    }
  }),
);

/** GET /taxonomy/categories — any authenticated user lists categories with dept name. */
taxonomyRouter.get(
  '/categories',
  asyncHandler(async (req, res) => {
    currentUser(req);
    send<CategoryDto[]>(res, await listCategories());
  }),
);

/** POST /taxonomy/categories — admin defines a category within a department. */
taxonomyRouter.post(
  '/categories',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const input = body(zCreateCategoryRequest, req);

    if (!(await departmentExists(input.departmentId))) {
      throw badRequest('That department does not exist.', { departmentId: 'Unknown department.' });
    }
    try {
      created<CategoryDto>(res, await createCategory(input.name, input.departmentId));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('A category with that name already exists in this department.');
      }
      throw err;
    }
  }),
);

/** PATCH /taxonomy/categories/:id — admin renames or (de)activates a category. */
taxonomyRouter.patch(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin');
    const id = parseId(req.params.id);
    const patch = body(zUpdateTaxonomyNodeRequest, req);

    const existing = await getCategory(id);
    if (!existing) throw notFound('Category not found.');

    try {
      const updated = await updateCategory(id, patch);
      if (!updated) throw notFound('Category not found.');
      send<CategoryDto>(res, updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('A category with that name already exists in this department.');
      }
      throw err;
    }
  }),
);
