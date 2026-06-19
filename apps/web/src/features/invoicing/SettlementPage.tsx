import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, Lock, Receipt, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatCents } from '@/lib/utils';
import type {
  NettedPairDto,
  SettlementView,
  StatementDto,
} from '@panaderia/shared';
import { useSettlementReport } from './useSettlement';
import { StatementDrilldown } from './StatementDrilldown';
import { RecordPaymentForm } from './RecordPaymentForm';
import { CloseMonthDialog } from './CloseMonthDialog';

/** The current month key (YYYY-MM) — the sensible default for the picker. */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Settlement & monthly close (TDD §12, §17.2 "AP & close"). For Admin and AP only.
 *
 * AP picks a month, reviews who owes whom — netted by default (one check per pair),
 * directional on demand (gross per direction) — drills into any figure down to its
 * constituent order lines (the audit trail, §12.2), records offline check payments, and
 * runs a guided, reassuring Close Month action that freezes the period (§12.3).
 */
export function SettlementPage() {
  const user = useAuth((s) => s.user);
  const [month, setMonth] = useState(currentMonth());
  const [view, setView] = useState<SettlementView>('netted'); // netted is the default (§12.1)
  const { report, loading, error, reload } = useSettlementReport(month, view);

  const isAP = user?.role === 'accounts_payable';
  const [closing, setClosing] = useState(false);

  if (!user) return null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Receipt className="h-6 w-6 text-primary" />
            Settlement
          </h1>
          <p className="text-muted-foreground">
            Who owes whom this month, down to every order line.
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="month">Month</Label>
            <Input
              id="month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-44"
            />
          </div>
        </div>
      </header>

      {/* View toggle + close status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewToggle view={view} onChange={setView} />
        <div className="flex items-center gap-3">
          {report?.closed ? (
            <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              Closed
            </span>
          ) : (
            isAP &&
            report &&
            report.directional.length > 0 && (
              <Button onClick={() => setClosing(true)}>
                <Lock className="mr-1.5 h-4 w-4" />
                Close {month}
              </Button>
            )
          )}
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading settlement…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {report && !loading && (
        <>
          {report.directional.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                No reconciled sales between stores for {month} yet.
              </CardContent>
            </Card>
          ) : view === 'netted' ? (
            <NettedView pairs={report.pairs} month={month} />
          ) : (
            <DirectionalView
              statements={report.directional}
              canPay={isAP && report.closed}
              onChanged={reload}
            />
          )}
        </>
      )}

      {closing && report && (
        <CloseMonthDialog
          month={month}
          report={report}
          onClosed={() => {
            setClosing(false);
            reload();
          }}
          onCancel={() => setClosing(false)}
        />
      )}
    </div>
  );
}

/** Netted (default) vs Directional view toggle (TDD §12.1). */
function ViewToggle({
  view,
  onChange,
}: {
  view: SettlementView;
  onChange: (v: SettlementView) => void;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {(['netted', 'directional'] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            'rounded px-3 py-1.5 text-sm capitalize transition-colors',
            view === v
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

/**
 * Netted view: the single check one store writes the other (TDD §12.1). Each card shows
 * the net payer → payee, expandable into the two directional grosses, each of which
 * drills to its constituent lines.
 */
function NettedView({ pairs, month }: { pairs: NettedPairDto[]; month: string }) {
  if (pairs.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Everything nets to zero this month — no checks needed.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      {pairs.map((p) => (
        <NettedPairCard key={`${p.storeAId}-${p.storeBId}`} pair={p} month={month} />
      ))}
    </div>
  );
}

function NettedPairCard({ pair, month }: { pair: NettedPairDto; month: string }) {
  const [expanded, setExpanded] = useState(false);
  const settled = pair.netPayerStoreId === null;
  const payerName = pair.netPayerStoreId === pair.storeAId ? pair.storeAName : pair.storeBName;
  const payeeName = pair.netPayeeStoreId === pair.storeAId ? pair.storeAName : pair.storeBName;

  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <CardTitle className="flex items-center gap-2 text-base">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-primary" />
            ) : (
              <ChevronRight className="h-4 w-4 text-primary" />
            )}
            {settled ? (
              <span className="text-muted-foreground">
                {pair.storeAName} and {pair.storeBName} are even
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                {payerName}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                {payeeName}
              </span>
            )}
          </CardTitle>
          <span className={cn('text-lg font-semibold tabular-nums', settled && 'text-muted-foreground')}>
            {formatCents(pair.netAmountCents)}
          </span>
        </button>
        <CardDescription className="pl-6">
          {pair.storeAName} owes {pair.storeBName} {formatCents(pair.aOwesBCents)} •{' '}
          {pair.storeBName} owes {pair.storeAName} {formatCents(pair.bOwesACents)}
        </CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4 border-t pt-4">
          <DirectionGross
            label={`${pair.storeAName} → ${pair.storeBName}`}
            payerId={pair.storeAId}
            payeeId={pair.storeBId}
            grossCents={pair.aOwesBCents}
            month={month}
          />
          <DirectionGross
            label={`${pair.storeBName} → ${pair.storeAName}`}
            payerId={pair.storeBId}
            payeeId={pair.storeAId}
            grossCents={pair.bOwesACents}
            month={month}
          />
        </CardContent>
      )}
    </Card>
  );
}

/**
 * One direction of a netted pair, drillable to its lines. We reconstruct the synthetic
 * directional statement id the open-month API uses; for a closed month the report's
 * directional rows carry the real id, but the netted figures always expand through the
 * same drill-down endpoint, which accepts either id form.
 */
function DirectionGross({
  label,
  payerId,
  payeeId,
  grossCents,
  month,
}: {
  label: string;
  payerId: string;
  payeeId: string;
  grossCents: number;
  month: string;
}) {
  const [open, setOpen] = useState(false);
  if (grossCents === 0) {
    return <p className="text-sm text-muted-foreground">{label}: nothing owed</p>;
  }
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm"
      >
        <span className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-primary" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-primary" />
          )}
          {label}
        </span>
        <span className="font-medium tabular-nums">{formatCents(grossCents)}</span>
      </button>
      {open && (
        <StatementDrilldown statementId={`directional:${payerId}:${payeeId}:${month}`} />
      )}
    </div>
  );
}

