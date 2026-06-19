import { useEffect, useMemo, useState } from 'react';
import type { ReportQuery, ReportSummaryDto, StoreDto } from '@panaderia/shared';
import { api } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-store';
import { cn, formatCents } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { TrendChart } from './charts/TrendChart';
import { BarChart, type BarDatum } from './charts/BarChart';
import { useReportSummary } from './useReportSummary';

/**
 * Reports & dashboards (TDD §13, §17.2). Generous, readable D3 charts with plain-language
 * takeaways, not walls of numbers: the insight first (the headline cards and the trend
 * shape), then the detail on demand (rankings and breakdowns below).
 *
 * Scope follows role. A Store User sees only their own store's world — no store picker,
 * no "all stores"; the server pins the data to their store regardless. A global role
 * (Admin/AP) gets a store picker plus an "All stores" option to see the whole exchange.
 * The seller/buyer lens toggle switches between revenue earned and money spent.
 */
export function ReportsPage() {
  const user = useAuth((s) => s.user);

  // Default to the trailing 30 days so the page is useful on first paint.
  const today = isoToday();
  const [from, setFrom] = useState(isoDaysAgo(29));
  const [to, setTo] = useState(today);
  const [lens, setLens] = useState<'seller' | 'buyer'>('seller');
  const [metric, setMetric] = useState<'revenue' | 'units'>('revenue');
  const [storeId, setStoreId] = useState<string>(''); // '' = all stores (global only)

  const isGlobal = user?.role === 'admin' || user?.role === 'accounts_payable';

  const query: ReportQuery = useMemo(
    () => ({ from, to, lens, storeId: isGlobal && storeId ? storeId : undefined }),
    [from, to, lens, storeId, isGlobal],
  );
  const { data, loading, error } = useReportSummary(query);

  if (!user) return null;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-muted-foreground">
          {isGlobal
            ? 'How every store is doing — as seller and as buyer.'
            : `How ${user.storeName ?? 'your store'} is doing — as seller and as buyer.`}
        </p>
      </header>

      <Controls
        from={from}
        to={to}
        lens={lens}
        metric={metric}
        storeId={storeId}
        isGlobal={isGlobal}
        onFrom={setFrom}
        onTo={setTo}
        onLens={setLens}
        onMetric={setMetric}
        onStore={setStoreId}
      />

      {error && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {data && <Summary data={data} lens={lens} metric={metric} loading={loading} />}

      {!data && loading && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">Loading…</CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls: date range, lens, metric, and (for global roles) a store picker.
// ---------------------------------------------------------------------------

function Controls(props: {
  from: string;
  to: string;
  lens: 'seller' | 'buyer';
  metric: 'revenue' | 'units';
  storeId: string;
  isGlobal: boolean;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onLens: (v: 'seller' | 'buyer') => void;
  onMetric: (v: 'revenue' | 'units') => void;
  onStore: (v: string) => void;
}) {
  const stores = useStores(props.isGlobal);

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-4 py-4">
        <div className="space-y-1">
          <Label htmlFor="report-from">From</Label>
          <Input
            id="report-from"
            type="date"
            value={props.from}
            max={props.to}
            onChange={(e) => props.onFrom(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-to">To</Label>
          <Input
            id="report-to"
            type="date"
            value={props.to}
            min={props.from}
            onChange={(e) => props.onTo(e.target.value)}
            className="w-44"
          />
        </div>

        <div className="space-y-1">
          <Label>Lens</Label>
          <Toggle
            options={[
              { value: 'seller', label: 'As seller (earned)' },
              { value: 'buyer', label: 'As buyer (spent)' },
            ]}
            value={props.lens}
            onChange={props.onLens}
          />
        </div>

        <div className="space-y-1">
          <Label>Show</Label>
          <Toggle
            options={[
              { value: 'revenue', label: 'Money' },
              { value: 'units', label: 'Units' },
            ]}
            value={props.metric}
            onChange={props.onMetric}
          />
        </div>

        {props.isGlobal && (
          <div className="space-y-1">
            <Label htmlFor="report-store">Store</Label>
            <select
              id="report-store"
              value={props.storeId}
              onChange={(e) => props.onStore(e.target.value)}
              className="h-10 w-56 rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="">All stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A segmented two-or-more-option toggle, styled with the design tokens. */
function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-input bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-3 py-1.5 text-sm transition-colors',
            value === o.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary: headline cards, trend, rankings, breakdowns, and waste.
// ---------------------------------------------------------------------------

function Summary({
  data,
  lens,
  metric,
  loading,
}: {
  data: ReportSummaryDto;
  lens: 'seller' | 'buyer';
  metric: 'revenue' | 'units';
  loading: boolean;
}) {
  const moneyWord = lens === 'seller' ? 'earned' : 'spent';
  const top = data.topItems[0];

  return (
    <div className={cn('space-y-6', loading && 'opacity-60')}>
      {/* Headline numbers — the insight, before any detail. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title={lens === 'seller' ? 'Total earned' : 'Total spent'}
          value={formatCents(data.totalRevenueCents)}
          hint={`Across the selected range, ${moneyWord} ${lens === 'seller' ? 'selling' : 'buying'} bread.`}
        />
        <StatCard
          title="Units moved"
          value={`${data.totalUnits.toLocaleString()}`}
          hint="Received where confirmed, otherwise ordered."
        />
        <StatCard
          title="Top seller"
          value={top ? top.label : '—'}
          hint={top ? `${formatCents(top.revenueCents)} from ${top.units} units.` : 'No sales yet.'}
        />
      </div>

      {/* Trend */}
      <Card>
        <CardHeader>
          <CardTitle>{metric === 'revenue' ? 'Money over time' : 'Units over time'}</CardTitle>
          <CardDescription>{trendTakeaway(data, metric, moneyWord)}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.trend.length > 0 ? (
            <TrendChart points={data.trend} metric={metric} />
          ) : (
            <EmptyNote>No activity in this range.</EmptyNote>
          )}
        </CardContent>
      </Card>

      {/* Top sellers + dead items side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RankCard
          title="Top sellers"
          description="What's moving the most. The bread to keep making."
          rows={data.topItems}
          metric={metric}
          empty="Nothing sold yet."
        />
        <RankCard
          title="Slowest movers"
          description="What barely sells — candidates to drop or rethink."
          rows={data.deadItems}
          metric={metric}
          barClassName="fill-muted-foreground"
          empty="Nothing to show yet."
        />
      </div>

      {/* Breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RankCard
          title="By category"
          description="Which kinds of bread carry the range."
          rows={data.byCategory}
          metric={metric}
          empty="No categorized sales."
        />
        <RankCard
          title="By product type"
          description="The mix across product lines."
          rows={data.byProductType}
          metric={metric}
          empty="No sales to break down."
        />
      </div>

      {/* Waste */}
      <Card>
        <CardHeader>
          <CardTitle>Waste</CardTitle>
          <CardDescription>
            {data.waste.length > 0
              ? `${totalWaste(data)} units logged as wasted — biggest sources first.`
              : 'No waste logged in this range — nicely done.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.waste.length > 0 ? (
            <BarChart
              data={data.waste.map((w) => ({ key: String(w.key), label: w.label, value: w.wasteUnits }))}
              formatValue={(v) => `${v} units`}
              barClassName="fill-destructive"
            />
          ) : (
            <EmptyNote>Nothing wasted.</EmptyNote>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RankCard({
  title,
  description,
  rows,
  metric,
  empty,
  barClassName,
}: {
  title: string;
  description: string;
  rows: { key: string | number; label: string; revenueCents: number; units: number }[];
  metric: 'revenue' | 'units';
  empty: string;
  barClassName?: string;
}) {
  const data: BarDatum[] = rows
    .slice(0, 10)
    .map((r) => ({
      key: String(r.key),
      label: r.label,
      value: metric === 'revenue' ? r.revenueCents : r.units,
    }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <BarChart
            data={data}
            barClassName={barClassName}
            formatValue={(v) => (metric === 'revenue' ? formatCents(v) : `${v} units`)}
          />
        ) : (
          <EmptyNote>{empty}</EmptyNote>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

// ---------------------------------------------------------------------------
// Plain-language takeaways
// ---------------------------------------------------------------------------

/** A one-line, human takeaway about the trend's direction. */
function trendTakeaway(
  data: ReportSummaryDto,
  metric: 'revenue' | 'units',
  moneyWord: string,
): string {
  const pts = data.trend;
  const firstPt = pts[0];
  const lastPt = pts[pts.length - 1];
  if (!firstPt || !lastPt || pts.length < 2) {
    return 'Not enough days yet to show a direction.';
  }
  const val = (p: { revenueCents: number; units: number }) =>
    metric === 'revenue' ? p.revenueCents : p.units;
  const first = val(firstPt);
  const last = val(lastPt);
  if (first === 0) return last > 0 ? 'Up from a quiet start.' : 'Flat across the range.';
  const change = Math.round(((last - first) / first) * 100);
  const noun = metric === 'revenue' ? `money ${moneyWord}` : 'units';
  if (change > 5) return `Trending up — ${noun} grew about ${change}% from start to end.`;
  if (change < -5) return `Trending down — ${noun} fell about ${Math.abs(change)}% from start to end.`;
  return `Holding steady — ${noun} changed little across the range.`;
}

function totalWaste(data: ReportSummaryDto): number {
  return data.waste.reduce((s, w) => s + w.wasteUnits, 0);
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

/** Fetch the store list for the global store picker (no-op for store users). */
function useStores(enabled: boolean): StoreDto[] {
  const [stores, setStores] = useState<StoreDto[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api
      .get<StoreDto[]>('/stores')
      .then((rows) => {
        if (active) setStores(rows.filter((s) => s.active));
      })
      .catch(() => {
        /* The picker simply stays empty (All stores) if the list can't load. */
      });
    return () => {
      active = false;
    };
  }, [enabled]);
  return stores;
}

/** Today's date as an ISO YYYY-MM-DD string (local calendar day). */
function isoToday(): string {
  return toIso(new Date());
}

/** The ISO date `n` days before today. */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toIso(d);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
