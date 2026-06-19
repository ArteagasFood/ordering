import { and, asc, eq } from 'drizzle-orm';
import type { SessionUser } from '@panaderia/shared';
import type {
  CatalogItemDto,
  CategoryDto,
  DepartmentDto,
  ProductTypeDto,
} from '@panaderia/shared';
import { db } from '../../db/client';
import {
  catalogItems,
  categories,
  departments,
  productTypes,
} from '../../db/schema';
import { isGlobal } from '../../lib/authz';

/**
 * Catalog & taxonomy service (TDD §5.1, §5.3).
 *
 * The catalog is shared and immediate: any store may create an item and it becomes
 * globally visible at once (§5.3), so reads are never store-scoped. Taxonomy
 * (departments → categories) is centrally defined by the admin and identical for
 * everyone. Pure helpers (grouping, store-attribution) are factored out of the route
 * handlers so the rules can be unit-tested without a database.
 */

// --------------------------------------------------------------------------
// Pure helpers (no I/O) — unit-tested in catalog.service.test.ts
// --------------------------------------------------------------------------

/** A catalog item grouped under the product type it belongs to. */
export interface CatalogGroup {
  productTypeId: string;
  productTypeName: string;
  items: CatalogItemDto[];
}

/**
 * Group catalog items by their product type for the browse view (TDD §5.3 — every
 * item is typed from day one).
 *
 * Preconditions: each item carries a consistent (productTypeId, productTypeName) pair.
 * Postconditions: returns one group per distinct product type, the groups ordered by
 * product-type name (case-insensitive, locale-aware) and the items within each group
 * ordered by item name; the input array is not mutated.
 *
 * Complexity: O(n log n) dominated by the two sorts; the grouping pass is O(n).
 */
export function groupCatalogItemsByType(items: readonly CatalogItemDto[]): CatalogGroup[] {
  const groupsById = new Map<string, CatalogGroup>();

  for (const item of items) {
    let group = groupsById.get(item.productTypeId);
    if (!group) {
      group = {
        productTypeId: item.productTypeId,
        productTypeName: item.productTypeName,
        items: [],
      };
      groupsById.set(item.productTypeId, group);
    }
    group.items.push(item);
  }

  const groups = [...groupsById.values()];
  for (const group of groups) {
    group.items.sort((a, b) => a.name.localeCompare(b.name));
  }
  groups.sort((a, b) => a.productTypeName.localeCompare(b.productTypeName));
  return groups;
}

/**
 * Resolve which store an item being created should be attributed to (TDD §5.3).
 *
 * A Store User's creation is attributed to that user's own store; a global role
 * (Admin/AP) creates an unattributed (system) item, so the attribution is null. This
 * encodes the "created by store" invariant in one tested place rather than inline in
 * the handler.
 *
 * Precondition: a non-global user must be bound to a store (the auth module guarantees
 * this for a valid session); if a store_user somehow lacks a storeId we fail closed by
 * throwing, never silently attributing the item to no one.
 */
export function resolveCreatedByStore(user: SessionUser): string | null {
  if (isGlobal(user)) return null;
  if (!user.storeId) {
    throw new Error('A store user must be bound to a store to create a catalog item.');
  }
  return user.storeId;
}

// --------------------------------------------------------------------------
// Product types
// --------------------------------------------------------------------------

/** List every product type, ordered by name. */
export async function listProductTypes(): Promise<ProductTypeDto[]> {
  const rows = await db
    .select({ id: productTypes.id, name: productTypes.name })
    .from(productTypes)
    .orderBy(asc(productTypes.name));
  return rows;
}

/** Create a product type; returns the new DTO. */
export async function createProductType(name: string): Promise<ProductTypeDto> {
  const [row] = await db
    .insert(productTypes)
    .values({ name })
    .returning({ id: productTypes.id, name: productTypes.name });
  return row!;
}

// --------------------------------------------------------------------------
// Catalog items
// --------------------------------------------------------------------------

/** The select projection that joins the product-type name onto a catalog item. */
const catalogSelection = {
  id: catalogItems.id,
  name: catalogItems.name,
  description: catalogItems.description,
  productTypeId: catalogItems.productTypeId,
  productTypeName: productTypes.name,
  createdByStoreId: catalogItems.createdByStore,
  active: catalogItems.active,
};

/**
 * List catalog items with their product-type name joined (TDD §5.3 — catalog is
 * global, so this is never store-scoped). By default only active items are returned;
 * pass `includeInactive` (admin-only at the route layer) to include soft-deleted ones.
 */
export async function listCatalogItems(includeInactive: boolean): Promise<CatalogItemDto[]> {
  const base = db
    .select(catalogSelection)
    .from(catalogItems)
    .innerJoin(productTypes, eq(catalogItems.productTypeId, productTypes.id));

  const rows = includeInactive
    ? await base.orderBy(asc(catalogItems.name))
    : await base.where(eq(catalogItems.active, true)).orderBy(asc(catalogItems.name));

  return rows.map((r) => ({ ...r, createdByStoreId: r.createdByStoreId ?? null }));
}

