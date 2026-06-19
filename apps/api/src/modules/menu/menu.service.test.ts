import { describe, it, expect } from 'vitest';
import { toStoreMenuItemDto, hasLockedOverride, type MenuItemRow } from './menu.service';

/**
 * Pure-unit tests for the menu DTO builder (TDD §6.3, §7.1). These cover the two rules
 * the slice is responsible for without touching a database:
 *
 *   1. The "reject store price edit when locked" rule — expressed here as the
 *      `priceLocked` flag the route uses to return a 409, plus `hasLockedOverride`.
 *   2. Orderability — the §6.3 axes evaluated in order via the shared resolver.
 *
 * `today` is pinned so availability-date cases are deterministic.
 */

const TODAY = '2026-06-18';

/** A fully-orderable, store-priced item with no admin override or global price. */
function baseRow(overrides: Partial<MenuItemRow> = {}): MenuItemRow {
  return {
    id: 'mi-1',
    storeId: 'store-1',
    catalogItemId: 'cat-1',
    catalogItemName: 'Concha',
    categoryId: null,
    storePriceCents: 300,
    visible: true,
    adminDisabled: false,
    availableFrom: null,
    par: 12,
    active: true,
    overrideCents: null,
    overrideLocked: false,
    globalPriceCents: 250,
    ...overrides,
  };
}

describe('toStoreMenuItemDto — price resolution & lock (TDD §7.1)', () => {
  it('uses the store price when no override exists, and is not locked', () => {
    const dto = toStoreMenuItemDto(baseRow(), TODAY);
    expect(dto.effectivePriceCents).toBe(300);
    expect(dto.priceLocked).toBe(false);
  });

  it('falls back to the global price when the store sets none', () => {
    const dto = toStoreMenuItemDto(baseRow({ storePriceCents: null }), TODAY);
    expect(dto.effectivePriceCents).toBe(250);
    expect(dto.priceLocked).toBe(false);
  });

  it('lets a locked admin override win and reports priceLocked=true', () => {
    const dto = toStoreMenuItemDto(
      baseRow({ overrideCents: 199, overrideLocked: true, storePriceCents: 300 }),
      TODAY,
    );
    expect(dto.effectivePriceCents).toBe(199);
    expect(dto.priceLocked).toBe(true);
  });

  it('an unlocked override still wins on price but is NOT a lock against edits', () => {
    const dto = toStoreMenuItemDto(
      baseRow({ overrideCents: 199, overrideLocked: false, storePriceCents: 300 }),
      TODAY,
    );
    expect(dto.effectivePriceCents).toBe(199);
    expect(dto.priceLocked).toBe(false);
  });
});

describe('hasLockedOverride — the predicate behind the 409 (TDD §7.1)', () => {
  it('is true only when an override exists AND is locked', () => {
    expect(hasLockedOverride({ overrideCents: 100, overrideLocked: true })).toBe(true);
    expect(hasLockedOverride({ overrideCents: 100, overrideLocked: false })).toBe(false);
    expect(hasLockedOverride({ overrideCents: null, overrideLocked: true })).toBe(false);
    expect(hasLockedOverride({ overrideCents: null, overrideLocked: false })).toBe(false);
  });
});

describe('toStoreMenuItemDto — orderability axes in order (TDD §6.3)', () => {
  it('a visible, active, available item is orderable', () => {
    expect(toStoreMenuItemDto(baseRow(), TODAY).orderable).toBe(true);
  });

  it('an admin-disabled item is never orderable (axis 1, top-down)', () => {
    expect(toStoreMenuItemDto(baseRow({ adminDisabled: true }), TODAY).orderable).toBe(false);
  });

  it('a store-hidden item is not orderable (axis 2)', () => {
    expect(toStoreMenuItemDto(baseRow({ visible: false }), TODAY).orderable).toBe(false);
  });

  it('an item whose availability date is in the future is not orderable (axis 3)', () => {
    expect(toStoreMenuItemDto(baseRow({ availableFrom: '2026-07-01' }), TODAY).orderable).toBe(false);
  });

  it('an item available from today (or earlier) IS orderable', () => {
    expect(toStoreMenuItemDto(baseRow({ availableFrom: TODAY }), TODAY).orderable).toBe(true);
    expect(toStoreMenuItemDto(baseRow({ availableFrom: '2026-01-01' }), TODAY).orderable).toBe(true);
  });

  it('a soft-deleted (inactive) item is not orderable', () => {
    expect(toStoreMenuItemDto(baseRow({ active: false }), TODAY).orderable).toBe(false);
  });
});
