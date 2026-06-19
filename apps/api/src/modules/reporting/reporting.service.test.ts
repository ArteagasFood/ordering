import { describe, it, expect } from 'vitest';
import type { ReportLineRecord } from '@panaderia/shared';
import {
  lineUnits,
  totalRevenueCents,
  totalUnits,
  chooseGranularity,
  buildTrend,
  topItems,
  deadItems,
  byCategory,
  byProductType,
  wasteByItem,
  summarize,
  MONTH_THRESHOLD_DAYS,
} from './reporting.service';

/**
 * Unit tests for the reporting aggregation math (TDD §13). These exercise only the pure
 * functions over hand-built line arrays — no database — pinning the rules that the whole
 * module's correctness rests on: unit attribution (received-vs-ordered), trend bucketing,
 * top/dead ranking, dimension breakdowns, waste, and total invariants.
 */

/** Build a line record with sensible defaults so each test states only what it varies. */
function line(over: Partial<ReportLineRecord> = {}): ReportLineRecord {
  return {
    serviceDay: '2026-01-01',
    sellerStoreId: 'seller-1',
    buyerStoreId: 'buyer-1',
    catalogItemId: 'item-A',
    catalogItemName: 'Concha',
    categoryId: 'cat-pan',
    categoryName: 'Pan Dulce',
    productTypeId: 'type-bread',
    productTypeName: 'Bread',
    orderedQty: 10,
    receivedQty: null,
    wasteQty: null,
    lineTotalCents: 1000,
    ...over,
  };
}

describe('lineUnits — received-or-ordered attribution', () => {
  it('uses orderedQty when receivedQty is null (not yet received)', () => {
    expect(lineUnits(line({ orderedQty: 7, receivedQty: null }))).toBe(7);
  });

  it('uses receivedQty when present', () => {
    expect(lineUnits(line({ orderedQty: 7, receivedQty: 5 }))).toBe(5);
  });

  it('treats a received count of 0 as zero, NOT a fallback to ordered (fully shorted)', () => {
    // The deliberate ?? (not ||) keeps a real zero from being read as "unset".
    expect(lineUnits(line({ orderedQty: 7, receivedQty: 0 }))).toBe(0);
  });
});

describe('totals', () => {
  const lines = [
    line({ lineTotalCents: 1000, orderedQty: 10, receivedQty: null }),
    line({ lineTotalCents: 2500, orderedQty: 20, receivedQty: 18 }),
    line({ lineTotalCents: 0, orderedQty: 5, receivedQty: 0 }),
  ];

  it('totalRevenueCents sums line totals', () => {
    expect(totalRevenueCents(lines)).toBe(3500);
  });

  it('totalUnits sums received-or-ordered units', () => {
    expect(totalUnits(lines)).toBe(10 + 18 + 0);
  });

  it('returns zero over an empty array', () => {
    expect(totalRevenueCents([])).toBe(0);
    expect(totalUnits([])).toBe(0);
  });
});

describe('chooseGranularity', () => {
  it('uses day buckets for a short range', () => {
    expect(chooseGranularity('2026-01-01', '2026-01-31')).toBe('day');
  });

  it('uses day buckets exactly at the threshold', () => {
    // A span equal to the threshold is still "day".
    expect(chooseGranularity('2026-01-01', '2026-04-02')).toBe('day'); // 92 days inclusive
  });

  it('switches to month buckets just past the threshold', () => {
    expect(chooseGranularity('2026-01-01', '2026-04-03')).toBe('month'); // 93 days
  });

  it('threshold constant is the documented ~3 months', () => {
    expect(MONTH_THRESHOLD_DAYS).toBe(92);
  });
});

describe('buildTrend — time bucketing', () => {
  it('buckets per day and returns chronologically ordered points', () => {
    const lines = [
      line({ serviceDay: '2026-01-03', lineTotalCents: 300, orderedQty: 3 }),
      line({ serviceDay: '2026-01-01', lineTotalCents: 100, orderedQty: 1 }),
      line({ serviceDay: '2026-01-01', lineTotalCents: 150, orderedQty: 2 }),
    ];
    const trend = buildTrend(lines, 'day');
    expect(trend.map((p) => p.period)).toEqual(['2026-01-01', '2026-01-03']);
    expect(trend[0]).toEqual({ period: '2026-01-01', revenueCents: 250, units: 3 });
    expect(trend[1]).toEqual({ period: '2026-01-03', revenueCents: 300, units: 3 });
  });

  it('buckets per month by collapsing the date to YYYY-MM', () => {
    const lines = [
      line({ serviceDay: '2026-01-31', lineTotalCents: 100, orderedQty: 1 }),
      line({ serviceDay: '2026-02-05', lineTotalCents: 200, orderedQty: 2 }),
      line({ serviceDay: '2026-01-02', lineTotalCents: 50, orderedQty: 5 }),
    ];
    const trend = buildTrend(lines, 'month');
    expect(trend.map((p) => p.period)).toEqual(['2026-01', '2026-02']);
    expect(trend[0]).toEqual({ period: '2026-01', revenueCents: 150, units: 6 });
  });

  it('trend totals reconcile with the grand totals (conservation invariant)', () => {
    const lines = [
      line({ serviceDay: '2026-01-01', lineTotalCents: 100, orderedQty: 1, receivedQty: null }),
      line({ serviceDay: '2026-01-02', lineTotalCents: 200, orderedQty: 9, receivedQty: 8 }),
    ];
    const trend = buildTrend(lines, 'day');
    const trendRevenue = trend.reduce((s, p) => s + p.revenueCents, 0);
    const trendUnits = trend.reduce((s, p) => s + p.units, 0);
    expect(trendRevenue).toBe(totalRevenueCents(lines));
    expect(trendUnits).toBe(totalUnits(lines));
  });
});

