// Correction algorithm: synthetic outages, package-level gaps, real npm data.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { correctSeries, isHoliday, toWeekly } from '../src/lib/correct.ts';
import type { DayPoint } from '../src/types.ts';

function rng(seed: number): () => number {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
const WEEKDAY = [0.55, 1, 1.05, 1.05, 1.02, 0.98, 0.6];
const wd = (i: number) => WEEKDAY[i % 7]!;
const isoDays = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(from + i * 864e5).toISOString().slice(0, 10));

test('synthetic npm-wide outages: errors drop, clean days untouched', (t) => {
  const DAYS = 400;
  const days = isoDays(Date.UTC(2025, 8, 1), DAYS);

  // Pipeline loss: same fraction lost for everyone on these days.
  const capture = new Array<number>(DAYS).fill(1);
  const r = rng(7);
  for (let k = 0; k < 40; k++) capture[Math.floor(r() * DAYS)] = 0.3 + r() * 0.5; // partial
  capture[200] = 0.02; // near-total outage

  const make = (base: number, growth: number, noise: number, seed: number) => {
    const n = rng(seed);
    const truth = days.map((_, i) => base * (1 + growth * i) * wd(i) * (1 + (n() - 0.5) * noise));
    const observed: DayPoint[] = truth.map((v, i) => ({ day: days[i]!, downloads: Math.round(v * capture[i]!) }));
    return { truth, observed };
  };

  const target = make(20000, 0.002, 0.25, 1); // small, noisy package
  const refs = [1, 2, 3, 4, 5].map((s) => make(5e7 * s, 0.0005, 0.03, 100 + s).observed);
  const out = correctSeries(target.observed, refs);

  const err = (key: 'raw' | 'corrected') => {
    let e = 0;
    for (let i = 28; i < DAYS - 28; i++) e += Math.abs(out[i]![key] - target.truth[i]!) / target.truth[i]!;
    return e / (DAYS - 56);
  };
  const before = err('raw'), after = err('corrected');
  t.diagnostic(`mean daily abs error: npm ${(before * 100).toFixed(1)}% → corrected ${(after * 100).toFixed(1)}%`);

  const wk = toWeekly(out);
  let wb = 0, wa = 0, n = 0;
  for (let k = 4; k < wk.length - 4; k++) {
    const endIdx = days.indexOf(wk[k]!.end);
    const truthW = target.truth.slice(endIdx - 6, endIdx + 1).reduce((a, b) => a + b, 0);
    wb += Math.abs(wk[k]!.raw - truthW) / truthW;
    wa += Math.abs(wk[k]!.corrected - truthW) / truthW;
    n++;
  }
  t.diagnostic(`mean weekly abs error: npm ${((wb / n) * 100).toFixed(1)}% → corrected ${((wa / n) * 100).toFixed(1)}%`);

  assert(after < before / 2, 'daily error should drop at least 2x');
  assert(wa < wb / 2, 'weekly error should drop at least 2x');
  assert.equal(out[200]!.method, 'baseline');
  // A day without loss must stay untouched.
  const clean = capture.findIndex((c, i) => c === 1 && i > 30);
  assert.equal(out[clean]!.corrected, out[clean]!.raw);
});

test('package-level gaps: npm loses a day for this package only', () => {
  const N = 120;
  const ds = isoDays(Date.UTC(2026, 3, 1), N);
  const r2 = rng(42);
  const series = (base: number, noise: number, zeroDays: number[] = [], cap = (_i: number) => 1): DayPoint[] =>
    ds.map((day, i) => ({
      day,
      downloads: zeroDays.includes(i) ? 0 : Math.round(base * wd(i) * (1 + (r2() - 0.5) * noise) * cap(i)),
    }));
  const refOutage = 70; // references lose 60% on this day
  const cap = (i: number) => (i === refOutage ? 0.4 : 1);
  const refs = [1, 2, 3].map((k) => series(4e7 * k, 0.03, [], cap));

  // big package: isolated zeros, a 4-day run of zeros, and a zero on the reference-outage day
  const gaps = [40, 55, 90, 91, 92, 93, refOutage];
  const outBig = correctSeries(series(20000, 0.2, gaps, cap), refs);
  for (const i of gaps) {
    assert.equal(outBig[i]!.method, 'gap', `day ${i} should be a gap`);
    const expected = 20000 * wd(i);
    assert(Math.abs(outBig[i]!.corrected - expected) / expected < 0.25, `day ${i} filled near usual level`);
  }
  assert.equal(outBig.filter((d) => d.method === 'gap').length, gaps.length, 'no extra gap days');

  // small package with genuine zero days: untouched
  const small = ds.map((day, i) => ({ day, downloads: Math.max(0, Math.round(20 * wd(i) + (r2() - 0.5) * 30)) }));
  assert(small.some((d) => d.downloads === 0), 'small package has real zeros');
  assert.equal(correctSeries(small, refs).filter((d) => d.method === 'gap').length, 0, 'small package: no gap filling');

  // young package: zeros before launch are not "gaps"
  const launch = 60;
  const young = ds.map((day, i) => ({ day, downloads: i < launch ? 0 : Math.round(5000 * wd(i)) }));
  const outYoung = correctSeries(young, refs);
  assert.equal(outYoung.slice(0, launch).filter((d) => d.method === 'gap').length, 0, 'pre-launch zeros untouched');
});

