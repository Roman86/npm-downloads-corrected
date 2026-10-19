/*
 * Core algorithm (no browser APIs, so it is testable in Node).
 *
 * Idea: npm's counting pipeline loses a share of downloads on some days, and
 * the share is roughly the same for every package. Huge packages (react,
 * lodash, ...) have very smooth, predictable traffic, so a dip in them is
 * almost certainly a pipeline loss, not real behaviour.
 *
 * For every day i and every reference package r:
 *   baseline_r(i) = median of the same weekday over ±N weeks (day i excluded)
 *   q_r(i)        = actual_r(i) / baseline_r(i)        ("capture ratio")
 * q(i) = median over references of q_r(i)
 *
 * If q(i) < 1 - tolerance, day i is treated as damaged:
 *   corrected(i) = raw(i) / q(i)                       (proportional loss)
 *   if q(i) < minRatio (almost total outage, dividing is unreliable):
 *   corrected(i) = max(raw(i), same-weekday median of the target itself)
 *
 * Package-level gaps: npm sometimes loses a day for individual packages while
 * the references are fine (the package shows 0). If a package that normally
 * has >= gapMinBaseline downloads on that weekday reports <= gapFraction of
 * it, the day is treated as missing data and filled with that baseline.
 * For a package with 100+/day such a value can't be noise; small packages
 * (where a real 0 happens) are left alone.
 *
 * Holidays: around Christmas / New Year (and on US Thanksgiving) real traffic
 * drops for every package, references included — indistinguishable from a
 * partial outage by ratios alone, and packages installed by people drop even
 * deeper than CI-heavy references. On those days only full outages
 * (q < minRatio, npm reporting ~0) are corrected; partial dips are real.
 */
import type { CorrectedDay, DayPoint, Method, Point } from '../types.ts';

export interface CorrectOptions {
  baselineWeeks: number;
  tolerance: number;
  minRatio: number;
  minRefs: number;
  gapFraction: number;
  gapMinBaseline: number;
}

export const DEFAULT_OPTIONS: CorrectOptions = {
  baselineWeeks: 4, // same-weekday neighbours on each side
  tolerance: 0.1, // ignore deviations smaller than 10%
  minRatio: 0.15, // below this, fall back to the target's own baseline
  minRefs: 2, // how many references must agree on a day
  gapFraction: 0.05, // package-level gap: value <= 5% of its usual level…
  gapMinBaseline: 100, // …and the usual level is at least this per day
};

export function median(values: readonly number[]): number {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

// Median of the same weekday over ±weeks (day i itself excluded).
// Zero days are skipped: npm reports 0 for *every* package on full-outage
// days, and those often fall on the same weekday several weeks in a row
// (e.g. three outage Tuesdays) — with zeros the median would collapse to 0.
// If fewer than 2 non-zero neighbours remain, the window widens (up to 2×).
export function weekdayBaseline(values: readonly number[], i: number, weeks: number): number {
  let sample: number[] = [];
  for (let span = weeks; span <= weeks * 2; span += weeks) {
    sample = [];
    for (let k = 1; k <= span; k++) {
      for (const j of [i - 7 * k, i + 7 * k]) {
        const v = values[j];
        if (v !== undefined && Number.isFinite(v) && v > 0) sample.push(v);
      }
    }
    if (sample.length >= 2) break;
  }
  return median(sample);
}

/** Day of month of the 4th Thursday of November (US Thanksgiving). */
function thanksgiving(year: number): number {
  const firstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  return 1 + ((4 - firstDow + 7) % 7) + 21;
}

/**
 * Holiday season with an ecosystem-wide real dip: Dec 22 – Jan 5, and US
 * Thanksgiving Thursday + Friday. (Measured on real data for 2024/25: the
 * dip ran Dec 23 – Jan 3; the window is padded to cover other weekday layouts.)
 */
export function isHoliday(day: string): boolean {
  const [y = 0, m = 0, d = 0] = day.split('-').map(Number);
  if ((m === 12 && d >= 22) || (m === 1 && d <= 5)) return true;
  if (m === 11) {
    const t = thanksgiving(y);
    return d === t || d === t + 1;
  }
  return false;
}

function alignTo(days: readonly string[], series: readonly DayPoint[]): number[] {
  const map = new Map<string, number>();
  for (const d of series) map.set(d.day, d.downloads);
  return days.map((day) => map.get(day) ?? NaN);
}

/** Capture ratio per day: ~1 on normal days, <1 on days with lost data. */
export function captureRatios(refValues: readonly number[][], length: number, opts: CorrectOptions): number[] {
  const perRef = refValues.map((vals) =>
    vals.map((v, i) => {
      const b = weekdayBaseline(vals, i, opts.baselineWeeks);
      return b > 0 && Number.isFinite(v) ? v / b : NaN;
    })
  );
  const need = Math.max(1, Math.min(opts.minRefs, refValues.length));
  const out = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    const qs = perRef.map((r) => r[i] ?? NaN).filter(Number.isFinite);
    out[i] = qs.length >= need ? median(qs) : NaN;
  }
  return out;
}

