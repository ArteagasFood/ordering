/**
 * @panaderia/shared — the frozen API contract.
 *
 * This package is the single source of truth for the vocabulary (enums), scalar
 * conventions (money in cents, ISO dates), and the request/response DTOs of every
 * endpoint. Both the Express API and the React SPA import from here, so the two
 * sides can never disagree about a shape. Each domain slice owns exactly one module
 * below; this barrel re-exports them and is the one file the integrator wires.
 */
export * from './enums';
export * from './common';
export * from './auth';
export * from './audit';

// Slice contracts (each owned by its slice; see DECISIONS.md §7).
export * from './stores';
export * from './users';
export * from './flags';
export * from './catalog';
export * from './taxonomy';
export * from './menu';
export * from './orders';
export * from './bakelist';
export * from './reconciliation';
export * from './invoicing';
export * from './reporting';
export * from './notifications';
