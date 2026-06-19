import { describe, it, expect } from 'vitest';
import type { SessionUser } from '@panaderia/shared';
import { isGlobal, assertRole, assertStoreScope, storeScopeId } from './authz';
import { AppError } from './errors';

/**
 * Tests for the authorization module — the security boundary (TDD §3). These pin the
 * row-scope rules that keep a Store User inside their own store and let global roles
 * (Admin, AP) see across all stores.
 */
const admin: SessionUser = { id: 'a', email: 'a@x', name: 'A', role: 'admin', storeId: null, storeName: null };
const ap: SessionUser = { id: 'p', email: 'p@x', name: 'P', role: 'accounts_payable', storeId: null, storeName: null };
const storeUser: SessionUser = { id: 's', email: 's@x', name: 'S', role: 'store_user', storeId: 'store-1', storeName: 'S1' };

describe('isGlobal', () => {
  it('treats admin and AP as global, store users as scoped', () => {
    expect(isGlobal(admin)).toBe(true);
    expect(isGlobal(ap)).toBe(true);
    expect(isGlobal(storeUser)).toBe(false);
  });
});

describe('assertRole', () => {
  it('passes when the role is allowed', () => {
    expect(() => assertRole(admin, 'admin')).not.toThrow();
  });
  it('throws 403 when the role is not allowed', () => {
    expect(() => assertRole(storeUser, 'admin')).toThrowError(AppError);
    try {
      assertRole(storeUser, 'admin');
    } catch (e) {
      expect((e as AppError).status).toBe(403);
    }
  });
});

describe('assertStoreScope', () => {
  it('lets a global role act on any store', () => {
    expect(() => assertStoreScope(admin, 'store-1')).not.toThrow();
    expect(() => assertStoreScope(ap, 'store-2')).not.toThrow();
  });
  it('lets a store user act on their own store', () => {
    expect(() => assertStoreScope(storeUser, 'store-1')).not.toThrow();
  });
  it('forbids a store user from acting on another store', () => {
    expect(() => assertStoreScope(storeUser, 'store-2')).toThrowError(AppError);
  });
});

describe('storeScopeId', () => {
  it('returns null (unscoped) for global roles', () => {
    expect(storeScopeId(admin)).toBeNull();
  });
  it('returns the bound store id for a store user', () => {
    expect(storeScopeId(storeUser)).toBe('store-1');
  });
  it('fails closed if a store user has no store binding', () => {
    const broken: SessionUser = { ...storeUser, storeId: null };
    expect(() => storeScopeId(broken)).toThrowError(AppError);
  });
});
