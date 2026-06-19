import { useEffect, useState } from 'react';
import type { ReportQuery, ReportSummaryDto } from '@panaderia/shared';
import { api, ApiError } from '@/lib/api-client';

/** The state of an in-flight (or settled) report request. */
interface ReportState {
  data: ReportSummaryDto | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch the report summary for the given query, re-fetching whenever the query changes.
 *
 * A monotonically increasing request token guards against out-of-order responses: when a
 * user flips the lens or date quickly, only the latest request is allowed to write state,
 * so a slow earlier response can never overwrite a newer one (the classic stale-closure /
 * race fix). The server is the security boundary; an out-of-scope `storeId` simply comes
 * back ignored or empty, so the client need not pre-validate scope.
 */
export function useReportSummary(queryParams: ReportQuery): ReportState {
  const [state, setState] = useState<ReportState>({ data: null, loading: true, error: null });

  // Serialize the params into the dependency so the effect re-runs on any change.
  const search = buildSearch(queryParams);

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .get<ReportSummaryDto>(`/reports/summary?${search}`)
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!active) return;
        const message =
          err instanceof ApiError ? err.message : 'Could not load the report. Please try again.';
        setState({ data: null, loading: false, error: message });
      });
    return () => {
      active = false;
    };
  }, [search]);

  return state;
}

/** Build the URL search string for a report query, omitting an unset store filter. */
export function buildSearch(q: ReportQuery): string {
  const params = new URLSearchParams({ from: q.from, to: q.to, lens: q.lens });
  if (q.storeId) params.set('storeId', q.storeId);
  return params.toString();
}
