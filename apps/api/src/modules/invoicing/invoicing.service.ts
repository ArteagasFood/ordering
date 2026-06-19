import { and, eq, sql, inArray } from 'drizzle-orm';
import type {
  NettedPairDto,
  StatementDto,
  StatementLineDto,
  StatementLinesDto,
  CloseMonthResultDto,
  PaymentDto,
  Month,
  Id,
} from '@panaderia/shared';
import { db } from '../../db/client';
import type { Db } from '../../db/client';
import {
  orders,
  orderLines,
  statements,
  payments,
  stores,
  catalogItems,
  auditEntries,
} from '../../db/schema';
import { writeAudit } from '../../lib/audit';
import { conflict, notFound } from '../../lib/errors';

/**
 * A database connection that is either the pool (`db`) or a transaction handle. Drizzle
 * types a transaction handle as a structurally distinct `PgTransaction`, so we accept
 * the union everywhere a function must run inside *or* outside a transaction, and narrow
 * to `Db` only at the boundary of the shared lib helpers that declare a `Db` parameter.
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Conn = Db | Tx;

/** Narrow a Conn to the `Db` shape the shared lib helpers declare (both run the query). */
const asDb = (conn: Conn): Db => conn as Db;

/**
 * Invoicing & monthly-close service (TDD §12).
 *
 * The model's one invariant: **storage/truth is always directional** — a line is
 * unambiguously "seller sold to buyer", so a monthly obligation is always "payer owes
 * payee". Netting (TDD §12.1) is never stored; it is a presentation rollup computed on
 * the fly from the two directional grosses of an unordered pair, so the directional
 * gross figures are never lost and any netted number expands back to its lines
 * (§12.2). Pure functions below carry that arithmetic so it is unit-testable without a
 * database; the DB-backed functions assemble the report from `order_lines`.
 */

// ===========================================================================
// Pure functions (no I/O) — unit-tested in invoicing.service.test.ts
// ===========================================================================

/**
 * A directional gross obligation between two stores for a month: `payer` owes `payee`
 * `grossCents` (which is `Σ lineTotalCents` over the billable lines where seller=payee,
 * buyer=payer). This is the immutable truth from which netting is derived.
 */
export interface DirectionalGross {
  payerStoreId: Id;
  payeeStoreId: Id;
  grossCents: number;
}

/**
 * Net a single unordered pair's two directional grosses into the one-check figure
 * (TDD §12.1): if A owes B `aOwesB` and B owes A `bOwesA`, the party with the larger
 * gross pays the difference and the other pays nothing.
 *
 * Preconditions: `aOwesB`, `bOwesA` are non-negative integer cents; `storeAId` and
 * `storeBId` identify the unordered pair (order between them is irrelevant to the net).
 * Postconditions: returns the directional grosses unchanged plus the net. When the two
 * grosses are equal (including both zero) the obligations cancel exactly:
 * `netPayer = netPayee = null` and `netAmountCents = 0`. Otherwise `netPayer` is the
 * store with the larger gross and `netAmountCents = |aOwesB − bOwesA|`.
 *
 * Example (TDD §12.1): A owes B 500, B owes A 300 → A pays B 200.
 * Complexity: O(1).
 */
export function netPair(
  storeAId: Id,
  storeAName: string,
  storeBId: Id,
  storeBName: string,
  aOwesB: number,
  bOwesA: number,
): NettedPairDto {
  const diff = aOwesB - bOwesA;
  let netPayerStoreId: Id | null = null;
  let netPayeeStoreId: Id | null = null;
  if (diff > 0) {
    // A owes B more than B owes A → A writes the single check to B.
    netPayerStoreId = storeAId;
    netPayeeStoreId = storeBId;
  } else if (diff < 0) {
    netPayerStoreId = storeBId;
    netPayeeStoreId = storeAId;
  }
  return {
    storeAId,
    storeAName,
    storeBId,
    storeBName,
    aOwesBCents: aOwesB,
    bOwesACents: bOwesA,
    netPayerStoreId,
    netPayeeStoreId,
    netAmountCents: Math.abs(diff),
  };
}

