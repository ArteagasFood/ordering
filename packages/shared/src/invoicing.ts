import { z } from 'zod';
import { zCents, zMonth } from './common';
import { SETTLEMENT_VIEWS } from './enums';
import type { Cents, Id, Month } from './common';
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
