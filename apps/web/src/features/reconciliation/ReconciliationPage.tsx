import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, RotateCcw } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ReconciliationFlagDto } from '@panaderia/shared';
import { fetchFlags, resolveFlag } from './api';
import { FlagsTrendChart } from './FlagsTrendChart';

/**
 * The reconciliation / exceptions panel (TDD §10.2 step 4). It surfaces flagged lines
 * with their variance and a clear "shorted" indicator, lets the operator filter open vs
 * resolved exceptions, resolve a flag once it has been followed up offline, and see a
 * flags-per-day trend so a store that chronically shorts becomes visible.
 *
 * The page never blocks billing — a flag is informational (§10.2 "bill it and flag it").
 */

type FilterMode = 'open' | 'resolved' | 'all';

const FILTERS: { mode: FilterMode; label: string }[] = [
  { mode: 'open', label: 'Open' },
  { mode: 'resolved', label: 'Resolved' },
  { mode: 'all', label: 'All' },
];

/** Map a filter mode to the optional `resolved` query parameter. */
function resolvedParam(mode: FilterMode): boolean | undefined {
  if (mode === 'open') return false;
  if (mode === 'resolved') return true;
  return undefined;
}

export function ReconciliationPage() {
  const [mode, setMode] = useState<FilterMode>('open');
  const [flags, setFlags] = useState<ReconciliationFlagDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFlags(resolvedParam(mode))
      .then((rows) => {
        if (!cancelled) setFlags(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load exceptions.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // The trend is most informative across all exceptions, not just the current filter.
  const [allFlags, setAllFlags] = useState<ReconciliationFlagDto[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchFlags(undefined)
      .then((rows) => {
        if (!cancelled) setAllFlags(rows);
      })
      .catch(() => {
        /* trend is a nicety; ignore its load failure */
      });
    return () => {
      cancelled = true;
    };
  }, [flags]);

  const openCount = useMemo(() => allFlags.filter((f) => !f.resolved).length, [allFlags]);

  async function onToggleResolved(flag: ReconciliationFlagDto) {
    setBusyId(flag.id);
    setError(null);
    try {
      await resolveFlag(flag.id, !flag.resolved);
      // Re-fetch the current view so the row leaves/stays per the active filter.
      const rows = await fetchFlags(resolvedParam(mode));
      setFlags(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that exception.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <AlertTriangle className="h-6 w-6 text-primary" />
          Reconciliation exceptions
        </h1>
        <p className="text-muted-foreground">
          Lines where the received count differed enough from the order to flag. Every
          flagged line still bills on the received count — this is for follow-up, not a
          dispute. {openCount > 0 && <span className="font-medium text-foreground">{openCount} open.</span>}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trend</CardTitle>
          <CardDescription>Flags per service day — a recurring spike means a store that chronically shorts.</CardDescription>
        </CardHeader>
        <CardContent>
          <FlagsTrendChart flags={allFlags} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Flagged lines</CardTitle>
            <CardDescription>Filter by status and resolve once followed up offline.</CardDescription>
          </div>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <Button
                key={f.mode}
                size="sm"
                variant={mode === f.mode ? 'default' : 'outline'}
                onClick={() => setMode(f.mode)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading exceptions…</p>
          ) : flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No exceptions here. Nothing to follow up on.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Day</th>
                    <th className="py-2 pr-4 font-medium">Item</th>
                    <th className="py-2 pr-4 font-medium">Producer → Buyer</th>
                    <th className="py-2 pr-4 text-right font-medium">Ordered</th>
                    <th className="py-2 pr-4 text-right font-medium">Received</th>
                    <th className="py-2 pr-4 text-right font-medium">Variance</th>
                    <th className="py-2 pr-4 text-right font-medium">%</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {flags.map((f) => (
                    <FlagRow key={f.id} flag={f} busy={busyId === f.id} onToggle={onToggleResolved} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** One exception row, with a directional short/over indicator and a resolve toggle. */
function FlagRow({
  flag,
  busy,
  onToggle,
}: {
  flag: ReconciliationFlagDto;
  busy: boolean;
  onToggle: (flag: ReconciliationFlagDto) => void;
}) {
  const short = flag.variance < 0;
  const over = flag.variance > 0;
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 whitespace-nowrap">{flag.serviceDay}</td>
      <td className="py-2 pr-4">{flag.catalogItemName}</td>
      <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
        {flag.producerStoreName} → {flag.buyerStoreName}
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">{flag.orderedQty}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{flag.receivedQty}</td>
      <td
        className={cn(
          'py-2 pr-4 text-right tabular-nums font-medium',
          short && 'text-destructive',
          over && 'text-primary',
        )}
      >
        <span className="inline-flex items-center justify-end gap-1">
          {short && <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
          {over && <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />}
          {flag.variance > 0 ? `+${flag.variance}` : flag.variance}
          {short && <span className="sr-only">shorted</span>}
        </span>
      </td>
      <td className="py-2 pr-4 text-right tabular-nums">{(flag.variancePct * 100).toFixed(0)}%</td>
      <td className="py-2 pr-4">
        {flag.resolved ? (
          <span className="text-muted-foreground">Resolved</span>
        ) : short ? (
          <span className="font-medium text-destructive">Shorted</span>
        ) : (
          <span className="font-medium text-primary">Over</span>
        )}
      </td>
      <td className="py-2 text-right">
        <Button
          size="sm"
          variant={flag.resolved ? 'outline' : 'default'}
          disabled={busy}
          onClick={() => onToggle(flag)}
        >
          {flag.resolved ? (
            <>
              <RotateCcw className="h-3.5 w-3.5" /> Reopen
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" /> Resolve
            </>
          )}
        </Button>
      </td>
    </tr>
  );
}
