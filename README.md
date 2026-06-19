# Panadería Exchange

Internal bread ordering & settlement marketplace. See [`tdd.md`](./tdd.md) for the full
design (the source of truth) and [`DECISIONS.md`](./DECISIONS.md) for MVP decisions.

## Stack

- **Web** (`apps/web`): Vite + React + TypeScript, Tailwind + shadcn/ui-style components,
  TanStack Form, Zustand, D3.
- **API** (`apps/api`): Express + Drizzle ORM + PostgreSQL. Self-rolled auth (Argon2id +
  server-side sessions). Authorization enforced in one app-layer module (RLS-ready
  schema; RLS is a documented fast-follow — see `tdd.md` §2.3).
- **Shared** (`packages/shared`): the frozen API contract — enums + request/response
  DTOs imported by both sides.

## Prerequisites

- Node ≥ 20
- PostgreSQL running locally (a `panaderia_dev` database)

## Setup

```bash
# 1. Install
npm install

# 2. Configure env (defaults target local Postgres on :5432)
cp .env.example .env        # adjust DATABASE_URL if needed

# 3. Create the database (once)
createdb panaderia_dev

# 4. Migrate + seed
npm run db:migrate
npm run db:seed
#   …or do both after a wipe:  npm run db:reset
```

## Run

```bash
npm run dev      # starts API (:4000) and web (:5173) together
```

Open http://localhost:5173. The Vite dev server proxies `/api` to Express, so the
session cookie stays first-party.

### Dev accounts (seeded)

| Email | Password | Role |
|---|---|---|
| `admin@admin.com` | `123ABC` | Global Admin |
| `ap@panaderia.local` | `123ABC` | Accounts Payable |
| `central@panaderia.local` | `123ABC` | Store User — Panadería Central (producer) |
| `norte@panaderia.local` | `123ABC` | Store User — Tienda Norte (buyer) |
| `sur@panaderia.local` | `123ABC` | Store User — Tienda Sur (buyer) |

> ⚠️ Dev credentials only. Change/remove before any real deployment.

## Useful scripts

```bash
npm run typecheck    # typecheck all workspaces
npm run test         # run all workspace tests (Vitest)
npm run build        # production build of shared, web, api
npm run db:reset     # drop + migrate + seed (DESTRUCTIVE, dev only)
```

## Architecture notes

The build follows a **contract-first** methodology (`DECISIONS.md` §7): the database
schema, the shared DTO contract, and cross-cutting primitives are frozen first; each
feature slice then lives in its own `apps/api/src/modules/<slice>` and
`apps/web/src/features/<slice>` folder and is wired into the central registries
(`apps/api/src/router.ts`, `apps/web/src/app/routes.tsx`) at integration time.