/** A stable key for an unordered pair of store ids (order-independent). */
function unorderedPairKey(x: Id, y: Id): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

/**
 * Roll a set of directional grosses up into the netted-pair presentation (TDD §12.1).
 *
 * Preconditions: each `DirectionalGross` names a distinct payer≠payee with a gross in
 * non-negative integer cents; at most one gross exists per ordered (payer,payee). A
 * store-name lookup must resolve every id appearing in `grosses`.
 * Postconditions: returns exactly one `NettedPairDto` per unordered pair that has any
 * nonzero gross in either direction. For each pair the lexicographically smaller store
 * id is assigned "A" so the rollup is deterministic; `aOwesBCents`/`bOwesACents` carry
 * the two directional grosses and the net is computed by {@link netPair}. Pairs whose
 * two grosses are both zero are omitted.
 * Complexity: O(n) over the input grosses (plus the cost of name lookups).
 */
export function rollupNetted(
  grosses: readonly DirectionalGross[],
  storeName: (id: Id) => string,
): NettedPairDto[] {
  // Accumulate the two directions of each unordered pair.
  interface PairAccum {
    aId: Id;
    bId: Id;
    aOwesB: number;
    bOwesA: number;
  }
  const pairs = new Map<string, PairAccum>();
  for (const g of grosses) {
    if (g.grossCents === 0) continue;
    const key = unorderedPairKey(g.payerStoreId, g.payeeStoreId);
    // Canonical A = the lexicographically smaller id, so the assignment is stable.
    const [aId, bId] =
      g.payerStoreId < g.payeeStoreId
        ? [g.payerStoreId, g.payeeStoreId]
        : [g.payeeStoreId, g.payerStoreId];
    let acc = pairs.get(key);
    if (!acc) {
      acc = { aId, bId, aOwesB: 0, bOwesA: 0 };
      pairs.set(key, acc);
    }
    // payer owes payee: attribute the gross to whichever direction this is.
    if (g.payerStoreId === acc.aId) acc.aOwesB += g.grossCents;
    else acc.bOwesA += g.grossCents;
  }

  const out: NettedPairDto[] = [];
  for (const acc of pairs.values()) {
    if (acc.aOwesB === 0 && acc.bOwesA === 0) continue;
    out.push(
      netPair(acc.aId, storeName(acc.aId), acc.bId, storeName(acc.bId), acc.aOwesB, acc.bOwesA),
    );
  }
  return out;
}

// ===========================================================================
// DB-backed assembly
// ===========================================================================

/** Month is read from a line's serviceDay (YYYY-MM-DD → YYYY-MM) via `to_char`. */
const monthOf = sql`to_char(${orderLines.serviceDay}, 'YYYY-MM')`;

/**
 * Compute the directional gross obligations for a month directly from the order lines
 * (TDD §12). A line accrues toward an obligation only once its order is `received` (the
 * receiving count is the financial source of truth — §8.1 step 8, §10.1). For each
 * such line: payee = sellerStoreId, payer = buyerStoreId, gross += lineTotalCents.
 *
 * Returns one row per ordered (payer,payee) with a nonzero summed gross for the month.
 */
async function computeDirectionalGrosses(month: Month, dbh: Conn = db): Promise<DirectionalGross[]> {
  const rows = await dbh
    .select({
      payerStoreId: orderLines.buyerStoreId,
      payeeStoreId: orderLines.sellerStoreId,
      grossCents: sql<number>`coalesce(sum(${orderLines.lineTotalCents}), 0)::int`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(monthOf, month), eq(orders.status, 'received')))
    .groupBy(orderLines.buyerStoreId, orderLines.sellerStoreId);

  return rows.filter((r) => r.grossCents !== 0);
}

