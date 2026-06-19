import { describe, it, expect } from 'vitest';
import { netPair, rollupNetted, type DirectionalGross } from './invoicing.service';

/**
 * Tests for the netting computation (TDD §12.1) as a pure function. Storage is always
 * directional; netting is a presentation rollup that offsets the two directions of an
 * unordered pair. The canonical example from the spec is pinned, as is the symmetric
 * equal-amounts case where the obligations cancel to zero.
 */

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const C = '00000000-0000-0000-0000-00000000000c';
const names: Record<string, string> = { [A]: 'Store A', [B]: 'Store B', [C]: 'Store C' };
const nameOf = (id: string) => names[id] ?? '';

describe('netPair', () => {
  it('nets the spec example: A owes B 500, B owes A 300 → A pays B 200', () => {
    const r = netPair(A, 'Store A', B, 'Store B', 500, 300);
    expect(r.aOwesBCents).toBe(500);
    expect(r.bOwesACents).toBe(300);
    expect(r.netPayerStoreId).toBe(A);
    expect(r.netPayeeStoreId).toBe(B);
    expect(r.netAmountCents).toBe(200);
  });

  it('nets to zero with no payer/payee when the two directions are equal', () => {
    const r = netPair(A, 'Store A', B, 'Store B', 400, 400);
    expect(r.netPayerStoreId).toBeNull();
    expect(r.netPayeeStoreId).toBeNull();
    expect(r.netAmountCents).toBe(0);
  });

  it('treats both-zero as a zero net (degenerate equal case)', () => {
    const r = netPair(A, 'Store A', B, 'Store B', 0, 0);
    expect(r.netPayerStoreId).toBeNull();
    expect(r.netAmountCents).toBe(0);
  });

  it('points the net at the larger gross when B owes A more', () => {
    const r = netPair(A, 'Store A', B, 'Store B', 300, 500);
    expect(r.netPayerStoreId).toBe(B);
    expect(r.netPayeeStoreId).toBe(A);
    expect(r.netAmountCents).toBe(200);
  });
});

describe('rollupNetted', () => {
  it('combines the two directional grosses of a pair into one netted row', () => {
    const grosses: DirectionalGross[] = [
      { payerStoreId: A, payeeStoreId: B, grossCents: 500 }, // A owes B 500
      { payerStoreId: B, payeeStoreId: A, grossCents: 300 }, // B owes A 300
    ];
    const pairs = rollupNetted(grosses, nameOf);
    expect(pairs).toHaveLength(1);
    const p = pairs[0]!;
    // Canonical A is the lexicographically smaller id (A < B here).
    expect(p.storeAId).toBe(A);
    expect(p.storeBId).toBe(B);
    expect(p.aOwesBCents).toBe(500);
    expect(p.bOwesACents).toBe(300);
    expect(p.netPayerStoreId).toBe(A);
    expect(p.netPayeeStoreId).toBe(B);
    expect(p.netAmountCents).toBe(200);
  });

  it('attributes direction correctly regardless of which id is canonical A', () => {
    // Only one direction present, and the payer is the lexicographically larger id.
    const grosses: DirectionalGross[] = [{ payerStoreId: B, payeeStoreId: A, grossCents: 750 }];
    const pairs = rollupNetted(grosses, nameOf);
    expect(pairs).toHaveLength(1);
    const p = pairs[0]!;
    expect(p.storeAId).toBe(A); // canonical A is the smaller id
    expect(p.bOwesACents).toBe(750); // B (storeB) owes A
    expect(p.aOwesBCents).toBe(0);
    expect(p.netPayerStoreId).toBe(B);
    expect(p.netPayeeStoreId).toBe(A);
    expect(p.netAmountCents).toBe(750);
  });

  it('omits a pair whose two directions are equal (nets to zero)', () => {
    const grosses: DirectionalGross[] = [
      { payerStoreId: A, payeeStoreId: B, grossCents: 400 },
      { payerStoreId: B, payeeStoreId: A, grossCents: 400 },
    ];
    const pairs = rollupNetted(grosses, nameOf);
    // The pair still appears (it had nonzero grosses) but nets to zero.
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.netAmountCents).toBe(0);
    expect(pairs[0]!.netPayerStoreId).toBeNull();
  });

  it('produces one row per distinct unordered pair across many stores', () => {
    const grosses: DirectionalGross[] = [
      { payerStoreId: A, payeeStoreId: B, grossCents: 100 },
      { payerStoreId: B, payeeStoreId: C, grossCents: 200 },
      { payerStoreId: C, payeeStoreId: A, grossCents: 50 },
    ];
    const pairs = rollupNetted(grosses, nameOf);
    expect(pairs).toHaveLength(3);
    for (const p of pairs) expect(p.netAmountCents).toBeGreaterThan(0);
  });

  it('ignores zero-gross inputs entirely', () => {
    const grosses: DirectionalGross[] = [{ payerStoreId: A, payeeStoreId: B, grossCents: 0 }];
    expect(rollupNetted(grosses, nameOf)).toHaveLength(0);
  });
});
