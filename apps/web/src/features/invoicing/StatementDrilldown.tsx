import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, ShieldAlert } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { cn, formatCents } from '@/lib/utils';
import type { StatementLinesDto, StatementLineDto } from '@panaderia/shared';
import { fetchStatementLines } from './useSettlement';

/**
 * The drill-down audit trail for a single directional statement (TDD §12.2). "Every
 * netted figure is fully expandable" — AP expands a settlement number to confirm it
 * across the constituent order lines, each with its received count, price snapshot,
 * line total, and any AP corrections (actor, time, reason). The figure is never a
 * black box.
 */
export function StatementDrilldown({ statementId }: { statementId: string }) {
  const [data, setData] = useState<StatementLinesDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchStatementLines(statementId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof ApiError ? e.message : 'Could not load the order lines.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [statementId]);

  if (loading) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">Opening the audit trail…</p>;
  }
  if (error) {
    return <p className="px-4 py-3 text-sm text-destructive">{error}</p>;
  }
  if (!data || data.lines.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted-foreground">
        No received lines make up this figure yet.
      </p>
    );
  }

  return (
    <div className="border-t bg-muted/30 px-4 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FileText className="h-3.5 w-3.5" />
        {data.lines.length} received line{data.lines.length === 1 ? '' : 's'} •{' '}
        {formatCents(data.totalCents)} total
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Item</th>
              <th className="py-1 pr-3 font-medium">Service day</th>
              <th className="py-1 pr-3 text-right font-medium">Received</th>
              <th className="py-1 pr-3 text-right font-medium">Unit price</th>
              <th className="py-1 text-right font-medium">Line total</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <LineRow key={line.orderLineId} line={line} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One constituent line, expandable to its AP corrections when any exist. */
function LineRow({ line }: { line: StatementLineDto }) {
  const [open, setOpen] = useState(false);
  const hasCorrections = line.corrections.length > 0;
  const billable = line.receivedQty ?? line.orderedQty;
  const shorted = line.receivedQty != null && line.receivedQty < line.orderedQty;

  return (
    <>
      <tr className="border-t border-border/60">
        <td className="py-1.5 pr-3">
          <button
            type="button"
            disabled={!hasCorrections}
            onClick={() => setOpen((o) => !o)}
            className={cn(
              'flex items-center gap-1 text-left',
              hasCorrections ? 'text-foreground hover:underline' : 'cursor-default',
            )}
          >
            {hasCorrections ? (
              open ? (
                <ChevronDown className="h-3.5 w-3.5 text-primary" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-primary" />
              )
            ) : (
              <span className="inline-block w-3.5" />
            )}
            <span>{line.catalogItemName}</span>
            {hasCorrections && (
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600" aria-label="Has AP corrections" />
            )}
          </button>
        </td>
        <td className="py-1.5 pr-3 text-muted-foreground">{line.serviceDay}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums">
          {billable}
          {shorted && (
            <span className="ml-1 text-xs text-amber-600" title="Shorted">
              (of {line.orderedQty})
            </span>
          )}
        </td>
        <td className="py-1.5 pr-3 text-right tabular-nums">
          {formatCents(line.unitPriceSnapshotCents)}
        </td>
        <td className="py-1.5 text-right font-medium tabular-nums">
          {formatCents(line.lineTotalCents)}
        </td>
      </tr>
      {open && hasCorrections && (
        <tr className="bg-amber-50/60">
          <td colSpan={5} className="px-4 py-2">
            <p className="mb-1 text-xs font-medium text-amber-800">AP corrections on this line</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {line.corrections.map((c, i) => (
                <li key={i}>
                  <span className="text-foreground">{new Date(c.at).toLocaleString()}</span> —{' '}
                  {c.reason}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
