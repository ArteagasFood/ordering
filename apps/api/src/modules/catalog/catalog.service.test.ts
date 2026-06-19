import { describe, it, expect } from 'vitest';
import type { CatalogItemDto, SessionUser } from '@panaderia/shared';
import { groupCatalogItemsByType, resolveCreatedByStore } from './catalog.service';

/**
 * Unit tests for the pure helpers of the catalog service (TDD §5.3). These pin the two
 * rules the route handlers depend on without touching a database:
 *   1. browse grouping — items collapse under their product type, deterministically;
 *   2. store-attribution — a store_user's item is tagged with their store, a global
 *      admin's item is unattributed, and a store_user without a store is rejected.
 */

function item(partial: Partial<CatalogItemDto> & Pick<CatalogItemDto, 'id' | 'name' | 'productTypeId' | 'productTypeName'>): CatalogItemDto {
  return {
    description: '',
    createdByStoreId: null,
    active: true,
    ...partial,
  };
}

describe('groupCatalogItemsByType', () => {
  it('collapses items into one group per product type', () => {
    const groups = groupCatalogItemsByType([
      item({ id: '1', name: 'Concha', productTypeId: 'bread', productTypeName: 'Bread' }),
      item({ id: '2', name: 'Bolillo', productTypeId: 'bread', productTypeName: 'Bread' }),
      item({ id: '3', name: 'Flan', productTypeId: 'dessert', productTypeName: 'Dessert' }),
    ]);

    expect(groups).toHaveLength(2);
    const bread = groups.find((g) => g.productTypeId === 'bread');
    expect(bread?.items).toHaveLength(2);
  });

  it('orders groups by product-type name and items by name', () => {
    const groups = groupCatalogItemsByType([
      item({ id: '3', name: 'Flan', productTypeId: 'dessert', productTypeName: 'Dessert' }),
      item({ id: '1', name: 'Concha', productTypeId: 'bread', productTypeName: 'Bread' }),
      item({ id: '2', name: 'Bolillo', productTypeId: 'bread', productTypeName: 'Bread' }),
    ]);

    expect(groups.map((g) => g.productTypeName)).toEqual(['Bread', 'Dessert']);
    expect(groups[0]!.items.map((i) => i.name)).toEqual(['Bolillo', 'Concha']);
  });

  it('returns an empty array for no items and does not mutate its input', () => {
    const input: CatalogItemDto[] = [
      item({ id: '1', name: 'Concha', productTypeId: 'bread', productTypeName: 'Bread' }),
    ];
    const snapshot = JSON.stringify(input);
    expect(groupCatalogItemsByType([])).toEqual([]);
    groupCatalogItemsByType(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('resolveCreatedByStore', () => {
  const admin: SessionUser = { id: 'a', email: 'a@x', name: 'A', role: 'admin', storeId: null, storeName: null };
  const ap: SessionUser = { id: 'p', email: 'p@x', name: 'P', role: 'accounts_payable', storeId: null, storeName: null };
  const storeUser: SessionUser = { id: 's', email: 's@x', name: 'S', role: 'store_user', storeId: 'store-1', storeName: 'S1' };

  it('attributes a store_user item to their own store', () => {
    expect(resolveCreatedByStore(storeUser)).toBe('store-1');
  });

  it('leaves a global admin/AP item unattributed (null)', () => {
    expect(resolveCreatedByStore(admin)).toBeNull();
    expect(resolveCreatedByStore(ap)).toBeNull();
  });

  it('fails closed when a store_user is not bound to a store', () => {
    const orphan: SessionUser = { ...storeUser, storeId: null };
    expect(() => resolveCreatedByStore(orphan)).toThrow();
  });
});