/**
 * @param target  the package being viewed
 * @param refs    reference (huge) packages, same shape
 */
export function correctSeries(
  target: readonly DayPoint[],
  refs: readonly (readonly DayPoint[])[],
  options?: Partial<CorrectOptions>
): CorrectedDay[] {
  const opts: CorrectOptions = { ...DEFAULT_OPTIONS, ...options };
  const days = target.map((d) => d.day);
  const raw = target.map((d) => d.downloads);
  const refValues = refs.map((r) => alignTo(days, r));
  const q = captureRatios(refValues, days.length, opts);

  return days.map((day, i) => {
    const ratio = q[i]!;
    const value = raw[i]!;
    let corrected = value;
    let method: Method = 'none';
    const holiday = isHoliday(day);
    // On holidays a partial dip is real; only a full outage (q < minRatio) is fixed.
    if (Number.isFinite(ratio) && ratio < 1 - opts.tolerance && !(holiday && ratio >= opts.minRatio)) {
      if (ratio >= opts.minRatio) {
        corrected = value / ratio;
        method = 'scaled';
      } else {
        const b = weekdayBaseline(raw, i, opts.baselineWeeks);
        corrected = Number.isFinite(b) ? Math.max(value, b) : value;
        method = 'baseline';
      }
    }
    // Package-level gap (also catches 0 / q = 0 on a reference-outage day).
    const own = weekdayBaseline(raw, i, opts.baselineWeeks);
    // On holidays a near-zero day can be real for small teams' packages: only a hard 0 counts.
    const gapLimit = holiday ? 0 : opts.gapFraction * own;
    if (own >= opts.gapMinBaseline && corrected <= gapLimit) {
      // Only if the package already had that level before (not pre-launch).
      const before: number[] = [];
      for (let k = 1; k <= opts.baselineWeeks && i - 7 * k >= 0; k++) before.push(raw[i - 7 * k]!);
      const normalBefore = before.filter((v) => v > opts.gapFraction * own).length;
      if (before.length && normalBefore * 2 >= before.length) {
        corrected = own;
        method = 'gap';
      }
    }
    return { day, raw: value, corrected: Math.round(corrected), ratio, method, holiday };
  });
}

type WeeklyInput = CorrectedDay | Point;

/** 7-day windows ending on the last available day (same as npm "last week"). */
export function toWeekly(daily: readonly WeeklyInput[]): Point[] {
  const isDay = (d: WeeklyInput): d is CorrectedDay => 'method' in d;
  const fixed = (d: WeeklyInput) => (isDay(d) ? d.method !== 'none' : d.fixedDays > 0);
  const gap = (d: WeeklyInput) => (isDay(d) ? d.method === 'gap' : d.gapDays > 0);
  // Holiday days that were left as reported (not fixed for a full outage).
  const holiday = (d: WeeklyInput) => (isDay(d) ? d.holiday && d.method === 'none' : d.holidayDays > 0);
  const startOf = (d: WeeklyInput) => (isDay(d) ? d.day : d.start);
  const endOf = (d: WeeklyInput) => (isDay(d) ? d.day : d.end);

  const weeks: Point[] = [];
  for (let end = daily.length; end - 7 >= 0; end -= 7) {
    const w = daily.slice(end - 7, end);
    weeks.unshift({
      start: startOf(w[0]!),
      end: endOf(w[6]!),
      raw: w.reduce((s, d) => s + d.raw, 0),
      corrected: w.reduce((s, d) => s + d.corrected, 0),
      fixedDays: w.filter(fixed).length,
      gapDays: w.filter(gap).length,
      holidayDays: w.filter(holiday).length,
    });
  }
  return weeks;
}
