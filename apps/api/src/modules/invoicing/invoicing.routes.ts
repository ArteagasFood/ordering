import { Router } from 'express';
import { asyncHandler, body, query, send, created } from '../../lib/http';
import { forbidden } from '../../lib/errors';
import { currentUser, assertRole, isGlobal } from '../../lib/authz';
import {
  zSettlementQuery,
  zRecordPaymentRequest,
  zCloseMonthRequest,
  type SettlementReportDto,
  type StatementLinesDto,
  type PaymentDto,
  type CloseMonthResultDto,
} from '@panaderia/shared';
import {
  buildDirectionalStatements,
  rollupNetted,
  getStatementLines,
  recordPayment,
  closeMonth,
  type DirectionalGross,
} from './invoicing.service';

/**
 * Settlement router (TDD §12). Mounted at `/settlement`. Endpoints are AP/admin facing,
 * with the one drill-down endpoint also reachable by the two stores that a statement is
 * between (so a store can audit its own figures). Every handler resolves the principal
 * and enforces action scope; the authorization module is the security boundary (§3.2).
 */
export const settlementRouter: Router = Router();

/**
 * GET /?month=YYYY-MM&view=netted|directional  (AP + admin)
 *
 * Returns the settlement report for the month: the directional statements AND the
 * netted-pair rollup computed on the fly (TDD §12.1). `view` is presentation only — the
 * client receives both rollups and renders the chosen one; storage is always
 * directional. `closed` reflects whether the month's statements are frozen.
 */
settlementRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'admin', 'accounts_payable');
    const parsed = query(zSettlementQuery, req);
    const month = parsed.month;
    // `.default('netted')` guarantees a value at runtime; pin the type for the report.
    const view: SettlementReportDto['view'] = parsed.view ?? 'netted';

    const { statements, closed } = await buildDirectionalStatements(month);

    // Net the directional grosses on the fly. Each statement is a directional gross.
    const grosses: DirectionalGross[] = statements.map((s) => ({
      payerStoreId: s.payerStoreId,
      payeeStoreId: s.payeeStoreId,
      grossCents: s.grossAmountCents,
    }));
    const nameById = new Map(statements.flatMap((s) => [
      [s.payerStoreId, s.payerStoreName] as const,
      [s.payeeStoreId, s.payeeStoreName] as const,
    ]));
    const pairs = rollupNetted(grosses, (id) => nameById.get(id) ?? '');

    const report: SettlementReportDto = { month, view, closed, pairs, directional: statements };
    send<SettlementReportDto>(res, report);
  }),
);

/**
 * GET /statements/:id/lines  (AP + admin, or either store the statement is between)
 *
 * The drill-down audit trail (TDD §12.2): the constituent order lines plus any AP
 * corrections. A store user may view only statements that involve their own store.
 */
settlementRouter.get(
  '/statements/:id/lines',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const result = await getStatementLines(req.params.id ?? '');

    if (!isGlobal(user)) {
      // A store user may audit only a statement their own store is a party to.
      const { payerStoreId, payeeStoreId } = result.statement;
      if (user.storeId !== payerStoreId && user.storeId !== payeeStoreId) {
        throw forbidden('You can only view statements your store is a party to.');
      }
    }

    send<StatementLinesDto>(res, result);
  }),
);

/**
 * POST /payments  (AP only)
 *
 * Record an offline check against a statement and write the mandatory audit entry
 * (TDD §12.3 step 3, §16.2).
 */
settlementRouter.post(
  '/payments',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'accounts_payable');
    const input = body(zRecordPaymentRequest, req);
    // `reference` carries a `.default('')`, so it is always present at runtime.
    const payment = await recordPayment(user.id, {
      statementId: input.statementId,
      amountCents: input.amountCents,
      reference: input.reference ?? '',
    });
    created<PaymentDto>(res, payment);
  }),
);

/**
 * POST /close  (AP only)
 *
 * Materialize and freeze the month's directional statements, then audit the close
 * (TDD §12.3 step 4, §16.2). Re-closing a frozen month is rejected with 409.
 */
settlementRouter.post(
  '/close',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    assertRole(user, 'accounts_payable');
    const { month } = body(zCloseMonthRequest, req);
    const result = await closeMonth(user.id, month);
    send<CloseMonthResultDto>(res, result);
  }),
);