/**
 * Directional view: each gross obligation as its own statement row, drillable to its
 * lines, and (once the month is closed) payable by AP.
 */
function DirectionalView({
  statements,
  canPay,
  onChanged,
}: {
  statements: StatementDto[];
  canPay: boolean;
  onChanged: () => void;
}) {
  const sorted = useMemo(
    () =>
      [...statements].sort((a, b) =>
        a.payerStoreName.localeCompare(b.payerStoreName) ||
        a.payeeStoreName.localeCompare(b.payeeStoreName),
      ),
    [statements],
  );
  return (
    <div className="space-y-3">
      {sorted.map((s) => (
        <DirectionalRow key={s.id} statement={s} canPay={canPay} onChanged={onChanged} />
      ))}
    </div>
  );
}

function DirectionalRow({
  statement,
  canPay,
  onChanged,
}: {
  statement: StatementDto;
  canPay: boolean;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [paying, setPaying] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-2 text-left"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-primary" />
            ) : (
              <ChevronRight className="h-4 w-4 text-primary" />
            )}
            <CardTitle className="flex items-center gap-1.5 text-base">
              {statement.payerStoreName}
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              {statement.payeeStoreName}
            </CardTitle>
          </button>
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold tabular-nums">
              {formatCents(statement.grossAmountCents)}
            </span>
            {canPay && (
              <Button variant="outline" size="sm" onClick={() => setPaying((p) => !p)}>
                <Wallet className="mr-1.5 h-4 w-4" />
                Record payment
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      {paying && (
        <CardContent className="border-t pt-4">
          <RecordPaymentForm
            statement={statement}
            onRecorded={() => {
              setPaying(false);
              onChanged();
            }}
            onCancel={() => setPaying(false)}
          />
        </CardContent>
      )}
      {expanded && (
        <CardContent className="p-0">
          <StatementDrilldown statementId={statement.id} />
        </CardContent>
      )}
    </Card>
  );
}
