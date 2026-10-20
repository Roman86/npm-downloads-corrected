// Period slicing: young packages vs outages on the first day of the period.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { correctSeries } from '../src/lib/correct.ts';
import { slicePeriod } from '../src/lib/period.ts';
import type { DayPoint, Point } from '../src/types.ts';

const toPoints = (days: ReturnType<typeof correctSeries>): Point[] =>
  days.map((d) => ({
    start: d.day,
    end: d.day,
    raw: d.raw,
    corrected: d.corrected,
    fixedDays: d.method === 'none' ? 0 : 1,
    gapDays: d.method === 'gap' ? 1 : 0,
    holidayDays: d.holiday && d.method === 'none' ? 1 : 0,
  }));

test('an npm-wide outage on the first day of the period is not a package launch', () => {
  // Real data: 2026-10-13…15 are full outages (0 for every package).
  const f = JSON.parse(readFileSync(new URL('./fixtures/npm-2026-08-01_2026-10-18.json', import.meta.url), 'utf8')) as {
    series: Record<string, DayPoint[]>;
  };
  const [target, ...refs] = Object.values(f.series);
  const daily = toPoints(correctSeries(target!, refs));
  const week = slicePeriod(daily, '2026-10-12', '2026-10-18', { start: '2026-10-05', end: '2026-10-11' });
  assert.equal(week.trimmed, false);
  assert.equal(week.period.length, 7);

  const outageFirst = slicePeriod(daily, '2026-10-13', '2026-10-18', { start: '2026-10-06', end: '2026-10-11' });
  assert.equal(outageFirst.trimmed, false, 'raw 0 on an outage day must not trim the period');
  assert.equal(outageFirst.period.length, 6);
  assert.equal(outageFirst.prev?.length, 6);
});

test('a young package drops the days before its first download', () => {
  const day = (i: number, raw: number): Point => ({
    start: `2026-09-${String(i).padStart(2, '0')}`,
    end: `2026-09-${String(i).padStart(2, '0')}`,
    raw,
    corrected: raw,
    fixedDays: 0,
    gapDays: 0,
    holidayDays: 0,
  });
  const daily = [day(1, 0), day(2, 0), day(3, 0), day(4, 5), day(5, 7), day(6, 0), day(7, 9)];
  const s = slicePeriod(daily, '2026-09-01', '2026-09-07', { start: '2026-08-25', end: '2026-08-31' });
  assert.equal(s.trimmed, true);
  assert.deepEqual(s.period.map((d) => d.raw), [5, 7, 0, 9]);
  assert.equal(s.prev, null, 'previous period without data is dropped');
  assert.equal(slicePeriod([day(1, 0), day(2, 0)], '2026-09-01', '2026-09-02', null).empty, true);
});
