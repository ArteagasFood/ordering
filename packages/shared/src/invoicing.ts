import { z } from 'zod';
import { zCents, zMonth } from './common';
import { SETTLEMENT_VIEWS } from './enums';
import type { Cents, Id, IsoDate, Month } from './common';
import type { SettlementView } from './enums';

/**
 * Invoicing & monthly close contract (TDD §12). Storage is always directional —
 * every line is unambiguously "Store A sold to Store B." Netting is a presentation
 * rollup chosen at close time; netted is the default. Every netted figure is fully
 * expandable down to its constituent order lines (TDD §12.2 — the audit trail).
 */

/** A directional obligation: payer owes payee for a month. */
export interface StatementDto {
  id: Id;
  payerStoreId: Id;
  payerStoreName: string;
  payeeStoreId: Id;
  payeeStoreName: string;
  month: Month;
  grossAmountCents: Cents;
  closedAt: string | null;
}

/** A netted pair view: the single check one store writes the other (TDD §12.1). */
export interface NettedPairDto {
  storeAId: Id;
  storeAName: string;
  storeBId: Id;
  storeBName: string;
  /** A→B gross for the month. */
  aOwesBCents: Cents;
  /** B→A gross for the month. */
  bOwesACents: Cents;
  /** Net: who pays whom and how much (the single-check figure). */
  netPayerStoreId: Id | null;
  netPayeeStoreId: Id | null;
  netAmountCents: Cents;
}

export interface SettlementReportDto {
  month: Month;
  view: SettlementView;
  closed: boolean;
  pairs: NettedPairDto[];
  directional: StatementDto[];
}

/**
 * One AP correction (from the audit log) that touched a constituent line of a
 * statement (TDD §12.2). Carries the actor, timestamp, before/after, and reason so the
 * drill-down is a complete audit trail — the netted figure is never a black box.
 */
export interface LineCorrectionDto {
  actorId: Id;
  /** ISO timestamp the correction was written. */
  at: string;
  before: unknown;
  after: unknown;
  reason: string;
}

/**
 * A single constituent order line of a directional statement, for the drill-down audit
 * trail (TDD §12.2): the item, the service day, the billable received count, the price
 * snapshot, the computed line total, and any AP corrections that targeted this line.
 */
export interface StatementLineDto {
  orderLineId: Id;
  orderId: Id;
  catalogItemName: string;
  serviceDay: IsoDate;
  orderedQty: number;
  /** Buyer's confirmed received count (the billable quantity); null until received. */
  receivedQty: number | null;
  unitPriceSnapshotCents: Cents;
  lineTotalCents: Cents;
  corrections: LineCorrectionDto[];
}

/** Drill-down response: the directional statement plus its constituent lines (TDD §12.2). */
export interface StatementLinesDto {
  statement: StatementDto;
  lines: StatementLineDto[];
  /** Σ of the lines' lineTotalCents — must equal the statement's gross for the month. */
  totalCents: Cents;
}

/** A recorded offline check payment against a statement (TDD §12.3 step 3). */
export interface PaymentDto {
  id: Id;
  statementId: Id;
  amountCents: Cents;
  reference: string;
  recordedBy: Id;
  recordedAt: string;
}

/** Result of closing a month: how many directional statements were frozen. */
export interface CloseMonthResultDto {
  month: Month;
  closedAt: string;
  statementsClosed: number;
}

export const zSettlementQuery = z.object({
  month: zMonth,
  view: z.enum(SETTLEMENT_VIEWS).default('netted'),
});
export type SettlementQuery = z.infer<typeof zSettlementQuery>;

/** AP: record an offline check payment against a statement (TDD §12.3 step 3). */
export const zRecordPaymentRequest = z.object({
  statementId: z.string().uuid(),
  amountCents: zCents,
  /** Optional reference, e.g. check number. */
  reference: z.string().max(120).default(''),
});
export type RecordPaymentRequest = z.infer<typeof zRecordPaymentRequest>;

/** AP: close a month, freezing its lines and corrections into immutable statements. */
export const zCloseMonthRequest = z.object({
  month: zMonth,
});
export type CloseMonthRequest = z.infer<typeof zCloseMonthRequest>;
