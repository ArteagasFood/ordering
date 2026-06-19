import { describe, it, expect } from 'vitest';
import { crossesThreshold, receivedVariance, variancePercentage } from './reconciliation.service';

/**
 * Tests for the reconciliation variance math (TDD §10.2). This is the tested reference
 * for the seam the orders slice mirrors at flag-creation time, so every boundary the
 * flag/no-flag decision turns on is pinned explicitly: exactly at the absolute
 * threshold, exactly at the percentage threshold, strictly below both, and the
 * short (negative variance) cases where the magnitude — not the sign — is what counts.
 */

describe('receivedVariance', () => {
  it('is received minus ordered (negative when short)', () => {
    expect(receivedVariance(10, 8)).toBe(-2);
    expect(receivedVariance(10, 13)).toBe(3);
    expect(receivedVariance(10, 10)).toBe(0);
  });
});

describe('variancePercentage', () => {
  it('is the magnitude of the variance over ordered', () => {
    expect(variancePercentage(100, 85)).toBeCloseTo(0.15);
    expect(variancePercentage(100, 115)).toBeCloseTo(0.15); // sign dropped
  });

  it('returns 0 for a zero-ordered line (no meaningful denominator)', () => {
    expect(variancePercentage(0, 5)).toBe(0);
    expect(variancePercentage(0, 0)).toBe(0);
  });
});

describe('crossesThreshold', () => {
  const ABS = 10;
  const PCT = 0.15;

  it('flags when variance is EXACTLY at the absolute threshold (inclusive)', () => {
    // 10 short of 1000 → 1% (below pct) but exactly 10 absolute → flags.
    expect(crossesThreshold(1000, 990, ABS, PCT)).toBe(true);
    // Over-ship of exactly 10 likewise flags.
    expect(crossesThreshold(1000, 1010, ABS, PCT)).toBe(true);
  });

  it('flags when variance is EXACTLY at the percentage threshold (inclusive)', () => {
    // 3 short of 20 → 15% exactly, but only 3 absolute (below 10) → flags on pct.
    expect(crossesThreshold(20, 17, ABS, PCT)).toBe(true);
    // 15% over likewise.
    expect(crossesThreshold(20, 23, ABS, PCT)).toBe(true);
  });

  it('does NOT flag when strictly below both thresholds', () => {
    // 9 short of 1000 → 0.9% and 9 absolute, both under the thresholds.
    expect(crossesThreshold(1000, 991, ABS, PCT)).toBe(false);
    // 2 short of 20 → 10% and 2 absolute, both under.
    expect(crossesThreshold(20, 18, ABS, PCT)).toBe(false);
  });

  it('treats short and over of equal magnitude identically', () => {
    expect(crossesThreshold(100, 84, ABS, PCT)).toBe(crossesThreshold(100, 116, ABS, PCT));
    expect(crossesThreshold(100, 84, ABS, PCT)).toBe(true); // 16 absolute ≥ 10
  });

  it('flags on the absolute rule even when the percentage rule is far from tripping', () => {
    // 10 short of 10000 → 0.1% but 10 absolute → flags.
    expect(crossesThreshold(10000, 9990, ABS, PCT)).toBe(true);
  });

  it('flags on the percentage rule even when the absolute rule is far from tripping', () => {
    // 3 short of 10 → 30% but only 3 absolute → flags on pct.
    expect(crossesThreshold(10, 7, ABS, PCT)).toBe(true);
  });

  it('an exact match on the line (zero variance) never flags', () => {
    expect(crossesThreshold(50, 50, ABS, PCT)).toBe(false);
  });

  it('a zero threshold flags any nonzero variance (degenerate but well-defined)', () => {
    expect(crossesThreshold(10, 9, 0, 0.5)).toBe(true); // abs 1 ≥ 0
    expect(crossesThreshold(10, 10, 0, 0.5)).toBe(true); // abs 0 ≥ 0
  });
});
