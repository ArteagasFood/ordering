# Panadería Exchange — Build Decisions & Context

> This file captures decisions made with the product owner that are **not** yet
> fully reflected in `tdd.md`. **`tdd.md` remains the single source of truth.**
> Any decision here that diverges from the TDD must be confirmed, applied, and
> then written back into `tdd.md` before being treated as canonical.
>
> Audience: the planning/implementation agent. Read this alongside `tdd.md`.

Date of decisions: 2026-06-18

---

## 1. Scope & environment

- **MVP mode.** Everything in the TDD is to be built, but pragmatically, MVP-first.
- **Local-only for now.** We build and run locally (Vite dev server + local Express +
  local Postgres). **Deployment is explicitly deferred** — do not wire Railway/Vercel
  yet. Keep the build deployment-agnostic (pure static SPA + standalone Express +
  standard Postgres) so any host works later.
- **Secure from day one anyway.** Even though local, build to production-grade security
  practices (see §4).

## 2. Security model — PROPOSED TDD AMENDMENT (pending TDD write-back)

The TDD specifies server-side sessions **and** Postgres Row-Level Security (RLS).
Agreed direction for the MVP:

- **Keep server-side sessions + Argon2id. Do NOT switch to JWT.** Sessions give instant
  revocation and avoid token-refresh complexity for a single Express backend; TDD §4.2
  reasoning stands.
- **Use a single centralized app-layer authorization module instead of Postgres RLS for
  the MVP**, while keeping the schema **RLS-ready** (every store-scoped table keeps
  `store_id`). RLS becomes a documented defense-in-depth fast-follow.

  Rationale: RLS requires per-query transactions with `SET LOCAL` session vars plus
  policies on every table — heavy for an MVP with 3 fixed roles and a trusted internal
  user base. One authorization module that all data access routes through delivers
  strong, testable security now; RLS-ready schema makes adding policies later additive.

  TDD sections to amend when applied: §2.1 (Database row), §2.3 (request/security flow
  steps 3–4), §3 intro, §3.1/§3.2 ("enforced in Postgres" → "enforced in one
  authorization module"). §4 auth essentials unchanged. Add a "deferred to fast-follow:
  Postgres RLS" note.

## 3. Integrations

- **Email: stubbed for MVP.** Implement notifications behind a clean `EmailProvider`
  interface that logs to console/DB in dev. Real Resend swaps in via one env var when a
  key + verified domain exist. No email blocker for local testing.

## 4. Security checklist (build now, even though local)

Argon2id hashing · server-side sessions with `httpOnly` + `SameSite=Lax` cookies
(`Secure` auto-enabled off-localhost) · login rate-limit + lockout (TDD §4.1) ·
`helmet` + HSTS-ready · zod validation on every endpoint · centralized authorization on
every data route · soft-delete for all financial data (TDD §16.1) · immutable audit log
(TDD §16.2) · secrets only in gitignored `.env`, never committed.

## 5. Dev/test accounts (seed)

- **Admin:** `admin@admin.com` / `123ABC` (Argon2id-hashed). **Dev convenience only** —
  must be changed/removed before any real production use; never a secure credential.
- Also seed an **Accounts Payable** user and several **stores** (mix of producers and
  buyers, with capability flags + cutoffs).

## 6. Seed catalog

Use the real pastry catalog in [`docs/seed-pastry-catalog.md`](docs/seed-pastry-catalog.md)
as the catalog seed (names + descriptions). Items are typed (TDD §5.1 Product Type) and
filed under the central taxonomy (department/category). Seed per-store menus with
prices/pars and a few orders spanning lifecycle states (live, frozen, received) so bake
list / receiving / reconciliation / reporting are demoable immediately.

## 7. Methodology — contract-first parallel build

To maximize parallel throughput **without breaking changes**:

```
Phase 0  FOUNDATION (sequential, single writer)  -> freezes the contracts
Phase 1  VERTICAL SLICES (parallel)              -> disjoint folders only
Phase 2  INTEGRATION (sequential, single writer) -> central wiring + seed
```

- **Freeze contracts first:** the complete Drizzle schema (all TDD §15 tables), a shared
  types/DTO package (`packages/shared`), and cross-cutting primitives (session middleware,
  authorization module, the §5.2 settings-resolver, audit-log writer, EmailProvider
  interface, typed API client, app shell).
- **Disjoint ownership:** each Phase-1 slice owns only its own backend `modules/<slice>/`
  and frontend `features/<slice>/`. A slice **never** edits the schema, the shared
  package, the primitives, the central router index, or the frontend route table.
- **Central wiring last:** the integrator registers all slice routers and frontend routes
  in Phase 2 — the only place central registration happens — so parallel work can't
  conflict.

Suggested slices (each = backend module + frontend feature):
A) Admin (stores, users, feature flags) · B) Catalog & taxonomy · C) Menu & pricing ·
D) Orders & lifecycle · E) Bake list & distribution · F) Reconciliation & exceptions ·
G) Invoicing & monthly close · H) Reporting (D3) · I) Notifications/email.

Proposed monorepo layout (npm workspaces): `packages/shared`, `apps/api` (Express +
Drizzle), `apps/web` (Vite + React + shadcn/ui + TanStack Form + Zustand + D3).

## 8. Coding standards

Per the owner's global persona: correctness first; name and briefly justify non-trivial
algorithms; docstrings stating preconditions/postconditions/invariants; comment the
*why*; validate inputs; test edge cases explicitly (Vitest).
