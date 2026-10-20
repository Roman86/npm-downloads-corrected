// Periods: the range switcher's options, their date windows and cutting a
// displayed period out of the corrected daily series. Pure, Node-testable.
import type { Granularity } from './chart.ts';
import type { Point, RangeId } from '../types.ts';

export const NPM_EPOCH = '2015-01-10'; // earliest date the downloads API has data for
const DAY = 864e5;

export interface Range {
  id: RangeId;
  label: string;
  title: string;
  days: number;
  gran: Granularity;
  compare: boolean; // draw the previous period as a shadow line
}

export const RANGES: readonly Range[] = [
  { id: '1w', label: '1W', title: 'Week', days: 7, gran: 'day', compare: true },
  { id: '1m', label: '1M', title: 'Month', days: 30, gran: 'day', compare: true },
  { id: '3m', label: '3M', title: 'Quarter', days: 91, gran: 'day', compare: true },
  { id: '1y', label: '1Y', title: 'Year', days: 52 * 7, gran: 'week', compare: true },
  { id: '2y', label: '2Y', title: '2 years', days: 104 * 7, gran: 'week', compare: false },
  { id: '5y', label: '5Y', title: '5 years', days: 261 * 7, gran: 'week', compare: false },
];
export const DEFAULT_RANGE: RangeId = '1y';
export const rangeById = (id: string | null | undefined): Range =>
  RANGES.find((r) => r.id === id) ?? RANGES.find((r) => r.id === DEFAULT_RANGE)!;

export const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => iso(Date.parse(day + 'T00:00:00Z') + n * DAY);
export const yesterday = () => iso(Date.now() - DAY);

// Shadow shift: the period rounded up to whole weeks, so weekdays line up.
const shiftOf = (range: Range) => Math.ceil(range.days / 7) * 7;

export interface PeriodWindow {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
}

/** The period `offset` steps back from the latest one ending at `last`. */
export function windowFor(range: Range, offset: number, last = yesterday()): PeriodWindow {
  const end = addDays(last, -offset * range.days);
  const start = addDays(end, -(range.days - 1));
  const prevEnd = addDays(end, -shiftOf(range));
  const prevStart = addDays(prevEnd, -(range.days - 1));
  return { start, end, prevStart, prevEnd };
}

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
