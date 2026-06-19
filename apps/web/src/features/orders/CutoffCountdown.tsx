import { useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * CutoffCountdown (TDD §17 "Respect the clock") — a compact, legible countdown to a
 * producer's daily order cutoff, intended for the persistent header slot so no one
 * misses a window because the UI hid it.
 *
 * The cutoff is given as a 24h HH:MM time-of-day. We compute the next occurrence of that
 * time today (or, if it has already passed, mark it closed for the day) and tick once a
 * second. The component is purely presentational and timezone-naive: it interprets the
 * cutoff in the browser's local time, matching where the store owner physically stands.
 */
export interface CutoffCountdownProps {
  /** The producer's effective cutoff as 24h HH:MM, or null when none applies. */
  cutoffTime: string | null;
  /** Optional label, e.g. the producer's name ("Cutoff for Panadería Sol"). */
  label?: string;
  className?: string;
}

/** Parse "HH:MM" into a Date at that time today (local). Returns null on malformed input. */
function cutoffDateToday(cutoffTime: string): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(cutoffTime);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/** Format a positive millisecond span as "Hh Mm" or "Mm Ss" when under an hour. */
function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function CutoffCountdown({ cutoffTime, label, className }: CutoffCountdownProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const target = useMemo(
    () => (cutoffTime ? cutoffDateToday(cutoffTime) : null),
    [cutoffTime],
  );

  if (!cutoffTime || !target) {
    return null;
  }

  const remainingMs = target.getTime() - now;
  const closed = remainingMs <= 0;
  // Warn (amber) inside the final half hour before cutoff.
  const urgent = !closed && remainingMs <= 30 * 60 * 1000;

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium',
        closed && 'border-destructive/40 bg-destructive/10 text-destructive',
        urgent && 'border-amber-500/40 bg-amber-500/10 text-amber-700',
        !closed && !urgent && 'border-input bg-card text-foreground',
        className,
      )}
      role="timer"
      aria-live="polite"
      title={`Cutoff at ${cutoffTime}`}
    >
      <Clock className="h-4 w-4 shrink-0" aria-hidden />
      <span className="text-muted-foreground">{label ?? 'Order cutoff'}</span>
      <span>{closed ? 'closed for today' : formatRemaining(remainingMs)}</span>
    </div>
  );
}
