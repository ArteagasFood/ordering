import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCents } from '@/lib/utils';
import type { StatementDto } from '@panaderia/shared';
import { recordPayment } from './useSettlement';

/**
 * Record an offline check against a directional statement (TDD §12.3 step 3, AP only).
 * The amount defaults to the full gross — the common path is "I wrote the check for what
 * is owed" — but AP may enter a partial amount. Plain bakery-office language; large
 * targets; a clear single action (TDD §17).
 */
export function RecordPaymentForm({
  statement,
  onRecorded,
  onCancel,
}: {
  statement: StatementDto;
  onRecorded: () => void;
  onCancel: () => void;
}) {
  // Amount is entered in dollars for the user, converted to integer cents on submit.
  const [amount, setAmount] = useState(() => (statement.grossAmountCents / 100).toFixed(2));
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPay = statement.id && !statement.id.startsWith('directional:');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setSubmitting(true);
    try {
      await recordPayment({
        statementId: statement.id,
        amountCents: Math.round(dollars * 100),
        reference: reference.trim(),
      });
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the payment.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canPay) {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        Close the month first to record a payment against this statement.
        <div className="mt-3">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border bg-card p-4">
      <div>
        <p className="text-sm font-medium">
          {statement.payerStoreName} pays {statement.payeeStoreName}
        </p>
        <p className="text-xs text-muted-foreground">
          Owed this month: {formatCents(statement.grossAmountCents)}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pay-amount">Check amount (USD)</Label>
        <Input
          id="pay-amount"
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pay-ref">Check number / reference (optional)</Label>
        <Input
          id="pay-ref"
          type="text"
          maxLength={120}
          placeholder="e.g. Check #1042"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          <Check className="mr-1.5 h-4 w-4" />
          {submitting ? 'Recording…' : 'Record payment'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          <X className="mr-1.5 h-4 w-4" />
          Cancel
        </Button>
      </div>
    </form>
  );
}
