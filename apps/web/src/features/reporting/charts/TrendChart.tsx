import { useMemo } from 'react';
import * as d3 from 'd3';
import type { TrendPointDto } from '@panaderia/shared';
import { formatCents } from '@/lib/utils';
import { useChartWidth } from './useChartWidth';

/**
 * A revenue/volume trend line over time (TDD §13.1, §17.2). One smooth line traces the
 * chosen metric across the trend's period buckets (days or months), with light gridlines
 * and value-on-hover dots, so a tired store owner reads the shape — "are we growing?" —
 * before any numbers.
 *
 * Rendering approach: React owns the DOM; D3 is used purely as a math library (scales,
 * line/area generators, axis ticks) and we emit declarative SVG. This avoids React and
 * D3 fighting over the same nodes.
 */
export function TrendChart({
  points,
  metric,
}: {
  points: TrendPointDto[];
  /** Which series to draw: earned/spent money, or units moved. */
  metric: 'revenue' | 'units';
}) {
  const [ref, width] = useChartWidth();
  const height = 240;
  const margin = { top: 16, right: 16, bottom: 28, left: 56 };

  const value = (p: TrendPointDto) => (metric === 'revenue' ? p.revenueCents : p.units);

  const geometry = useMemo(() => {
    if (width <= 0 || points.length === 0) return null;
    const innerW = Math.max(1, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    // A band-free linear index scale keeps spacing even regardless of calendar gaps.
    const x = d3
      .scalePoint<string>()
      .domain(points.map((p) => p.period))
      .range([0, innerW]);
    const maxY = d3.max(points, value) ?? 0;
    const y = d3.scaleLinear().domain([0, maxY === 0 ? 1 : maxY]).nice().range([innerH, 0]);

    const line = d3
      .line<TrendPointDto>()
      .x((p) => x(p.period) ?? 0)
      .y((p) => y(value(p)))
      .curve(d3.curveMonotoneX);
    const area = d3
      .area<TrendPointDto>()
      .x((p) => x(p.period) ?? 0)
      .y0(innerH)
      .y1((p) => y(value(p)))
      .curve(d3.curveMonotoneX);

    // Thin the x labels so they never collide on a dense daily axis.
    const labelStep = Math.ceil(points.length / Math.max(1, Math.floor(innerW / 70)));
    const xTicks = points.filter((_, i) => i % labelStep === 0);
    const yTicks = y.ticks(4);

    return { innerW, innerH, x, y, line, area, xTicks, yTicks };
  }, [width, points, metric]);

  const fmtY = (n: number) => (metric === 'revenue' ? formatCents(n) : String(n));

  return (
    <div ref={ref} className="w-full">
      {geometry && (
        <svg width={width} height={height} role="img" aria-label="Trend over time">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {geometry.yTicks.map((t) => (
              <g key={t} transform={`translate(0,${geometry.y(t)})`}>
                <line x1={0} x2={geometry.innerW} className="stroke-border" strokeWidth={1} />
                <text x={-8} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px]">
                  {fmtY(t)}
                </text>
              </g>
            ))}
            <path d={geometry.area(points) ?? ''} className="fill-primary/10" />
            <path
              d={geometry.line(points) ?? ''}
              className="stroke-primary"
              strokeWidth={2.5}
              fill="none"
            />
            {points.map((p) => (
              <circle
                key={p.period}
                cx={geometry.x(p.period) ?? 0}
                cy={geometry.y(value(p))}
                r={3}
                className="fill-primary"
              >
                <title>{`${p.period}: ${fmtY(value(p))}`}</title>
              </circle>
            ))}
            {geometry.xTicks.map((p) => (
              <text
                key={p.period}
                x={geometry.x(p.period) ?? 0}
                y={geometry.innerH + 18}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {p.period}
              </text>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}
