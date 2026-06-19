# Panadería Exchange — Technical Design Document

**Internal Bread Ordering & Settlement Marketplace**

Version 1.0 · Draft for Review · June 18, 2026

---

## Contents

1. [Overview & Goals](#1-overview--goals)
2. [Technology Stack & Architecture](#2-technology-stack--architecture)
3. [Roles & Permissions](#3-roles--permissions)
4. [Authentication](#4-authentication)
5. [Domain Model](#5-domain-model)
6. [Capabilities & Feature Flags](#6-capabilities--feature-flags)
7. [Pricing](#7-pricing)
8. [Order Lifecycle](#8-order-lifecycle)
9. [Bake List & Distribution](#9-bake-list--distribution)
10. [Reconciliation & Exceptions](#10-reconciliation--exceptions)
11. [Waste Tracking](#11-waste-tracking)
12. [Invoicing & Monthly Close](#12-invoicing--monthly-close)
13. [Reporting Module](#13-reporting-module)
14. [Notifications & Email](#14-notifications--email)
15. [Data Model Summary](#15-data-model-summary)
16. [Cross-Cutting Concerns](#16-cross-cutting-concerns)
17. [UI Philosophy](#17-ui-philosophy)

---

## 1. Overview & Goals

Panadería Exchange is an internal web application that lets a group of small Mexican grocery stores, all operating under a single corporate umbrella, order baked goods from one another. Some stores have a bakery and can produce; others do not and must source their bread from a sister store. The application coordinates that exchange end to end: catalog, pricing, ordering, baking, distribution, receiving, reconciliation, and monthly settlement.

Crucially, there is no payment processing. Stores settle with one another by physically writing checks. The application's financial job is therefore not to move money but to track what is owed with enough rigor and auditability that Accounts Payable can confidently issue those checks at the end of each month and close the books.

### 1.1 Primary Goals

1. Let a global administrator manage every store, user, the shared product catalog, and all feature flags from one place.
2. Let producing stores publish a menu, set prices, and receive aggregated orders as an actionable bake list.
3. Let buying stores place and edit orders up to a producer-defined cutoff, then receive and count what physically arrives.
4. Capture every order line with enough granular, price-snapshotted detail to power a deep reporting module for business decisions.
5. Roll a month of many-to-many transactions down to a single, auditable amount owed between each pair of stores.

### 1.2 Explicit Non-Goals

- No payment gateway, card processing, or Stripe-style integration. Settlement is offline by check.
- No customer-facing storefront. This is an internal tool only; every user belongs to the organization.
- No configurable/role-builder RBAC in v1. Roles are fixed in code (revisited in §3).
- No self-service account signup or password reset flows. The administrator provisions and manages all accounts.

### 1.3 Product Scope Today, Extensible Tomorrow

Today the product is Mexican bread and panadería items. The data model treats every catalog entry as **typed** (e.g. bread, dessert) from day one, so adding desserts or other lines later is a configuration change, not a schema migration.

---

## 2. Technology Stack & Architecture

### 2.1 Stack at a Glance

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React (SPA) | Fast dev loop; pure static build keeps hosting portable. |
| UI components | shadcn/ui | Accessible, composable primitives we fully own and can restyle. |
| Forms | TanStack Form | Type-safe, headless form state with fine-grained validation. |
| UI state | Zustand | Minimal, unopinionated client state without boilerplate. |
| Charts | D3 | Full control for the granular reporting module. |
| Backend | Express (Node.js) | Familiar, stable, long-lived process well suited to Railway. |
| ORM | Drizzle | Type-safe SQL with first-class Postgres + migrations. |
| Database | PostgreSQL | Relational integrity; RLS-ready schema for future row-level enforcement (see §2.3). |
| Email | Resend | Simple transactional email for reminders, digests, alerts. |
| Auth | Self-rolled | Argon2id + server-side sessions; admin-managed accounts. |

### 2.2 Deployment Topology

The frontend is a **pure static Vite bundle** served by Vercel. The backend is an Express API hosted on Railway, alongside the Postgres database. The browser talks to the API directly over HTTPS; Vercel only ever serves HTML, JS, and CSS assets.

> **Portability guardrail.** *All* backend logic lives in the Express service on Railway. Vercel serves static assets only — no serverless functions, no edge middleware, no Vercel-specific APIs.
>
> Consequence: migrating the frontend off Vercel (to Netlify, Cloudflare Pages, S3 + CloudFront, or Railway itself) is a copy of the static build output and a DNS change. Nothing about the application logic is tied to the host.

### 2.3 Request & Security Flow

1. Browser sends credentials to the Express API; on success the API issues an httpOnly, Secure, SameSite session cookie.
2. Every subsequent request carries that cookie. Express middleware resolves the session to a user and role.
3. Before issuing queries, the request handler passes through a single **authorization module** that resolves the session to the current user, role, and store, and computes the row scope the request is permitted.
4. Drizzle runs the query with that scope applied (e.g. a mandatory `store_id` filter for Store Users). The authorization module is the one place every data access is gated.
5. The API shapes the result and returns JSON; the SPA renders, having already hidden any controls the user lacks permission to use.

> **Two layers, two jobs.** UI enforcement is for experience — never show a button that will fail. The server-side authorization module is the real security boundary — every data route passes through it, so a bug elsewhere or a malicious client cannot read or write rows the role isn't entitled to.

> **Deferred hardening (MVP decision, June 2026).** v1 enforces authorization in one application-layer module rather than in Postgres Row-Level Security. The schema is kept **RLS-ready** — every store-scoped table carries `store_id` — so RLS policies can be added later as defense-in-depth without a migration. Rationale: for three fixed roles and a trusted internal user base, a single audited authorization module is simpler to build and test for the MVP while remaining a true boundary, and the server-side session already yields the user/role/store needed to scope every query. Server-side sessions and Argon2id (§4) are unchanged.

---

## 3. Roles & Permissions

RBAC is intentionally simple in v1: three roles, fixed in code. There is no UI for inventing roles or reassigning permissions — a deliberate choice to avoid over-engineering a bread-ordering app. The structure below still routes all enforcement through a single server-side authorization module (see §2.3; Postgres RLS is a planned hardening step), so a future configurable layer would change where permissions are defined (a table instead of code) without changing how they are enforced.

### 3.1 The Three Roles

| Role | Scope | Can do | Cannot do |
|---|---|---|---|
| Global Admin | Global | Everything: manage stores, users, catalog, taxonomy, feature flags, pricing overrides, all settings, full reports. | — |
| Accounts Payable | Global (view) | View nearly everything; make audited corrections to order quantities; manage invoices, payments, and month close. | Change application settings, flags, catalog, taxonomy, or pricing rules. |
| Store User | Store-bound | Manage own store's menu, prices, par levels, cutoffs; place/edit/receive orders for own store; record waste; view own reports. | See or touch other stores' settings; act outside their own store. |

### 3.2 How Enforcement Stays Honest

Two scoping concepts compose to give every rule:

- **Action scope** — the verb the role may perform (place an order, mark an invoice paid, edit a flag). Branches in code and in policy on the role column.
- **Row scope** — which rows the role may touch. Global roles (Admin, AP) see across all stores; the Store User is constrained by the authorization module to rows belonging to their own store.

The Store User's store-binding is enforced in the authorization module: every query for a Store User is scoped by comparing the row's `store_id` against the current user's store, resolved from the session. The UI mirrors these rules for usability, but the server-side check is what makes them true. (RLS can later enforce the same rule inside the database — see §2.3.)

> **AP and segregation of duties.** AP can correct order quantities — for the real case where a store phones to say an order wasn't fulfilled — but never silently. Every AP correction is written to the audit log with the actor, timestamp, before/after values, and a required reason. AP is therefore unimpeded for legitimate fixes while any attempt to quietly massage numbers leaves a permanent, reportable trail.

---

## 4. Authentication

Auth is self-rolled and deliberately minimal in feature surface — but not in rigor. The administrator acts as the system administrator for accounts: creating users, assigning them to a store and role, and setting or resetting passwords. There is no public signup and no user-facing password-reset email flow.

### 4.1 Security Essentials

| Concern | Approach |
|---|---|
| Password storage | Argon2id hashing with a per-user salt. Plaintext passwords are never stored or logged. |
| Sessions | Server-side sessions persisted in a Postgres sessions table; the browser holds only an opaque session ID. |
| Cookies | httpOnly, Secure, SameSite=Lax. Not readable by JavaScript, sent only over HTTPS. |
| Revocation | Deleting the session row immediately invalidates it. Infrequent but always available to the admin. |
| Transport | HTTPS everywhere; HSTS enabled at the edge. |
| Brute force | Rate limiting on the login endpoint and a short lockout after repeated failures. |

### 4.2 Why Server-Side Sessions Over JWTs

- Trivial, instant revocation — delete the row. No token blocklist gymnastics.
- The session lookup naturally yields the user, role, and store used by the authorization module to scope every query (and, later, to drive RLS policies).
- Simpler to reason about for a single-backend deployment; no token-refresh dance in the SPA.

---

## 5. Domain Model

The domain centers on a shared, typed catalog that every store draws from, a centrally-defined taxonomy, and per-store data layered on top.

### 5.1 Core Entities

| Entity | Description |
|---|---|
| Store | A grocery location. May be a producer, a buyer, or both, governed by capability flags. Belongs to the single corporate umbrella. |
| User | A person who logs in. Bound to one store (Store Users) or global (Admin, AP). |
| Catalog Item | A shared, typed product definition (e.g. "Concha", type = bread). Created by any store, immediately global. |
| Product Type | The typing dimension on a catalog item (bread, dessert, …). Enables future expansion. |
| Department / Category | The taxonomy used to organize ordering. Defined centrally by the admin; identical for everyone. |
| Store Menu Item | A store's offer of a catalog item: its price, visibility, availability date, and par level. |
| Order | A buyer's request to a producer for a given service day, composed of order lines. |
| Order Line | One catalog item on an order: ordered qty, received qty, waste qty, price snapshot, line total. |
| Invoice / Statement | Monthly rollup of what one store owes another. |
| Audit Entry | An immutable record of a sensitive change (AP correction, override, close). |

### 5.2 The Settings-Resolution Pattern

One pattern recurs throughout the system, so it is named once here and referenced everywhere it applies. Several settings can be configured by a store (or user) but governed by the admin:

1. The store/user sets a value (a price, a cutoff time, an email preference).
2. The admin can set a global default that applies where no local value exists.
3. The admin can override the local value.
4. The admin can lock the value, preventing the store/user from changing it.

Resolution order when reading an effective value: **admin override (locked) → store/user value → admin global default → system default**. This single rule governs pricing, cutoffs, and email preferences. It is implemented as one shared resolver rather than re-coded per feature.

### 5.3 Catalog & Taxonomy Ownership

- **Taxonomy is centralized.** The admin defines departments and categories; every store sees the same structure. Stores do not create or reorganize taxonomy — they only file their data into it.
- **Catalog is shared and immediate.** Any store can create a catalog item; it becomes globally visible at once. This is acceptable because the tool is internal and trusted. Stores reference an existing entry where one fits, or create a new one when it doesn't.

---

## 6. Capabilities & Feature Flags

### 6.1 Global Feature Flags

The admin controls a registry of global feature flags that turn capabilities of the application on or off. Flags govern features, never catalog or menu structure. They are first-class: a single flag system rather than booleans scattered through the code, so new capabilities can be gated cleanly.

### 6.2 Per-Store Capability Toggles

Whether a store participates as a producer or a buyer is a simple UI toggle, because the real-world constraint is just whether a store has a bakery.

| Capability | Meaning |
|---|---|
| Can bake / produce | Store has a bakery; may publish a menu and receive orders to bake. |
| Can sell | Store may offer items on the marketplace to other stores. |
| Can buy | Store may place orders with producing stores. |

### 6.3 Item Visibility Resolution

Whether a given item is orderable right now resolves through several independent axes, evaluated in order:

1. **Admin disabled?** — the admin can turn off any store's item. If disabled, it is not orderable. (Top-down override.)
2. **Store hidden?** — the store can hide an item from the marketplace even if otherwise valid.
3. **Availability date reached?** — a store can schedule an item to become available in the future; before that date it is not orderable.
4. Otherwise → **available and orderable**.

> This mirrors the pricing-precedence idea: an admin top-down control, then store-level controls, then a time gate. The same evaluate-in-order shape keeps the rules predictable for users and simple to implement.

---

## 7. Pricing

Pricing is an instance of the settings-resolution pattern (§5.2), specialized for money. There are no packaging or unit-breakdown costs — these are bulk bakery items, so the store's price per item is all the system needs.

### 7.1 Price Resolution

| Source | Set by | Precedence |
|---|---|---|
| Locked override | Admin | Highest — wins and prevents store edits. |
| Store price | Store | Used when no locked override exists. |
| Global price | Admin | Default when a store has set no price. |
| **Effective price** | Resolver | `override → store → global` |

### 7.2 Price Snapshotting

> **Lines remember their price.** When an order line is created, the effective price is **copied onto the line** as a snapshot. The line's revenue is computed from this snapshot, never from the live catalog price.
>
> This makes every historical line and invoice immutable and correct even after prices later change, and it is the foundation of trustworthy month-end statements and historical reporting.

---

## 8. Order Lifecycle

There is no draft state. An order is live and freely editable from the moment it is created until the producer's cutoff time for that service day. After cutoff it freezes, the producer bakes and distributes, and the buyer receives and counts. The receiving count is the financial source of truth.

### 8.1 The Flow

1. **Place** — a buyer creates an order against a producer for a service day. It is immediately live.
2. **Edit until cutoff** — the buyer may change quantities freely up to the producer's cutoff time.
3. **Freeze** — at cutoff, the order locks for the day. No further buyer edits.
4. **Aggregate → bake list** — the producer's frozen orders are summed with the producer's own par to form the bake list (§9).
5. **Bake & distribute** — the producer bakes the total, then follows the distribution list telling them how many go to each destination store (§9).
6. **Receive & count** — on delivery, the buying store physically counts what arrived and confirms, adjusting the count if it differs.
7. **Reconcile** — the confirmed received count becomes the billable quantity for that line (§10).
8. **Accrue** — the line's value (received qty × price snapshot) accrues toward the month's invoice between the two stores.
9. **AP corrections** — audited adjustments may be made for genuine errors reported after the fact (§3.2, §10).
10. **Month close** — the month's lines are frozen into immutable statements and settled (§12).

### 8.2 Cutoffs & Reminders

- **Producer cutoff.** Each producing store sets the time by which orders must be in for a service day. Per the settings-resolution pattern, the admin can set a global cutoff and override or lock a store's value.
- **Buyer reminder.** A buyer can opt into a personal reminder so they don't miss a cutoff. Reminders are delivered by email (§14).
- **Cutoff changes mid-month.** A standing reminder re-resolves against the current cutoff whenever the producer changes it; the reminder always reflects the live cutoff.

---

## 9. Bake List & Distribution

This is the producer-facing heart of the operation, and it is two views of the same data: aggregation upward to know what to bake, and breakdown downward to know where it goes.

### 9.1 Par Levels

Par levels describe a target stocking quantity. Two distinct pars exist and must not be conflated:

- **Producer's own par.** The producing store's own production-floor target — what it wants on hand for itself regardless of incoming orders.
- **Buyer's par.** A buying store's restocking target for an item, which informs its own ordering behavior.

### 9.2 The Bake List (Aggregate Up)

After cutoff, for each producing store and service day, the system sums all frozen incoming order quantities per catalog item and adds the producer's own par. The result is a single bake list: for each item, the total quantity to bake that day.

> **Bake list formula**
> `bake quantity (item) = Σ incoming order quantities (item) + producer's own par (item)`

### 9.3 The Distribution List (Break Down)

The distribution list is the bake list inverted. Once the producer has baked the total, the system tells them how to split it back out by destination — "10 of these go to Store A, 16 go to Store B" — so each buyer receives exactly what they ordered. Same underlying lines, presented as a per-destination pick list.

> Aggregate and distribute are the same data, two directions. Orders roll up into the bake total; the bake total breaks back down into deliveries. Building both from one source guarantees they always agree.

---

## 10. Reconciliation & Exceptions

### 10.1 Receiving Is the Moment of Truth

When goods arrive, the buying store counts them and confirms, adjusting the count if it differs from what was ordered or sent. The **buyer's confirmed received count is canonical** and becomes the billable quantity. The producer's "sent" figure is a claim; the receiving confirmation is what the invoice locks onto.

> **Shorting: bill what shipped.** If a producer owed 10 and shipped 8, the buyer receives and confirms 8, and the line bills for 8. There is no credit-back mechanic — the invoice simply reconciles to the received count. Simple and matches how these stores actually operate.

### 10.2 Disagreements & Large Variances

Disputes are expected to be rare among these small, familiar stores, so the system does not impose a heavyweight dispute-resolution workflow. Instead it makes variance visible and trackable:

1. **Threshold** — the admin sets a variance threshold, both absolute (e.g. 10 units) and percentage (e.g. 15% of the line), overridable per store since "large" differs by store size.
2. **Auto-flag** — when received-vs-expected variance crosses the threshold, the line is automatically flagged as an exception; no human has to decide to escalate.
3. **Notify** — flagged lines are emailed as a lightweight daily digest to the admin (and optionally the producer), rather than a blast per incident.
4. **Surface** — a reconciliation/exceptions panel on the dashboard shows flagged lines, the variance, and the trend over time, exposing patterns like a store that chronically shorts.

> **Bill it and flag it.** A flagged line still bills on the buyer's received count. The flag is informational — for follow-up offline — and never blocks the money. The app's job is to provide the receipts, not to adjudicate a small grocer's miscount.

---

## 11. Waste Tracking

Waste tracking is optional and reporting-focused. Both producers and buyers can record, against past orders, quantities that went unsold ("we didn't sell these"). It is a post-order annotation on historical lines — entirely separate from the received-count reconciliation that drives billing.

Each order line therefore carries up to two distinct after-the-fact figures: the received count (billable) and the waste count (informational). Waste feeds the reporting module so the business can see what is being produced but not sold, on both the producing and buying sides.

---

## 12. Invoicing & Monthly Close

Throughout the month, each reconciled line accrues value toward an obligation between two stores. The underlying truth is always directional — every line is unambiguously "Store A sold to Store B." Netting is a presentation layer on top, so the gross numbers are never lost.

### 12.1 Settlement: Netted by Default, Directional on Demand

| View | Behavior | Example |
|---|---|---|
| **Netted (default)** | The two directions between a pair of stores offset; one store pays the difference with one check. | A owes B $500, B owes A $300 → A pays B $200. |
| Directional | Each gross obligation shown separately; settled with separate checks. | A pays B $500; B pays A $300. |

Accounts Payable chooses the view at close time; **netted is the default**. Because storage is always directional, switching views is just a different rollup of the same immutable lines — and the gross, directional sales always feed reporting regardless of how payment is settled.

### 12.2 The Audit Trail

> **Every netted figure is fully expandable.** AP can drill from a single settlement number all the way down to the constituent order lines on both sides — every order, received count, price snapshot, and AP correction (with its actor, timestamp, and reason).
>
> The netted $200 is never a black box: AP can expand it to confirm "$500 across these 14 orders, less $300 across these 9 orders" and verify each. That drill-down is the audit trail.

### 12.3 Closing the Month

1. AP logs in and pulls the amounts due per store relationship, with all audited corrections already applied.
2. AP reviews, optionally toggling between netted and directional, drilling into any figure to verify.
3. AP issues the physical checks offline and records each payment.
4. Closing the month freezes that month's lines and corrections into immutable statements; nothing further can be edited for the closed period.

---

## 13. Reporting Module

The reporting module is a primary reason the system exists. Because everyone operates under one corporate umbrella, the admin needs a complete, granular picture of how every store is doing — as both seller and buyer — to make informed business decisions. More sales is read as growth.

### 13.1 Questions the Module Must Answer

| Question | Scope |
|---|---|
| How well is each store doing? (revenue and volume, over time) | Per store, both as seller and as buyer |
| How much is selling overall? | Across all stores, by period |
| What is selling? (by item, category, product type) | Per store and global |
| What are the top sellers? | At one store, and across all stores |
| What isn't selling? | At one store, and across all stores (dead items) |
| What is being made but wasted? | Producer-side and buyer-side |

### 13.2 Two Performance Lenses

- **As seller (revenue).** What a store earned selling its breads to others — the headline growth metric.
- **As buyer (spend).** What a store ordered and owes — its cost view, useful to AP and to the store's own awareness.

### 13.3 Why the Order Line Is the Analytical Grain

Every report above is an aggregation over the order-line table, sliced by a handful of dimensions. To make this possible, each line denormalizes enough truth at creation time that no report needs to reconstruct history:

- Seller store and buyer store
- Catalog item, its category, and its product type
- Ordered quantity, received quantity, and waste quantity
- Unit price snapshot and computed line total
- Service day / date for time-based slicing

> The reporting requirements dictate the order-line shape. Capturing these fields up front means every present and foreseeable report is a straightforward query, not a schema migration. Charts are rendered with D3.

---

## 14. Notifications & Email

Transactional email is sent through Resend. Notification preferences follow the settings-resolution pattern (§5.2): a user configures their own preferences, and the admin can set globals, override, and lock them.

### 14.1 Triggers

| Notification | Recipient | Purpose |
|---|---|---|
| Order cutoff reminder | Buyer (opt-in) | Nudge to submit an order before the producer's cutoff. |
| Reconciliation exception digest | Admin (and optionally producer) | Daily summary of lines flagged for large variance. |
| Month-close alert | Accounts Payable | Amounts are ready; issue checks and close the month. |

---

## 15. Data Model Summary

Key tables and the relationships among them. The `order_lines` table is intentionally wide (denormalized) to serve reporting and to hold immutable snapshots.

### 15.1 Key Tables

| Table | Key columns (illustrative) | Notes |
|---|---|---|
| `stores` | id, name, can_bake, can_sell, can_buy, cutoff_time, active | Capability toggles + own cutoff. |
| `users` | id, store_id (nullable), role, password_hash, email | store_id null for Admin/AP. |
| `sessions` | id, user_id, expires_at | Server-side session store. |
| `product_types` | id, name | bread, dessert, … |
| `catalog_items` | id, name, product_type_id, created_by_store | Shared, immediately global. |
| `departments` / `categories` | id, name, parent | Central taxonomy, admin-owned. |
| `store_menu_items` | id, store_id, catalog_item_id, price, visible, available_from, par, admin_disabled, price_locked | Per-store offer + visibility axes. |
| `global_prices` / `overrides` | catalog_item_id, price, locked | Feeds price resolver. |
| `feature_flags` | id, key, scope, enabled | Global feature registry. |
| `orders` | id, buyer_store, producer_store, service_day, frozen_at | No draft; frozen at cutoff. |
| `order_lines` | id, order_id, seller_store, buyer_store, catalog_item_id, category_id, product_type_id, ordered_qty, received_qty, waste_qty, unit_price_snapshot, line_total | Wide grain for reporting + immutable snapshot. |
| `reconciliation_flags` | id, order_line_id, variance, threshold, resolved | Exception surfacing. |
| `invoices` / `statements` | id, payer_store, payee_store, month, gross_amount, net_amount, closed_at | Directional truth; netting computed. |
| `payments` | id, statement_id, amount, recorded_by, recorded_at | Offline check records. |
| `audit_entries` | id, actor_id, action, target, before, after, reason, created_at | Immutable; AP corrections, overrides, closes. |

### 15.2 Relationship Highlights

- A store has many users (Store Users); Admin and AP users belong to no store.
- A `store_menu_item` joins one store to one `catalog_item` with that store's price, visibility, and par.
- An order belongs to one buyer store and one producer store; it has many `order_lines`.
- An `order_line` carries denormalized seller/buyer/item/category/type plus a price snapshot for immutable reporting.
- A statement aggregates many `order_lines` between a payer and payee store for a month; payments record offline checks against it.
- Audit entries reference any sensitive change and are never edited or deleted.

---

## 16. Cross-Cutting Concerns

### 16.1 Soft-Delete Everywhere

Nothing financial is ever hard-deleted. Stores, users, catalog items, and menu items are deactivated, not removed, so historical orders, statements, and reports remain intact and correct. Deactivated entities disappear from active selection but persist for history.

### 16.2 Audit Logging

Every sensitive change — AP quantity corrections, admin price overrides and locks, month closes — writes an immutable audit entry capturing who, when, the before/after values, and a reason. The audit log is the backbone of both segregation of duties and the settlement drill-down (§12.2).

### 16.3 The Settings-Resolution Primitive

Pricing, cutoffs, and email preferences all share one resolver (§5.2): admin override (locked) → store/user value → admin global → system default. Implementing it once keeps behavior consistent and predictable for users, and means a fourth governed setting later is a configuration, not new logic.

---

## 17. UI Philosophy

The people using this every day run small grocery stores and bakeries. They are not power users, they are often busy, and they may be entering orders early in the morning or counting deliveries on a loading dock. The interface must be empathetic to them above all else: the measure of a good screen here is how effortless it is to use, not how much it can do.

### 17.1 Guiding Principles

- **Make the common path obvious.** Placing an order, receiving a delivery, and checking what's due are the daily jobs. They should be reachable in one tap from the header and never buried behind menus.
- **Show people only what's theirs.** A Store User should see their store's world and nothing irrelevant. Less on screen means less to misread. Role determines not just permissions but how uncluttered the view feels.
- **Never present a control that will fail.** If a user can't do something, the button isn't there — no dead ends, no permission errors after the fact. The UI's job is to make success the only visible path.
- **Forgiving by design.** Orders are editable until cutoff, so the interface should make editing painless and reassure users about deadlines rather than punish mistakes. Clear, friendly confirmation before anything irreversible (freeze, close).
- **Speak the user's language.** Labels reflect the bakery floor — bake list, par, shorted, received — not database terms. The vocabulary on screen should match the words a panadero already uses.
- **Respect the clock.** Cutoffs are time-pressured moments. Surface the deadline plainly, send the opt-in reminder, and make the countdown legible so no one misses a window because the UI hid it.

### 17.2 What This Looks Like in Practice

| Surface | Empathetic choice |
|---|---|
| Login | Single, calm screen. No clutter, large targets, clear error messaging when a password is wrong. |
| Top header | Persistent. Holds the store's identity, the day's key actions, the cutoff countdown, and notifications — the same anchor on every page. |
| Order entry | Fast quantity entry with sensible defaults from par; running totals visible; deadline always shown; edits effortless until cutoff. |
| Receiving | Built for a loading dock: big inputs, count-and-confirm in one motion, obvious shorted indicator, hard to mis-tap. |
| Bake list / distribution | One clear list to bake from, one clear list to deliver from. No interpretation required. |
| Reports & dashboards | Generous, readable D3 charts with plain-language takeaways, not walls of numbers. The insight, then the detail on demand. |
| AP & close | Guided, reassuring close flow with drill-down always one click away, so settling a month feels confident, not risky. |

> **The north star.** Empathy over feature density. When a tradeoff arises between doing more on a screen and making the screen easier, ease wins. A tired store owner at 5 a.m. should never have to think about how the software works — only about the bread.