/** Fetch a single catalog item DTO by id (joined product-type name), or null. */
export async function getCatalogItem(id: string): Promise<CatalogItemDto | null> {
  const [row] = await db
    .select(catalogSelection)
    .from(catalogItems)
    .innerJoin(productTypes, eq(catalogItems.productTypeId, productTypes.id))
    .where(eq(catalogItems.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row, createdByStoreId: row.createdByStoreId ?? null };
}

/** True iff a product type with this id exists. */
export async function productTypeExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: productTypes.id })
    .from(productTypes)
    .where(eq(productTypes.id, id))
    .limit(1);
  return Boolean(row);
}

export interface CreateCatalogItemInput {
  name: string;
  description: string;
  productTypeId: string;
  createdByStore: string | null;
}

/** Insert a catalog item and return its full joined DTO. */
export async function createCatalogItem(input: CreateCatalogItemInput): Promise<CatalogItemDto> {
  const [inserted] = await db
    .insert(catalogItems)
    .values({
      name: input.name,
      description: input.description,
      productTypeId: input.productTypeId,
      createdByStore: input.createdByStore,
    })
    .returning({ id: catalogItems.id });
  // The row was just inserted, so both it and its joined DTO must exist.
  const dto = await getCatalogItem(inserted!.id);
  return dto!;
}

export interface UpdateCatalogItemInput {
  name?: string;
  description?: string;
  productTypeId?: string;
  active?: boolean;
}

/**
 * Apply a partial update to a catalog item (admin-only at the route layer), including
 * the soft-delete (`active = false`, never a hard delete — §16.1). Returns the updated
 * joined DTO, or null if no such item exists.
 */
export async function updateCatalogItem(
  id: string,
  patch: UpdateCatalogItemInput,
): Promise<CatalogItemDto | null> {
  const [row] = await db
    .update(catalogItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(catalogItems.id, id))
    .returning({ id: catalogItems.id });
  if (!row) return null;
  return getCatalogItem(id);
}

// --------------------------------------------------------------------------
// Taxonomy — departments
// --------------------------------------------------------------------------

/** List departments, ordered by name. */
export async function listDepartments(): Promise<DepartmentDto[]> {
  return db
    .select({ id: departments.id, name: departments.name, active: departments.active })
    .from(departments)
    .orderBy(asc(departments.name));
}

/** Create a department; returns its DTO. */
export async function createDepartment(name: string): Promise<DepartmentDto> {
  const [row] = await db
    .insert(departments)
    .values({ name })
    .returning({ id: departments.id, name: departments.name, active: departments.active });
  return row!;
}

/** Apply a partial update to a department; returns the DTO, or null if absent. */
export async function updateDepartment(
  id: string,
  patch: { name?: string; active?: boolean },
): Promise<DepartmentDto | null> {
  const [row] = await db
    .update(departments)
    .set(patch)
    .where(eq(departments.id, id))
    .returning({ id: departments.id, name: departments.name, active: departments.active });
  return row ?? null;
}

// --------------------------------------------------------------------------
// Taxonomy — categories
// --------------------------------------------------------------------------

/** The projection that joins the department name onto a category. */
const categorySelection = {
  id: categories.id,
  name: categories.name,
  departmentId: categories.departmentId,
  departmentName: departments.name,
  active: categories.active,
};

/** List categories with their department name joined, ordered by department then name. */
export async function listCategories(): Promise<CategoryDto[]> {
  return db
    .select(categorySelection)
    .from(categories)
    .innerJoin(departments, eq(categories.departmentId, departments.id))
    .orderBy(asc(departments.name), asc(categories.name));
}

/** True iff a department with this id exists. */
export async function departmentExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.id, id))
    .limit(1);
  return Boolean(row);
}

/** Fetch a single category DTO by id (joined department name), or null. */
export async function getCategory(id: string): Promise<CategoryDto | null> {
  const [row] = await db
    .select(categorySelection)
    .from(categories)
    .innerJoin(departments, eq(categories.departmentId, departments.id))
    .where(eq(categories.id, id))
    .limit(1);
  return row ?? null;
}

/** Create a category within a department; returns the joined DTO. */
export async function createCategory(name: string, departmentId: string): Promise<CategoryDto> {
  const [inserted] = await db
    .insert(categories)
    .values({ name, departmentId })
    .returning({ id: categories.id });
  // Just inserted, so it must exist.
  return (await getCategory(inserted!.id))!;
}

/** Apply a partial update to a category; returns the joined DTO, or null if absent. */
export async function updateCategory(
  id: string,
  patch: { name?: string; active?: boolean },
): Promise<CategoryDto | null> {
  const [row] = await db
    .update(categories)
    .set(patch)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  if (!row) return null;
  return getCategory(id);
}