/** Load (id → name) for the given store ids in one query. */
async function loadStoreNames(ids: Id[], dbh: Conn = db): Promise<Map<Id, string>> {
  if (ids.length === 0) return new Map();
  const rows = await dbh
    .select({ id: stores.id, name: stores.name })
    .from(stores)
    .where(inArray(stores.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * Build the directional `StatementDto` rows for a month (TDD §12). Prefers a frozen,
 * closed `statements` row when one exists (after close the figures are immutable —
 * §12.3 step 4); otherwise synthesizes the live figure from the order lines. Either
 * way there is exactly one row per payer→payee pair with a nonzero gross.
 *
 * Returns the statements alongside `closed` = whether the month has been closed.
 */
export async function buildDirectionalStatements(
  month: Month,
  dbh: Conn = db,
): Promise<{ statements: StatementDto[]; closed: boolean }> {
  // Frozen statements take precedence once the month is closed.
  const frozen = await dbh.select().from(statements).where(eq(statements.month, month));
  const closed = frozen.length > 0 && frozen.every((s) => s.closedAt !== null);

  if (closed) {
    const ids = new Set<Id>();
    for (const s of frozen) {
      ids.add(s.payerStoreId);
      ids.add(s.payeeStoreId);
    }
    const names = await loadStoreNames([...ids], dbh);
    const out: StatementDto[] = frozen
      .filter((s) => s.grossAmountCents !== 0)
      .map((s) => ({
        id: s.id,
        payerStoreId: s.payerStoreId,
        payerStoreName: names.get(s.payerStoreId) ?? '',
        payeeStoreId: s.payeeStoreId,
        payeeStoreName: names.get(s.payeeStoreId) ?? '',
        month: s.month,
        grossAmountCents: s.grossAmountCents,
        closedAt: s.closedAt ? s.closedAt.toISOString() : null,
      }));
    return { statements: out, closed: true };
  }

  // Open month: synthesize live figures from the lines.
  const grosses = await computeDirectionalGrosses(month, dbh);
  const ids = new Set<Id>();
  for (const g of grosses) {
    ids.add(g.payerStoreId);
    ids.add(g.payeeStoreId);
  }
  const names = await loadStoreNames([...ids], dbh);
  const out: StatementDto[] = grosses.map((g) => ({
    // A synthetic, stable id encoding the directional pair + month, since no row exists
    // yet. The drill-down endpoint parses it back to (payer, payee, month).
    id: syntheticStatementId(g.payerStoreId, g.payeeStoreId, month),
    payerStoreId: g.payerStoreId,
    payerStoreName: names.get(g.payerStoreId) ?? '',
    payeeStoreId: g.payeeStoreId,
    payeeStoreName: names.get(g.payeeStoreId) ?? '',
    month,
    grossAmountCents: g.grossCents,
    closedAt: null,
  }));
  return { statements: out, closed: false };
}

/** Encode a directional statement that has no persisted row yet (open month). */
function syntheticStatementId(payerId: Id, payeeId: Id, month: Month): string {
  return `directional:${payerId}:${payeeId}:${month}`;
}

/**
 * Resolve a statement id — whether a real persisted UUID or a synthetic open-month id —
 * to its (payerStoreId, payeeStoreId, month). Throws 404 if a UUID does not exist.
 */
export async function resolveStatement(
  statementId: string,
  dbh: Conn = db,
): Promise<{ statement: StatementDto; payerStoreId: Id; payeeStoreId: Id; month: Month }> {
  if (statementId.startsWith('directional:')) {
    const [, payerStoreId, payeeStoreId, month] = statementId.split(':');
    if (!payerStoreId || !payeeStoreId || !month) throw notFound('Statement not found.');
    const grosses = await computeDirectionalGrosses(month, dbh);
    const match = grosses.find(
      (g) => g.payerStoreId === payerStoreId && g.payeeStoreId === payeeStoreId,
    );
    const names = await loadStoreNames([payerStoreId, payeeStoreId], dbh);
    return {
      statement: {
        id: statementId,
        payerStoreId,
        payerStoreName: names.get(payerStoreId) ?? '',
        payeeStoreId,
        payeeStoreName: names.get(payeeStoreId) ?? '',
        month,
        grossAmountCents: match ? match.grossCents : 0,
        closedAt: null,
      },
      payerStoreId,
      payeeStoreId,
      month,
    };
  }

  const [row] = await dbh.select().from(statements).where(eq(statements.id, statementId));
  if (!row) throw notFound('Statement not found.');
  const names = await loadStoreNames([row.payerStoreId, row.payeeStoreId], dbh);
  return {
    statement: {
      id: row.id,
      payerStoreId: row.payerStoreId,
      payerStoreName: names.get(row.payerStoreId) ?? '',
      payeeStoreId: row.payeeStoreId,
      payeeStoreName: names.get(row.payeeStoreId) ?? '',
      month: row.month,
      grossAmountCents: row.grossAmountCents,
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    },
    payerStoreId: row.payerStoreId,
    payeeStoreId: row.payeeStoreId,
    month: row.month,
  };
}

/**
 * The drill-down audit trail for a directional statement (TDD §12.2): the constituent
 * billable order lines (seller=payee, buyer=payer, in the statement's month, order
 * received) with item, service day, received count, price snapshot, and line total,
 * plus any AP corrections from the audit log that targeted those exact lines.
 */
export async function getStatementLines(
  statementId: string,
  dbh: Conn = db,
): Promise<StatementLinesDto> {
  const { statement, payerStoreId, payeeStoreId, month } = await resolveStatement(statementId, dbh);

  const lineRows = await dbh
    .select({
      orderLineId: orderLines.id,
      orderId: orderLines.orderId,
      catalogItemName: catalogItems.name,
      serviceDay: orderLines.serviceDay,
      orderedQty: orderLines.orderedQty,
      receivedQty: orderLines.receivedQty,
      unitPriceSnapshotCents: orderLines.unitPriceSnapshotCents,
      lineTotalCents: orderLines.lineTotalCents,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(catalogItems, eq(catalogItems.id, orderLines.catalogItemId))
    .where(
      and(
        eq(monthOf, month),
        eq(orders.status, 'received'),
        eq(orderLines.sellerStoreId, payeeStoreId),
        eq(orderLines.buyerStoreId, payerStoreId),
      ),
    )
    .orderBy(orderLines.serviceDay);

  // Fetch AP corrections targeting any of these lines (target = 'order_line:<id>').
  const targets = lineRows.map((l) => `order_line:${l.orderLineId}`);
  const correctionsByLine = new Map<Id, StatementLineDto['corrections']>();
  if (targets.length > 0) {
    const auditRows = await dbh
      .select({
        target: auditEntries.target,
        actorId: auditEntries.actorId,
        before: auditEntries.before,
        after: auditEntries.after,
        reason: auditEntries.reason,
        createdAt: auditEntries.createdAt,
      })
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.action, 'ap_quantity_correction'),
          inArray(auditEntries.target, targets),
        ),
      )
      .orderBy(auditEntries.createdAt);
    for (const a of auditRows) {
      const lineId = a.target.slice('order_line:'.length);
      const list = correctionsByLine.get(lineId) ?? [];
      list.push({
        actorId: a.actorId,
        at: a.createdAt.toISOString(),
        before: a.before,
        after: a.after,
        reason: a.reason,
      });
      correctionsByLine.set(lineId, list);
    }
  }

  const lines: StatementLineDto[] = lineRows.map((l) => ({
    orderLineId: l.orderLineId,
    orderId: l.orderId,
    catalogItemName: l.catalogItemName,
    serviceDay: l.serviceDay,
    orderedQty: l.orderedQty,
    receivedQty: l.receivedQty,
    unitPriceSnapshotCents: l.unitPriceSnapshotCents,
    lineTotalCents: l.lineTotalCents,
    corrections: correctionsByLine.get(l.orderLineId) ?? [],
  }));

  const totalCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  return { statement, lines, totalCents };
}

/**
 * Record an offline check payment against a statement (TDD §12.3 step 3) and write the
 * mandatory `payment_recorded` audit entry, atomically. The statement must be a
 * persisted row (you cannot pay an un-materialized open-month figure); a synthetic id
 * is rejected as not found.
 */
export async function recordPayment(
  actorId: Id,
  input: { statementId: string; amountCents: number; reference: string },
  dbh: Conn = db,
): Promise<PaymentDto> {
  if (input.statementId.startsWith('directional:')) {
    throw conflict('Close the month before recording payments against it.');
  }
  return asDb(dbh).transaction(async (tx) => {
    const [stmt] = await tx.select().from(statements).where(eq(statements.id, input.statementId));
    if (!stmt) throw notFound('Statement not found.');

    const [payment] = await tx
      .insert(payments)
      .values({
        statementId: input.statementId,
        amountCents: input.amountCents,
        reference: input.reference,
        recordedBy: actorId,
      })
      .returning();
    if (!payment) throw notFound('Statement not found.');

    await writeAudit(
      {
        actorId,
        action: 'payment_recorded',
        target: `statement:${input.statementId}`,
        after: { amountCents: input.amountCents, reference: input.reference },
        reason: input.reference
          ? `Recorded offline check ${input.reference}`
          : 'Recorded offline check payment',
      },
      asDb(tx),
    );

    return {
      id: payment.id,
      statementId: payment.statementId,
      amountCents: payment.amountCents,
      reference: payment.reference,
      recordedBy: payment.recordedBy,
      recordedAt: payment.recordedAt.toISOString(),
    };
  });
}

/**
 * Close a month (TDD §12.3 step 4): materialize the directional grosses into
 * `statements` rows and stamp `closedAt = now`, freezing the period. Idempotency is
 * deliberately one-shot: a month already closed is rejected with 409 (re-close is not
 * allowed; the period is immutable). Writes a `month_close` audit entry.
 *
 * Postconditions: every payer→payee pair with a nonzero gross for the month has exactly
 * one `statements` row carrying its frozen `grossAmountCents` and a non-null `closedAt`.
 */
export async function closeMonth(
  actorId: Id,
  month: Month,
  dbh: Conn = db,
): Promise<CloseMonthResultDto> {
  return asDb(dbh).transaction(async (tx) => {
    // Reject re-close: if any statement for the month is already closed, the period is
    // immutable (TDD §12.3 step 4).
    const existing = await tx.select().from(statements).where(eq(statements.month, month));
    if (existing.some((s) => s.closedAt !== null)) {
      throw conflict(`Month ${month} is already closed.`);
    }

    const grosses = await computeDirectionalGrosses(month, tx);
    const closedAt = new Date();

    for (const g of grosses) {
      // Upsert the directional row, freezing the gross and stamping the close time.
      await tx
        .insert(statements)
        .values({
          payerStoreId: g.payerStoreId,
          payeeStoreId: g.payeeStoreId,
          month,
          grossAmountCents: g.grossCents,
          closedAt,
          updatedAt: closedAt,
        })
        .onConflictDoUpdate({
          target: [statements.payerStoreId, statements.payeeStoreId, statements.month],
          set: { grossAmountCents: g.grossCents, closedAt, updatedAt: closedAt },
        });
    }

    await writeAudit(
      {
        actorId,
        action: 'month_close',
        target: `month:${month}`,
        after: { month, statementsClosed: grosses.length, closedAt: closedAt.toISOString() },
        reason: `Closed month ${month}`,
      },
      asDb(tx),
    );

    return {
      month,
      closedAt: closedAt.toISOString(),
      statementsClosed: grosses.length,
    };
  });
}
