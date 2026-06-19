/**
 * The complete database schema — the frozen data contract (TDD §15).
 *
 * Every table the application uses is exported from here; drizzle-kit reads this
 * module to generate migrations, and the db client composes it for typed queries.
 * Domain slices import the tables they need but never modify this schema in Phase 1.
 */
export * from './enums';
export * from './identity';
export * from './catalog';
export * from './menu';
export * from './orders';
export * from './settlement';
export * from './system';
