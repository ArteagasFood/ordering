import { z } from 'zod';
import type { SettingSource } from './enums';

/**
 * Shared scalar conventions and envelope types.
 *
 * MONEY. All monetary amounts are integer **cents** (USD), never floating point.
 * Representing $2.50 as the integer 250 makes every sum, net, and statement exact
 * and reproducible — the foundation of trustworthy settlement (TDD §7.2, §12).
 * The UI formats cents to a display string; the wire and the database stay integer.
 */
export type Cents = number;

/** Zod schema for a non-negative integer count (quantities: ordered, received, waste). */
export const zQuantity = z.number().int().min(0);

/** Zod schema for a monetary amount in integer cents (may be negative for a net owed). */
export const zCents = z.number().int();

/** Zod schema for a price in integer cents (must be non-negative). */
export const zPriceCents = z.number().int().min(0);

/** All primary keys are UUIDs (Postgres `gen_random_uuid()`). */
export const zId = z.string().uuid();
export type Id = string;

/** A service day or month is carried as an ISO date string (YYYY-MM-DD) to avoid timezone drift. */
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export type IsoDate = string;

/** A month key (YYYY-MM) used by invoicing and monthly close (TDD §12). */
export const zMonth = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM');
export type Month = string;

/** Cutoff time-of-day in 24h HH:MM (TDD §8.2). */
export const zTimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');

/**
 * The result of resolving a governed setting (TDD §5.2). Carries not just the
 * effective value but *where it came from* and whether it is locked, so the UI can
 * show provenance and disable editing when an admin has locked the value.
 */
export interface EffectiveValue<T> {
  value: T;
  source: SettingSource;
  /** True when an admin override has locked the value, preventing store/user edits. */
  locked: boolean;
}

/** Standard error body returned by the API for any non-2xx response. */
export interface ApiErrorBody {
  error: {
    /** Stable machine-readable code, e.g. 'unauthorized', 'validation_error', 'not_found'. */
    code: string;
    /** Human-readable message safe to surface to the user. */
    message: string;
    /** Optional field-level validation issues, keyed by dotted field path. */
    fields?: Record<string, string>;
  };
}

/** Query params for paginated list endpoints. */
export const zPageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PageQuery = z.infer<typeof zPageQuery>;

/** A paginated list response envelope. */
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