// Real data: tailwindcss-scoped-preflight + references, Aug 1 – Oct 18, 2026.
// npm reported 0 for every package on several days, several of them Tuesdays
// (Sep 8, Sep 15, Oct 6, Oct 13). The weekday baseline must skip those zeros,
// otherwise its median collapses to 0 and the day stays at 0.
test('real data: npm-wide zero days are filled, last week ≈ 119k', (t) => {
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/npm-2026-08-01_2026-10-18.json', import.meta.url), 'utf8')
  ) as { series: Record<string, DayPoint[]> };
  const f = fixture.series;
  const refs = ['semver', 'debug', 'ms', 'chalk', 'tslib'].map((k) => f[k]!);
  const out = correctSeries(f['tailwindcss-scoped-preflight']!, refs);

  const zeroDays = out.filter((d) => d.raw === 0);
  assert.equal(zeroDays.length, 9);
  for (const d of zeroDays) {
    assert.notEqual(d.method, 'none', `${d.day} must be corrected`);
    const w = new Date(d.day).getUTCDay();
    const weekday = w >= 1 && w <= 5;
    assert(weekday ? d.corrected > 15000 && d.corrected < 28000 : d.corrected > 2000, `${d.day} filled (${d.corrected})`);
  }
  const week = out.filter((d) => d.day >= '2026-10-12' && d.day <= '2026-10-18');
  const raw = week.reduce((s, d) => s + d.raw, 0);
  const corr = week.reduce((s, d) => s + d.corrected, 0);
  assert.equal(raw, 52587); // matches npm's own weekly number on the page
  assert(corr > 110000 && corr < 130000, `last week corrected ${corr}`);
  t.diagnostic(`last week npm ${raw} → corrected ${corr}`);
});

// Real data: Christmas 2024. References drop to ~50% and the package (installed
// by people, not CI) to ~29% — a real holiday dip, not an outage. It must stay
// as reported; before the holiday rule the week was "corrected" 11,339 → 21,663.
test('real data: holiday season is not corrected, full outages still are', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/npm-2024-11-04_2025-01-26.json', import.meta.url), 'utf8')
  ) as { series: Record<string, DayPoint[]> };
  const f = fixture.series;
  const names = ['semver', 'debug', 'ms', 'chalk', 'tslib'];
  const target = f['tailwindcss-scoped-preflight']!;
  const out = correctSeries(target, names.map((k) => f[k]!));

  const week = (a: string, b: string) => out.filter((d) => d.day >= a && d.day <= b);
  const xmas = week('2024-12-23', '2024-12-29');
  assert.equal(xmas.reduce((s, d) => s + d.corrected, 0), 11339);
  assert(xmas.every((d) => d.holiday && d.method === 'none'));
  assert(week('2024-12-30', '2025-01-05').every((d) => d.method === 'none'), 'New Year week untouched');
  const thanks = out.find((d) => d.day === '2024-11-28')!;
  assert(thanks.holiday && thanks.method === 'none', 'Thanksgiving untouched');
  assert(!out.find((d) => d.day === '2025-01-07')!.holiday, 'normal days are not holidays');

  // A full npm outage on Christmas (everyone reports 0) is still filled.
  const zeroOn = (s: DayPoint[]) => s.map((d) => (d.day === '2024-12-25' ? { ...d, downloads: 0 } : d));
  const outZero = correctSeries(zeroOn(target), names.map((k) => zeroOn(f[k]!)));
  const xmasDay = outZero.find((d) => d.day === '2024-12-25')!;
  assert.equal(xmasDay.method, 'baseline');
  assert(xmasDay.corrected > 5000, `filled (${xmasDay.corrected})`);
});

test('isHoliday: Christmas–New Year window and Thanksgiving', () => {
  for (const d of ['2024-12-22', '2024-12-25', '2025-01-01', '2025-01-05', '2024-11-28', '2024-11-29', '2025-11-27', '2026-11-26'])
    assert(isHoliday(d), d);
  for (const d of ['2024-12-21', '2025-01-06', '2024-11-21', '2024-11-27', '2025-11-20', '2026-07-04'])
    assert(!isHoliday(d), d);
});
