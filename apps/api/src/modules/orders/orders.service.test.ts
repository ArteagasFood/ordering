import { describe, it, expect } from 'vitest';
import { billableQty, lineTotalCents, evaluateVariance } from './orders.service';

/**
 * Unit tests for the pure rules at the heart of the orders slice (TDD §7.2, §10).
 * These need no database: they pin the money arithmetic (price snapshot × billable
 * quantity) and the variance/threshold flag decision, the two places a bug would
 * silently corrupt invoices or reconciliation.
 */

describe('billableQty (TDD §10.1)', () => {
  it('uses the ordered quantity before a delivery is received', () => {
    expect(billableQty(10, null)).toBe(10);
  });

  it('uses the confirmed received count once receiving has happened', () => {
    expect(billableQty(10, 8)).toBe(8);
  });

  it('treats a received count of 0 as canonical, not as "unset"', () => {
    // A delivery that arrived empty bills for nothing; null would wrongly bill the order.
    expect(billableQty(10, 0)).toBe(0);
  });

  it('honors a received count that exceeds what was ordered (over-delivery)', () => {
    expect(billableQty(10, 12)).toBe(12);
  });
});

describe('lineTotalCents (TDD §7.2)', () => {
  it('values an unreceived line at orderedQty × snapshot', () => {
    expect(lineTotalCents(10, null, 250)).toBe(2500);
  });

  it('re-values on the received count once received ("bill what shipped")', () => {
    // Producer owed 10 at $2.50 but shipped 8: the line bills 8 × 250 = 2000.
    expect(lineTotalCents(10, 8, 250)).toBe(2000);
  });

  it('is zero when nothing arrived', () => {
    expect(lineTotalCents(10, 0, 250)).toBe(0);
  });

  it('uses the snapshot, never a live price (snapshot is the only price input)', () => {
    expect(lineTotalCents(3, null, 99)).toBe(297);
  });
});

describe('evaluateVariance (TDD §10.2)', () => {
  const threshold = { absolute: 10, percentage: 0.15 };

  it('does not flag a delivery that matches the order exactly', () => {
    const v = evaluateVariance(20, 20, threshold);
    expect(v).toEqual({ variance: 0, variancePct: 0, flagged: false });
  });

  it('reports a negative variance for a short delivery', () => {
    const v = evaluateVariance(20, 18, threshold);
    expect(v.variance).toBe(-2);
    expect(v.variancePct).toBeCloseTo(0.1);
    expect(v.flagged).toBe(false); // 2 < 10 absolute AND 10% < 15%
  });

  it('flags when the absolute threshold is crossed even if the percentage is not', () => {
    // 100 ordered, 89 received: short by 11 (≥ 10 absolute) but only 11% (< 15%).
    const v = evaluateVariance(100, 89, threshold);
    expect(v.variance).toBe(-11);
    expect(v.flagged).toBe(true);
  });

  it('flags when the percentage threshold is crossed even if the absolute is not', () => {
    // 8 ordered, 5 received: short by 3 (< 10 absolute) but 37.5% (≥ 15%).
    const v = evaluateVariance(8, 5, threshold);
    expect(v.variance).toBe(-3);
    expect(v.variancePct).toBeCloseTo(0.375);
    expect(v.flagged).toBe(true);
  });

  it('flags a large over-delivery, not just shorting', () => {
    const v = evaluateVariance(10, 25, threshold);
    expect(v.variance).toBe(15);
    expect(v.flagged).toBe(true);
  });

  it('flags exactly at the absolute boundary (≥, not >)', () => {
    const v = evaluateVariance(100, 90, threshold); // short by exactly 10
    expect(v.flagged).toBe(true);
  });

  it('flags exactly at the percentage boundary (≥, not >)', () => {
    const v = evaluateVariance(20, 17, threshold); // short by 3 = exactly 15%
    expect(v.variancePct).toBeCloseTo(0.15);
    expect(v.flagged).toBe(true);
  });

  it('handles a zero-ordered line without dividing by zero', () => {
    // No meaningful percentage denominator; only the absolute test can flag it.
    const v = evaluateVariance(0, 5, threshold);
    expect(v.variance).toBe(5);
    expect(v.variancePct).toBe(0);
    expect(v.flagged).toBe(false); // 5 < 10 absolute, percentage test skipped
  });

  it('never flags when no threshold is configured (infinite threshold)', () => {
    const v = evaluateVariance(10, 0, { absolute: Infinity, percentage: Infinity });
    expect(v.flagged).toBe(false);
  });
});
