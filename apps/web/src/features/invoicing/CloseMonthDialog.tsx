import { useState } from 'react';
import { Lock, ShieldCheck, X } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { formatCents } from '@/lib/utils';
import type { SettlementReportDto } from '@panaderia/shared';
import { closeMonth } from './useSettlement';

/**
 * Guided, reassuring Close Month confirmation (TDD §12.3 step 4, §17.1 "forgiving by
 * design / clear confirmation before anything irreversible"). Closing freezes the
 * month's lines into immutable statements; nothing further can be edited. The dialog
 * states plainly what is about to happen and how much is being frozen, then requires an
 * explicit confirm — no accidental closes.
 */
export function CloseMonthDialog({
  month,
  report,
  onClosed,
  onCancel,
}: {
  month: string;
  report: SettlementReportDto;
  onClosed: () => void;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the user is about to freeze, summarized so the action feels confident.
  const statementCount = report.directional.length;
  const totalGross = report.directional.reduce((sum, s) => sum + s.grossAmountCents, 0);

  async function confirm() {
    setError(null);
    setSubmitting(true);
    try {
      await closeMonth(month);
      onClosed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not close the month.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-month-title"
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-5 w-5 text-primary" />
          </span>
          <h2 id="close-month-title" className="text-lg font-semibold">
            Close {month}?
          </h2>
        </div>

        <p className="text-sm text-muted-foreground">
          This freezes {month} for good. The month&apos;s received lines and any AP corrections
          become {statementCount} immutable statement{statementCount === 1 ? '' : 's'} totalling{' '}
          <span className="font-medium text-foreground">{formatCents(totalGross)}</span> in gross
          obligations. After closing, nothing in this month can be edited — you&apos;ll still be
          able to view every figure and record payments.
        </p>

        <p className="mt-3 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-primary" />
          Take your time — drill into any figure to verify it before you close. This step is not
          reversible.
        </p>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            <X className="mr-1.5 h-4 w-4" />
            Not yet
          </Button>
          <Button type="button" onClick={confirm} disabled={submitting}>
            <Lock className="mr-1.5 h-4 w-4" />
            {submitting ? 'Closing…' : `Close ${month}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
