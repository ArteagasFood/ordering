import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import type { ReconciliationFlagDto } from '@panaderia/shared';

/**
 * A small D3 bar chart of flags-per-day, so chronic shorting shows up as a recurring
 * pattern rather than a list of one-off incidents (TDD §10.2 step 4 "trend over time").
 *
 * Flags are bucketed by their service day (the day the delivery was counted), which is
 * the operationally meaningful axis — "which delivery days go wrong" — rather than the
 * row's createdAt. The chart is intentionally minimal and dependency-light: d3 computes
 * the scales, React owns the SVG element, and a resize-agnostic viewBox keeps it crisp.
 */
export function FlagsTrendChart({ flags }: { flags: ReconciliationFlagDto[] }) {
  const ref = useRef<SVGSVGElement | null>(null);

  // Bucket flags by service day, ascending. Memoized so the effect only re-runs on data.
  const series = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of flags) counts.set(f.serviceDay, (counts.get(f.serviceDay) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [flags]);

  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll('*').remove();
    if (series.length === 0) return;

    const width = 640;
    const height = 200;
    const margin = { top: 8, right: 8, bottom: 28, left: 28 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const x = d3
      .scaleBand<string>()
      .domain(series.map((d) => d.day))
      .range([0, innerW])
      .padding(0.2);

    const yMax = d3.max(series, (d) => d.count) ?? 1;
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('role', 'img')
      .attr('aria-label', 'Flags per service day')
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Bars use the primary token via currentColor so the chart respects the theme.
    g.selectAll('rect')
      .data(series)
      .join('rect')
      .attr('x', (d) => x(d.day) ?? 0)
      .attr('y', (d) => y(d.count))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerH - y(d.count))
      .attr('rx', 2)
      .attr('fill', 'currentColor');

    // Y axis: integer ticks only (a count is a whole number).
    const yAxis = d3.axisLeft(y).ticks(Math.min(yMax, 4)).tickFormat(d3.format('d'));
    g.append('g').call(yAxis).attr('class', 'text-xs text-muted-foreground').call((sel) => sel.select('.domain').remove());

    // X axis: show at most ~8 day labels to avoid crowding on long histories.
    const everyNth = Math.ceil(series.length / 8);
    const xAxis = d3
      .axisBottom(x)
      .tickValues(series.filter((_, i) => i % everyNth === 0).map((d) => d.day))
      .tickFormat((d) => (d as string).slice(5)); // MM-DD
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .call(xAxis)
      .attr('class', 'text-xs text-muted-foreground')
      .call((sel) => sel.select('.domain').remove());
  }, [series]);

  if (series.length === 0) {
    return <p className="text-sm text-muted-foreground">No flags to chart yet.</p>;
  }

  return <svg ref={ref} className="w-full text-primary" style={{ maxHeight: 220 }} />;
}
