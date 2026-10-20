// Cutting a displayed period out of the corrected daily series (pure, Node-testable).
import type { Point } from '../types.ts';

export interface PeriodSlice {
  period: Point[];
  /** Previous period, aligned to `period` from the end; null when it has no data. */
  prev: Point[] | null;
  /** Leading days before the package's first download were dropped (young package). */
  trimmed: boolean;
  empty: boolean;
}

/**
 * Days in [start, end] plus the previous period. A young package's run of
 * days before its first download is dropped. "Existed" means corrected > 0,
 * not raw > 0: on an npm-wide outage day raw is 0 for everyone, and an outage
 * on the first day of the period must not look like a package launch.
 */
export function slicePeriod(
  daily: readonly Point[],
  start: string,
  end: string,
  prevRange: { start: string; end: string } | null
): PeriodSlice {
  const between = (a: string, b: string) => daily.filter((d) => d.start >= a && d.start <= b);
  let period = between(start, end);
  let prev = prevRange ? between(prevRange.start, prevRange.end) : null;

  const first = period.findIndex((d) => d.corrected > 0);
  const trimmed = first > 0;
  if (first > 0) {
    period = period.slice(first);
    if (prev) prev = prev.slice(Math.max(0, prev.length - period.length));
  }
  if (first === -1) period = [];
  if (prev && !prev.some((d) => d.corrected > 0)) prev = null;
  return { period, prev, trimmed, empty: !period.length };
}
