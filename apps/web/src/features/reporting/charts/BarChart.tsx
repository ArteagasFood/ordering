import { useMemo } from 'react';
import * as d3 from 'd3';
import { useChartWidth } from './useChartWidth';

/** One labeled, valued bar — the minimal shape every breakdown chart consumes. */
export interface BarDatum {
  key: string;
  label: string;
  value: number;
}

/**
 * A horizontal bar chart for rankings and breakdowns (top sellers, by category, by
 * product type, waste — TDD §13.1, §17.2). Horizontal bars let the item names sit on the
 * axis at full length and read top-to-bottom like a list, which is far gentler than
 * rotated vertical labels for non-power-users.
 *
 * As with the trend chart, D3 supplies only the math; React renders declarative SVG.
 */
export function BarChart({
  data,
  formatValue,
  /** Tailwind fill class for the bars (defaults to the primary token). */
  barClassName = 'fill-primary',
}: {
  data: BarDatum[];
  formatValue: (value: number) => string;
  barClassName?: string;
}) {
  const [ref, width] = useChartWidth();
  const rowHeight = 34;
  const margin = { top: 8, right: 72, bottom: 8, left: 8 };
  const labelWidth = 140;
  const height = Math.max(1, data.length) * rowHeight + margin.top + margin.bottom;

  const geometry = useMemo(() => {
    if (width <= 0 || data.length === 0) return null;
    const barAreaLeft = margin.left + labelWidth;
    const innerW = Math.max(1, width - barAreaLeft - margin.right);
    const maxV = d3.max(data, (d) => d.value) ?? 0;
    const x = d3.scaleLinear().domain([0, maxV === 0 ? 1 : maxV]).range([0, innerW]);
    return { barAreaLeft, innerW, x };
  }, [width, data]);

  return (
    <div ref={ref} className="w-full">
      {geometry && (
        <svg width={width} height={height} role="img" aria-label="Ranking">
          {data.map((d, i) => {
            const y = margin.top + i * rowHeight;
            const barW = geometry.x(d.value);
            return (
              <g key={d.key} transform={`translate(0,${y})`}>
                <text
                  x={margin.left}
                  y={rowHeight / 2}
                  dy="0.32em"
                  className="fill-foreground text-xs"
                >
                  {truncate(d.label, 20)}
                  <title>{d.label}</title>
                </text>
                <rect
                  x={geometry.barAreaLeft}
                  y={4}
                  width={Math.max(0, barW)}
                  height={rowHeight - 12}
                  rx={3}
                  className={barClassName}
                />
                <text
                  x={geometry.barAreaLeft + barW + 6}
                  y={rowHeight / 2}
                  dy="0.32em"
                  className="fill-muted-foreground text-[11px]"
                >
                  {formatValue(d.value)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** Trim a label to `max` characters with an ellipsis, so long names never overrun. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
