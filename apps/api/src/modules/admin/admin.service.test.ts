import { describe, it, expect } from 'vitest';
import {
  scopeStoreUpdate,
  toStoreDto,
  toUserDto,
  type StoreRow,
} from './admin.service';
import type { UpdateStoreRequest } from '@panaderia/shared';

/**
 * Tests for the admin service's pure logic. The security-critical piece is
 * `scopeStoreUpdate`, which enforces the field-scoping rule of TDD §3.1: a Store User
 * may edit only their own store's name and cutoff, while an admin may edit any field.
 * We pin every branch, especially the rejection path that keeps the boundary honest.
 */
describe('scopeStoreUpdate — field scoping (TDD §3.1)', () => {
  it('lets an admin set every provided field', () => {
    const req: UpdateStoreRequest = {
      name: 'Panadería Centro',
      canBake: true,
      canSell: true,
      canBuy: false,
      cutoffTime: '07:30',
      active: false,
    };
    expect(scopeStoreUpdate(req, true)).toEqual({
      name: 'Panadería Centro',
      canBake: true,
      canSell: true,
      canBuy: false,
      cutoffTime: '07:30',
      active: false,
    });
  });

  it('passes through only the fields an admin actually provided', () => {
    const req: UpdateStoreRequest = { cutoffTime: '06:15' };
    expect(scopeStoreUpdate(req, true)).toEqual({ cutoffTime: '06:15' });
  });

  it('lets a Store User edit name and cutoffTime', () => {
    const req: UpdateStoreRequest = { name: 'New Name', cutoffTime: '08:00' };
    expect(scopeStoreUpdate(req, false)).toEqual({ name: 'New Name', cutoffTime: '08:00' });
  });

  it('lets a Store User edit just the name', () => {
    const req: UpdateStoreRequest = { name: 'Just A Rename' };
    expect(scopeStoreUpdate(req, false)).toEqual({ name: 'Just A Rename' });
  });

  it('rejects a Store User trying to flip a capability toggle', () => {
    const req: UpdateStoreRequest = { canBake: true };
    expect(() => scopeStoreUpdate(req, false)).toThrowError(/name and cutoff/i);
  });

  it('rejects a Store User trying to deactivate the store', () => {
    const req: UpdateStoreRequest = { name: 'Innocent', active: false };
    expect(() => scopeStoreUpdate(req, false)).toThrowError(/name and cutoff/i);
  });

  it('rejects a Store User trying to change can_sell or can_buy', () => {
    expect(() => scopeStoreUpdate({ canSell: false }, false)).toThrow();
    expect(() => scopeStoreUpdate({ canBuy: true }, false)).toThrow();
  });

  it('returns an empty patch for a Store User submitting no editable fields', () => {
    expect(scopeStoreUpdate({}, false)).toEqual({});
  });
});

describe('toStoreDto — effective cutoff resolution (TDD §5.2)', () => {
  const base: StoreRow = {
    id: 's1',
    name: 'Test Store',
    canBake: true,
    canSell: true,
    canBuy: true,
    cutoffTime: null,
    cutoffLocked: false,
    active: true,
  };

  it('uses the store value when present and unlocked', () => {
    const dto = toStoreDto({ ...base, cutoffTime: '09:00' }, '06:00');
    expect(dto.cutoffTime).toBe('09:00');
    expect(dto.cutoffLocked).toBe(false);
  });

  it('falls back to the admin global default when the store has none', () => {
    const dto = toStoreDto({ ...base, cutoffTime: null }, '06:30');
    expect(dto.cutoffTime).toBe('06:30');
  });

  it('falls back to the system default when neither store nor global is set', () => {
    const dto = toStoreDto({ ...base, cutoffTime: null }, null);
    expect(dto.cutoffTime).toBe('06:00'); // SYSTEM_DEFAULT_CUTOFF
  });

  it('reports a locked store cutoff as locked (admin override)', () => {
    const dto = toStoreDto({ ...base, cutoffTime: '10:00', cutoffLocked: true }, '06:00');
    expect(dto.cutoffTime).toBe('10:00');
    expect(dto.cutoffLocked).toBe(true);
  });
});

describe('toUserDto — never leaks a password hash', () => {
  it('shapes only the safe fields', () => {
    const dto = toUserDto({
      id: 'u1',
      email: 'a@b.com',
      name: 'Ana',
      role: 'store_user',
      storeId: 's1',
      storeName: 'Centro',
      active: true,
    });
    expect(dto).toEqual({
      id: 'u1',
      email: 'a@b.com',
      name: 'Ana',
      role: 'store_user',
      storeId: 's1',
      storeName: 'Centro',
      active: true,
    });
    expect('passwordHash' in dto).toBe(false);
  });
});
