import { describe, it, expect } from 'vitest';
import type { BakeListLine, ProducerParEntry } from '@panaderia/shared';
import { buildBakeListRows, buildDistributionRows } from './bakelist.service';

/**
 * Unit tests for the bake-list transforms (TDD §9). These exercise the pure functions
 * over hand-built line arrays, so they need no database. The central property under
 * test is the §9 invariant: the bake list and the distribution are two cuts of the
 * SAME lines, so the bake list's `orderedTotal` always equals the distribution's
 * `totalAllocated` for every item.
 */

// Sample frozen lines for one producer + service day. Two buyers, two items, with the
// concha ordered by both buyers so its aggregation crosses destinations.
const lines: BakeListLine[] = [
  { catalogItemId: 'concha', catalogItemName: 'Concha', buyerStoreId: 'A', buyerStoreName: 'Store A', orderedQty: 10 },
  { catalogItemId: 'concha', catalogItemName: 'Concha', buyerStoreId: 'B', buyerStoreName: 'Store B', orderedQty: 16 },
  { catalogItemId: 'bolillo', catalogItemName: 'Bolillo', buyerStoreId: 'A', buyerStoreName: 'Store A', orderedQty: 4 },
];

const pars: ProducerParEntry[] = [
  { catalogItemId: 'concha', catalogItemName: 'Concha', producerPar: 5 },
  // An item with a par but NO orders must still appear (TDD §9.2).
  { catalogItemId: 'orejas', catalogItemName: 'Orejas', producerPar: 3 },
];

describe('buildBakeListRows (aggregate up, TDD §9.2)', () => {
  it('computes bakeQty = orderedTotal + producerPar per item', () => {
    const rows = buildBakeListRows(lines, pars);
    const byId = Object.fromEntries(rows.map((r) => [r.catalogItemId, r]));

    // Concha: 10 + 16 ordered, + 5 par = 31.
    expect(byId.concha).toMatchObject({ orderedTotal: 26, producerPar: 5, bakeQty: 31 });
    // Bolillo: 4 ordered, no par.
    expect(byId.bolillo).toMatchObject({ orderedTotal: 4, producerPar: 0, bakeQty: 4 });
  });

  it('includes an item that has a par but no orders', () => {
    const rows = buildBakeListRows(lines, pars);
    const orejas = rows.find((r) => r.catalogItemId === 'orejas');
    expect(orejas).toMatchObject({ orderedTotal: 0, producerPar: 3, bakeQty: 3 });
  });

  it('always satisfies bakeQty === orderedTotal + producerPar', () => {
    for (const row of buildBakeListRows(lines, pars)) {
      expect(row.bakeQty).toBe(row.orderedTotal + row.producerPar);
    }
  });

  it('returns rows sorted by item name', () => {
    const names = buildBakeListRows(lines, pars).map((r) => r.catalogItemName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('handles no lines and no pars as an empty list', () => {
    expect(buildBakeListRows([], [])).toEqual([]);
  });
});

describe('buildDistributionRows (break down, TDD §9.3)', () => {
  it('splits each item into per-buyer allocations summing to the total', () => {
    const rows = buildDistributionRows(lines);
    const concha = rows.find((r) => r.catalogItemId === 'concha')!;

    expect(concha.totalAllocated).toBe(26);
    expect(concha.allocations).toEqual([
      { buyerStoreId: 'A', buyerStoreName: 'Store A', qty: 10 },
      { buyerStoreId: 'B', buyerStoreName: 'Store B', qty: 16 },
    ]);
  });

  it('omits pars entirely — distribution is only what buyers ordered', () => {
    const rows = buildDistributionRows(lines);
    expect(rows.find((r) => r.catalogItemId === 'orejas')).toBeUndefined();
  });
});

describe('the §9 invariant: the two views agree', () => {
  it('orderedTotal (bake list) === totalAllocated (distribution) for every item', () => {
    const bake = buildBakeListRows(lines, pars);
    const dist = buildDistributionRows(lines);
    const distById = Object.fromEntries(dist.map((r) => [r.catalogItemId, r.totalAllocated]));

    for (const row of bake) {
      // An item present only via its par (no orders) has no distribution entry; its
      // ordered total is 0, which matches an absent allocation.
      const allocated = distById[row.catalogItemId] ?? 0;
      expect(allocated).toBe(row.orderedTotal);
    }
  });
});
