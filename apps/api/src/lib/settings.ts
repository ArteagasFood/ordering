import type { Cents, EffectiveValue } from '@panaderia/shared';

/**
 * The settings-resolution primitive (TDD §5.2, §16.3).
 *
 * One resolver governs every admin-vs-store governed setting — pricing, cutoffs, email
 * preferences — so behaviour is identical and a fourth governed setting later is a
 * call site, not new logic. Resolution order:
 *
 *   admin override (locked) → store/user value → admin global default → system default
 *
 * The result carries provenance (`source`) and `locked`, so the UI can show where a
 * value came from and disable editing when an admin has locked it.
 */
export interface SettingCandidates<T> {
  /** An admin override. When present it wins; its `locked` flag flows to the result. */
  override?: { value: T; locked: boolean } | null;
  /** The store's (or user's) own value, used when no override exists. */
  storeValue?: T | null;
  /** The admin global default, used when neither override nor store value exists. */
  globalDefault?: T | null;
  /** The hard-coded fallback, always present. */
  systemDefault: T;
}

export function resolveSetting<T>(c: SettingCandidates<T>): EffectiveValue<T> {
  if (c.override != null) {
    return { value: c.override.value, source: 'admin_override', locked: c.override.locked };
  }
  if (c.storeValue != null) {
    return { value: c.storeValue, source: 'store_value', locked: false };
  }
  if (c.globalDefault != null) {
    return { value: c.globalDefault, source: 'global_default', locked: false };
  }
  return { value: c.systemDefault, source: 'system_default', locked: false };
}

/** The fallback cutoff when neither a store nor an admin global value is set (TDD §8.2). */
export const SYSTEM_DEFAULT_CUTOFF = '06:00';

/**
 * Resolve a store's effective producer cutoff. A locked store cutoff models an admin
 * lock on that store's value; otherwise the store value, then the global default, then
 * the system default apply.
 */
export function resolveCutoff(args: {
  storeCutoff: string | null;
  storeLocked: boolean;
  globalDefault: string | null;
}): EffectiveValue<string> {
  if (args.storeLocked && args.storeCutoff != null) {
    return { value: args.storeCutoff, source: 'admin_override', locked: true };
  }
  return resolveSetting<string>({
    storeValue: args.storeCutoff,
    globalDefault: args.globalDefault,
    systemDefault: SYSTEM_DEFAULT_CUTOFF,
  });
}

/**
 * Resolve an effective price in cents (TDD §7.1): a locked admin override wins and
 * prevents store edits; otherwise the store's price; otherwise the admin global price;
 * otherwise zero (free) as the system default.
 */
export function resolvePrice(args: {
  overrideCents: Cents | null;
  overrideLocked: boolean;
  storePriceCents: Cents | null;
  globalPriceCents: Cents | null;
}): EffectiveValue<Cents> {
  return resolveSetting<Cents>({
    override:
      args.overrideCents != null
        ? { value: args.overrideCents, locked: args.overrideLocked }
        : null,
    storeValue: args.storePriceCents,
    globalDefault: args.globalPriceCents,
    systemDefault: 0,
  });
}
