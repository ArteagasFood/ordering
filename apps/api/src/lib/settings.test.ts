import { describe, it, expect } from 'vitest';
import { resolveSetting, resolveCutoff, resolvePrice, SYSTEM_DEFAULT_CUTOFF } from './settings';

/**
 * Tests for the settings-resolution primitive (TDD §5.2). The resolution order is the
 * heart of pricing, cutoffs, and email preferences, so each precedence step is pinned
 * explicitly, including the boundary where a value of 0 must NOT be treated as "unset".
 */
describe('resolveSetting precedence', () => {
  it('prefers a locked admin override above all', () => {
    const r = resolveSetting({
      override: { value: 5, locked: true },
      storeValue: 10,
      globalDefault: 20,
      systemDefault: 0,
    });
    expect(r).toEqual({ value: 5, source: 'admin_override', locked: true });
  });

  it('falls to the store value when no override exists', () => {
    const r = resolveSetting({ storeValue: 10, globalDefault: 20, systemDefault: 0 });
    expect(r).toEqual({ value: 10, source: 'store_value', locked: false });
  });

  it('falls to the global default when no store value exists', () => {
    const r = resolveSetting({ storeValue: null, globalDefault: 20, systemDefault: 0 });
    expect(r).toEqual({ value: 20, source: 'global_default', locked: false });
  });

  it('falls to the system default when nothing else is set', () => {
    const r = resolveSetting<number>({ systemDefault: 7 });
    expect(r).toEqual({ value: 7, source: 'system_default', locked: false });
  });

  it('treats a store value of 0 as set, not as missing', () => {
    const r = resolveSetting({ storeValue: 0, globalDefault: 20, systemDefault: 99 });
    expect(r.value).toBe(0);
    expect(r.source).toBe('store_value');
  });
});

describe('resolveCutoff', () => {
  it('uses the system default when neither store nor global is set', () => {
    const r = resolveCutoff({ storeCutoff: null, storeLocked: false, globalDefault: null });
    expect(r).toEqual({ value: SYSTEM_DEFAULT_CUTOFF, source: 'system_default', locked: false });
  });

  it('marks a locked store cutoff as an admin override', () => {
    const r = resolveCutoff({ storeCutoff: '08:00', storeLocked: true, globalDefault: '06:00' });
    expect(r).toEqual({ value: '08:00', source: 'admin_override', locked: true });
  });

  it('prefers the store cutoff over the global default when unlocked', () => {
    const r = resolveCutoff({ storeCutoff: '09:30', storeLocked: false, globalDefault: '06:00' });
    expect(r).toEqual({ value: '09:30', source: 'store_value', locked: false });
  });
});

describe('resolvePrice (TDD §7.1)', () => {
  it('lets a locked override win and reports it locked', () => {
    const r = resolvePrice({
      overrideCents: 250,
      overrideLocked: true,
      storePriceCents: 300,
      globalPriceCents: 400,
    });
    expect(r).toEqual({ value: 250, source: 'admin_override', locked: true });
  });

  it('uses the store price when no override exists', () => {
    const r = resolvePrice({
      overrideCents: null,
      overrideLocked: false,
      storePriceCents: 300,
      globalPriceCents: 400,
    });
    expect(r.value).toBe(300);
    expect(r.source).toBe('store_value');
  });

  it('uses the global price when the store sets none', () => {
    const r = resolvePrice({
      overrideCents: null,
      overrideLocked: false,
      storePriceCents: null,
      globalPriceCents: 400,
    });
    expect(r.value).toBe(400);
    expect(r.source).toBe('global_default');
  });
});
