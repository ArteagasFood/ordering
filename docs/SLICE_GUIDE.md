# Slice Implementation Guide (Phase 1)

You are implementing ONE vertical slice of Panadería Exchange against a frozen
foundation. Read this entire file, then `tdd.md` for your slice's sections, then build.

`tdd.md` is the source of truth. `DECISIONS.md` records MVP decisions (notably:
authorization is enforced in an app-layer module, NOT Postgres RLS; money is integer
cents; email is stubbed). Do not contradict them.

## The one rule that prevents breakage: stay in your folders

You may create/edit ONLY:

- `apps/api/src/modules/<slice>/**` — your backend (routes, service, tests)
- `apps/web/src/features/<slice>/**` — your frontend (pages, components, hooks)
- `packages/shared/src/<your-contract-file>.ts` — ONLY to ADD fields/DTOs your slice
  needs. Never remove/rename existing exports; never touch another slice's file.

You may READ and IMPORT from anything, but you must NOT edit any of:

- `apps/api/src/db/schema/**` (the schema is frozen)
- `apps/api/src/router.ts`, `apps/api/src/app.ts`, `apps/api/src/lib/**`,
  `apps/api/src/middleware/**`
- `apps/web/src/app/**` (router, layout, header, route registry),
  `apps/web/src/lib/**`, `apps/web/src/components/ui/**`
- `packages/shared/src/index.ts` (the barrel) or other slices' files

**Do NOT register your router or routes anywhere.** The integrator wires them in Phase 2.
**Do NOT** add npm dependencies, run migrations/seed, or start servers. Everything you
need is already installed (including `d3`, `lucide-react`, `@tanstack/react-form`).

## Deliverables

1. **Backend router**: `apps/api/src/modules/<slice>/<slice>.routes.ts` exporting
   `export const <slice>Router: Router = Router();` with all endpoints for your slice,
   defined RELATIVE to your mount path (e.g. if mounted at `/stores`, a list endpoint is
   `<slice>Router.get('/', ...)`). Put non-trivial logic in a sibling
   `<slice>.service.ts`.
2. **Frontend feature**: page component(s) under `apps/web/src/features/<slice>/`,
   exported by name (e.g. `export function StoresPage() {…}`). Use the shared UI + API
   client. Do not add routes to the registry — just export the components and note their
   intended paths/labels/roles in your final report.
3. **Tests**: at least one `*.test.ts` in your module folder covering the core logic of
   your slice (prefer pure functions extracted into the service; DB tests are optional).
4. Make your own code typecheck. (`npx tsc -p apps/api/tsconfig.json --noEmit` will also
   surface other slices' in-progress errors — ignore errors outside your folders.)

## Backend conventions (copy these patterns)

```ts
import { Router } from 'express';
import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { stores /* …tables you need */ } from '../../db/schema';
import { asyncHandler, body, query, send, created } from '../../lib/http';
import { notFound, forbidden, conflict, badRequest } from '../../lib/errors';
import {
  currentUser, assertRole, assertStoreScope, storeScopeId, isGlobal,
  requireRole, requireAdmin, requireGlobal, authenticated,
} from '../../lib/authz';
import { writeAudit } from '../../lib/audit';                 // {actorId, action, target, before, after, reason}
import { resolveCutoff, resolvePrice } from '../../lib/settings';
import { getEffectivePrice, isOrderable } from '../../lib/menu-pricing';
import { getEmailProvider } from '../../lib/email';           // .send({trigger,to,subject,body})
import { zCreateStoreRequest, type StoreDto } from '@panaderia/shared';

export const storesRouter: Router = Router();

storesRouter.get('/', asyncHandler(async (req, res) => {
  const user = currentUser(req);            // 401 if unauthenticated
  const scope = storeScopeId(user);         // null = global (see all); else the user's store id
  // …query, scoping by `scope` when not null…
  send<StoreDto[]>(res, rows);
}));

storesRouter.post('/', asyncHandler(async (req, res) => {
  const user = currentUser(req);
  assertRole(user, 'admin');                // 403 if not admin
  const input = body(zCreateStoreRequest, req);   // 422 on invalid
  // …insert…
  created(res, dto);
}));
```

Rules:
- EVERY handler resolves the principal with `currentUser(req)` and enforces action scope
  (`assertRole`) and, for store-scoped data, row scope (`assertStoreScope(user, storeId)`
  or filter queries by `storeScopeId(user)`). The authorization module is the security
  boundary — never trust the client.
- Validate ALL input with the Zod schemas from `@panaderia/shared` via `body()`/`query()`.
- Throw the helpers from `lib/errors` for failures; never send ad-hoc error bodies.
- Return the DTO shapes from `@panaderia/shared`. Money is integer cents. Dates are ISO
  strings (`YYYY-MM-DD`).
- Sensitive changes (AP corrections, admin overrides/locks/disables, month close,
  payments) MUST call `writeAudit(...)` with a reason (TDD §16.2).
- Soft-delete: set `active = false` (never hard-delete financial/historical data, §16.1).
- Use a transaction (`await db.transaction(async (tx) => { … })`) when multiple writes
  must be atomic (e.g. a correction + its audit entry, receiving a whole order).

## Frontend conventions

```ts
import { api, ApiError } from '@/lib/api-client';   // api.get/post/patch/put/del<T>(path, body?)
import { useAuth } from '@/lib/auth-store';          // useAuth(s => s.user) etc.
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { cn, formatCents } from '@/lib/utils';
import type { StoreDto } from '@panaderia/shared';
```

- Call the API only through `@/lib/api-client`; paths are relative to `/api` and your
  router's mount (e.g. `api.get<StoreDto[]>('/stores')`).
- Follow the empathetic UI philosophy (TDD §17): large targets, the common path obvious,
  never render a control the user lacks permission to use (gate on `user.role`), clear
  confirmations before irreversible actions (freeze, close), plain bakery language
  (bake list, par, shorted, received).
- Keep slice-local state in component state or a small Zustand store inside your feature
  folder if needed. Charts use `d3`.
- Use `lucide-react` for icons. Use the design tokens (primary/muted/etc.) — no hard-coded
  colors.

## Final report

End by listing: the endpoints you created (method + full path), the page components you
exported (name + intended route path + label + which roles see it in nav), any DTO
additions you made to your shared contract file, and anything the integrator must know.
