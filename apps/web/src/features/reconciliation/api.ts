import { api } from '@/lib/api-client';
import type {
  ReconciliationFlagDto,
  VarianceThresholdDto,
  SetVarianceThresholdRequest,
} from '@panaderia/shared';

/**
 * Thin typed wrappers over the reconciliation endpoints, kept in one place so the pages
 * never hand-write URLs. Paths are relative to the router's `/reconciliation` mount.
 */

/** List exceptions, optionally narrowed to resolved/unresolved. */
export function fetchFlags(resolved?: boolean): Promise<ReconciliationFlagDto[]> {
  const qs = resolved === undefined ? '' : `?resolved=${resolved}`;
  return api.get<ReconciliationFlagDto[]>(`/reconciliation/flags${qs}`);
}

/** Mark a single exception resolved/unresolved. Returns 204 (no body). */
export function resolveFlag(id: string, resolved: boolean): Promise<void> {
  return api.patch<void>(`/reconciliation/flags/${id}`, { resolved });
}

/** The global default plus any per-store overrides. */
export function fetchThresholds(): Promise<VarianceThresholdDto[]> {
  return api.get<VarianceThresholdDto[]>('/reconciliation/thresholds');
}

/** Upsert the global default (storeId null) or a per-store override. */
export function saveThreshold(input: SetVarianceThresholdRequest): Promise<VarianceThresholdDto> {
  return api.post<VarianceThresholdDto>('/reconciliation/thresholds', input);
}
