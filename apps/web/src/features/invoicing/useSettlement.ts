import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api-client';
import type {
  SettlementReportDto,
  StatementLinesDto,
  PaymentDto,
  CloseMonthResultDto,
  RecordPaymentRequest,
  SettlementView,
} from '@panaderia/shared';

/**
 * Data hooks for the settlement feature (TDD §12). All API access goes through the
 * shared client (paths relative to `/api` + the `/settlement` mount). These hooks keep
 * the page component declarative: it reads `report`, toggles `view`, and calls the
 * mutators, which re-fetch on success so the screen always reflects the truth.
 */

export interface SettlementState {
  report: SettlementReportDto | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Load the settlement report for a month + view; re-fetches when either changes. */
export function useSettlementReport(month: string, view: SettlementView): SettlementState {
  const [report, setReport] = useState<SettlementReportDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get<SettlementReportDto>(`/settlement?month=${month}&view=${view}`)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : 'Could not load the settlement report.');
          setReport(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, view, nonce]);

  return { report, loading, error, reload };
}

/** Fetch the constituent lines (the drill-down audit trail, TDD §12.2) for a statement. */
export function fetchStatementLines(statementId: string): Promise<StatementLinesDto> {
  return api.get<StatementLinesDto>(`/settlement/statements/${statementId}/lines`);
}

/** Record an offline check payment (AP only, TDD §12.3 step 3). */
export function recordPayment(input: RecordPaymentRequest): Promise<PaymentDto> {
  return api.post<PaymentDto>('/settlement/payments', input);
}

/** Close (freeze) a month (AP only, TDD §12.3 step 4). */
export function closeMonth(month: string): Promise<CloseMonthResultDto> {
  return api.post<CloseMonthResultDto>('/settlement/close', { month });
}
