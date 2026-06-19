import { z } from 'zod';
import type { Id } from './common';

/**
 * Shared catalog contract (TDD §5.1, §5.3). The catalog is shared and immediate:
 * any store can create an item and it becomes globally visible at once. Every item
 * is *typed* (product type) from day one so new lines (desserts, etc.) are a
 * configuration change, not a migration.
 */

export interface ProductTypeDto {
  id: Id;
  name: string;
}

export interface CatalogItemDto {
  id: Id;
  name: string;
  description: string;
  productTypeId: Id;
  productTypeName: string;
  createdByStoreId: Id | null;
  active: boolean;
}

/** Admin: define a product type (bread, dessert, …). */
export const zCreateProductTypeRequest = z.object({
  name: z.string().min(1).max(80),
});
export type CreateProductTypeRequest = z.infer<typeof zCreateProductTypeRequest>;

/** Any store: create a shared catalog item. */
export const zCreateCatalogItemRequest = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
  productTypeId: z.string().uuid(),
});
export type CreateCatalogItemRequest = z.infer<typeof zCreateCatalogItemRequest>;

export const zUpdateCatalogItemRequest = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  productTypeId: z.string().uuid().optional(),
  active: z.boolean().optional(),
});
export type UpdateCatalogItemRequest = z.infer<typeof zUpdateCatalogItemRequest>;
