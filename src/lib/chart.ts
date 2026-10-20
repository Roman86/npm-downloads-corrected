/*
 * Chart geometry: scales, ticks, paths and tooltip texts. Pure functions
 * (Node-testable); the SVG itself is rendered by ui/Chart.tsx.
 */
import type { Point } from '../types.ts';

export type Granularity = 'day' | 'week';

export interface Tick {
  i: number;
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const H = 120;
export const M = { top: 8, right: 6, bottom: 18, left: 34 };
const CHAR_W = 5.6; // approx width of a 10px tick character

export function compact(n: number): string {
  const a = Math.abs(n);
  const f = (v: number, s: string) => (v >= 100 || Number.isInteger(v) ? Math.round(v) : +v.toFixed(1)) + s;
  if (a >= 1e9) return f(n / 1e9, 'B');
  if (a >= 1e6) return f(n / 1e6, 'M');
  if (a >= 1e3) return f(n / 1e3, 'K');
  return String(Math.round(n));
}

export const full = (n: number) => Math.round(n).toLocaleString('en-US');
export const signedPct = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`;
/** Relative change in %, or null when there's no base to compare with. */
export const pctChange = (now: number, was: number) => (was ? ((now - was) / was) * 100 : null);
/** Compact signed percentage that always fits the 7ch delta column. */
export function shortPct(p: number): string {
  const sign = p >= 0 ? '+' : '−';
  const a = Math.abs(p);
  if (a >= 10000) return `×${Math.round(p / 100 + 1)}`; // +12,345% → ×124
  return `${sign}${a < 10 ? a.toFixed(1) : Math.round(a)}%`;
}

export function niceTicks(max: number, count: number): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  const last = ticks[ticks.length - 1]!;
  if (last < max) ticks.push(last + step);
  return ticks;
}

function parseDay(s: string) {
  const [y = 0, m = 1, d = 1] = s.split('-').map(Number);
  return { y, m: m - 1, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

const md = (s: string) => {
  const p = parseDay(s);
  return `${MONTHS[p.m]} ${p.d}`;
};

// "Mon, Oct 12, 2026" for days; "Oct 5 – Oct 11, 2026" for weeks.
export function dateLabel(pt: Point, granularity: Granularity): string {
  if (granularity === 'day') {
    const p = parseDay(pt.end);
    return `${WEEKDAYS[p.wd]}, ${md(pt.end)}, ${p.y}`;
  }
  const a = parseDay(pt.start), b = parseDay(pt.end);
  const left = a.y === b.y ? md(pt.start) : `${md(pt.start)}, ${a.y}`;
  return `${left} – ${md(pt.end)}, ${b.y}`;
}

export const labelWidth = (s: string) => s.length * CHAR_W + 2;

// Accept a tick set only if neighbouring labels don't collide.
function fits(ticks: Tick[], x: (i: number) => number): boolean {
  for (let k = 1; k < ticks.length; k++) {
    const a = ticks[k - 1]!, b = ticks[k]!;
    if (x(b.i) - x(a.i) < (labelWidth(b.label) + labelWidth(a.label)) / 2 + 6) return false;
  }
  return true;
}

// Ticks at month boundaries, thinned to every 1/2/3/6/12/24 months.
function monthTicks(points: readonly Point[], x: (i: number) => number): Tick[] {
  const bounds: { i: number; m: number; y: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const p = parseDay(points[i]!.end), q = parseDay(points[i - 1]!.end);
    if (p.m !== q.m) bounds.push({ i, m: p.m, y: p.y });
  }
  for (const step of [1, 2, 3, 6, 12, 24]) {
    const ticks = bounds
      .filter((b) => (b.y * 12 + b.m) % step === 0)
      .map((b) => ({ i: b.i, label: b.m === 0 ? String(b.y) : MONTHS[b.m]! }));
    if (fits(ticks, x)) return ticks;
  }
  return [];
}

// Daily ticks every 1/2/7/14 days, counted back from the last point;
// the month is shown on the first tick and wherever it changes.
function dayTicks(points: readonly Point[], x: (i: number) => number): Tick[] {
  const n = points.length;
  for (const step of [1, 2, 7, 14]) {
    const ticks: Tick[] = [];
    let prevM = -1;
    for (let i = (n - 1) % step; i < n; i += step) {
      const end = points[i]!.end;
      const p = parseDay(end);
      ticks.push({ i, label: p.m !== prevM ? md(end) : String(p.d) });
      prevM = p.m;
    }
    if (fits(ticks, x)) return ticks;
  }
  return [];
}

function xTicks(points: readonly Point[], granularity: Granularity, x: (i: number) => number): Tick[] {
  if (granularity === 'day' && points.length <= 45) return dayTicks(points, x);
  return monthTicks(points, x);
}

export interface Layout {
  W: number;
  pw: number;
  ph: number;
  max: number;
  yTicks: number[];
  xTicks: Tick[];
  x: (i: number) => number;
  y: (v: number) => number;
  /** Previous period aligned to `points` from the end (null where it doesn't reach). */
  prev: (Point | null)[] | null;
  rawPath: string;
  corrPath: string;
  prevPath: { line: string; area: string } | null;
  markR: number;
}

export function layout(
  points: readonly Point[],
  prevSrc: readonly Point[] | null | undefined,
  granularity: Granularity,
  width: number
): Layout {
  const W = Math.max(200, Math.round(width || 280));
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;
  const prev: (Point | null)[] | null = prevSrc
    ? points.map((_, i) => prevSrc[i - (points.length - prevSrc.length)] ?? null)
    : null;
  const max = Math.max(
    1,
    ...points.map((p) => Math.max(p.raw, p.corrected)),
    ...(prev ? prev.map((p) => (p ? p.corrected : 0)) : [])
  );
  const yTicks = niceTicks(max, 3);
  const top = yTicks[yTicks.length - 1]!;
  const x = (i: number) => M.left + (points.length > 1 ? (i * pw) / (points.length - 1) : pw / 2);
  const y = (v: number) => M.top + ph - (v / top) * ph;
  const path = (key: 'raw' | 'corrected') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');

  let prevPath: Layout['prevPath'] = null;
  if (prev) {
    let line = '', first = -1, last = -1;
    prev.forEach((p, i) => {
      if (!p) return;
      line += `${first < 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.corrected).toFixed(1)}`;
      if (first < 0) first = i;
      last = i;
    });
    if (first >= 0) {
      const base = y(0).toFixed(1);
      prevPath = { line, area: `${line}L${x(last).toFixed(1)},${base}L${x(first).toFixed(1)},${base}Z` };
    }
  }
  return {
    W,
    pw,
    ph,
    max,
    yTicks,
    xTicks: xTicks(points, granularity, x),
    x,
    y,
    prev,
    rawPath: path('raw'),
    corrPath: path('corrected'),
    prevPath,
    markR: points.length > 150 ? 1.3 : 1.8,
  };
}

/** Point index under a pointer at `px` (chart pixel x), clamped. */
export function indexAt(l: Layout, count: number, px: number): number {
  const i = Math.round(((px - M.left) / l.pw) * (count - 1));
  return Math.max(0, Math.min(count - 1, i));
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** Tooltip note lines: what was corrected and why (empty = no outages). */
export function noteLines(p: Point, granularity: Granularity): string[] {
  const diff = p.corrected - p.raw;
  const pct = p.raw ? (diff / p.raw) * 100 : 0;
  let why = '';
  if (granularity === 'day') {
    why = p.gapDays ? 'data missing for this package' : 'npm-wide outage';
  } else if (p.fixedDays) {
    const outage = p.fixedDays - p.gapDays;
    why = [outage ? `${days(outage)} npm-wide outage` : '', p.gapDays ? `${days(p.gapDays)} missing data` : '']
      .filter(Boolean)
      .join(' · ');
  }
  const lines: string[] = [];
  if (p.fixedDays) lines.push(`adjusted +${full(diff)}${p.raw ? ` (${signedPct(pct)})` : ''}`, why);
  if (p.holidayDays) {
    lines.push(granularity === 'day' ? 'holiday season' : `${days(p.holidayDays)} holiday season`, 'real dip, not corrected');
  }
  return lines;
}