describe('topItems / deadItems ranking', () => {
  const lines = [
    line({ catalogItemId: 'A', catalogItemName: 'Concha', lineTotalCents: 500, orderedQty: 5 }),
    line({ catalogItemId: 'A', catalogItemName: 'Concha', lineTotalCents: 500, orderedQty: 5 }),
    line({ catalogItemId: 'B', catalogItemName: 'Bolillo', lineTotalCents: 300, orderedQty: 3 }),
    line({ catalogItemId: 'C', catalogItemName: 'Cuernito', lineTotalCents: 50, orderedQty: 1 }),
  ];

  it('topItems ranks by revenue descending and aggregates per item', () => {
    const top = topItems(lines);
    expect(top.map((r) => r.key)).toEqual(['A', 'B', 'C']);
    expect(top[0]).toMatchObject({ key: 'A', revenueCents: 1000, units: 10 });
  });

  it('topItems respects the limit', () => {
    expect(topItems(lines, 2).map((r) => r.key)).toEqual(['A', 'B']);
  });

  it('deadItems surfaces the worst sellers, ascending by revenue', () => {
    const dead = deadItems(lines);
    expect(dead.map((r) => r.key)).toEqual(['C', 'B', 'A']);
    expect(dead[0]).toMatchObject({ key: 'C', revenueCents: 50 });
  });
});

describe('byCategory / byProductType breakdowns', () => {
  const lines = [
    line({ categoryId: 'pan', categoryName: 'Pan', productTypeId: 'bread', productTypeName: 'Bread', lineTotalCents: 400, orderedQty: 4 }),
    line({ categoryId: 'pan', categoryName: 'Pan', productTypeId: 'bread', productTypeName: 'Bread', lineTotalCents: 100, orderedQty: 1 }),
    line({ categoryId: 'dulce', categoryName: 'Dulce', productTypeId: 'pastry', productTypeName: 'Pastry', lineTotalCents: 700, orderedQty: 2 }),
    // An uncategorized line: must NOT create a phantom category group.
    line({ categoryId: null, categoryName: null, productTypeId: 'pastry', productTypeName: 'Pastry', lineTotalCents: 50, orderedQty: 1 }),
  ];

  it('byCategory groups and excludes uncategorized lines', () => {
    const cats = byCategory(lines);
    expect(cats.map((r) => r.key)).toEqual(['dulce', 'pan']);
    expect(cats.find((r) => r.key === 'pan')).toMatchObject({ revenueCents: 500, units: 5 });
  });

  it('byProductType groups including the uncategorized line under its type', () => {
    const types = byProductType(lines);
    expect(types.map((r) => r.key)).toEqual(['pastry', 'bread']);
    // pastry: 700 + 50 = 750; bread: 500
    expect(types.find((r) => r.key === 'pastry')).toMatchObject({ revenueCents: 750, units: 3 });
  });
});

describe('wasteByItem', () => {
  it('sums wasteQty per item, ignores null/zero, ranks descending', () => {
    const lines = [
      line({ catalogItemId: 'A', catalogItemName: 'Concha', wasteQty: 3 }),
      line({ catalogItemId: 'A', catalogItemName: 'Concha', wasteQty: 2 }),
      line({ catalogItemId: 'B', catalogItemName: 'Bolillo', wasteQty: 7 }),
      line({ catalogItemId: 'C', catalogItemName: 'Cuernito', wasteQty: null }),
      line({ catalogItemId: 'D', catalogItemName: 'Dona', wasteQty: 0 }),
    ];
    const waste = wasteByItem(lines);
    expect(waste).toEqual([
      { key: 'B', label: 'Bolillo', wasteUnits: 7 },
      { key: 'A', label: 'Concha', wasteUnits: 5 },
    ]);
  });
});

describe('summarize — full bundle composition', () => {
  it('composes every piece and carries the lens through verbatim', () => {
    const lines = [
      line({ serviceDay: '2026-01-01', catalogItemId: 'A', catalogItemName: 'Concha', lineTotalCents: 1000, orderedQty: 10, wasteQty: 1 }),
      line({ serviceDay: '2026-01-02', catalogItemId: 'B', catalogItemName: 'Bolillo', lineTotalCents: 400, orderedQty: 8, receivedQty: 6 }),
    ];
    const s = summarize(lines, 'buyer', '2026-01-01', '2026-01-31');
    expect(s.lens).toBe('buyer');
    expect(s.totalRevenueCents).toBe(1400);
    expect(s.totalUnits).toBe(16); // 10 + 6
    expect(s.trend.map((p) => p.period)).toEqual(['2026-01-01', '2026-01-02']);
    expect(s.topItems[0]?.key).toBe('A');
    expect(s.deadItems[0]?.key).toBe('B');
    expect(s.waste).toEqual([{ key: 'A', label: 'Concha', wasteUnits: 1 }]);
  });

  it('produces an all-zero, empty summary over no lines', () => {
    const s = summarize([], 'seller', '2026-01-01', '2026-01-31');
    expect(s).toEqual({
      lens: 'seller',
      totalRevenueCents: 0,
      totalUnits: 0,
      trend: [],
      topItems: [],
      deadItems: [],
      byCategory: [],
      byProductType: [],
      waste: [],
    });
  });
});
