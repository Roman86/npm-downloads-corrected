// Data for the panel: settings and UI preferences (chrome.storage), the
// background worker (typed messages) and the corrected series for a period.
import { DEFAULTS } from '../defaults.ts';
import { correctSeries, toWeekly } from '../lib/correct.ts';
import { addDays, DEFAULT_RANGE, slicePeriod, windowFor, type PeriodWindow, type Range } from '../lib/period.ts';
import type { Point, RecentState, Request, Response, ResultOf, Settings } from '../types.ts';

// ---- storage -----------------------------------------------------------------

export function getSettings(): Promise<Settings> {
  const defaults: Settings = { ...DEFAULTS, range: DEFAULT_RANGE };
  return new Promise((resolve) =>
    chrome.storage.sync.get(defaults, (s) => resolve({ ...defaults, ...(s as Partial<Settings>) }))
  );
}
export const saveRange = (range: string) => chrome.storage.sync.set({ range });

// Collapsed state is a local UI preference (not synced across devices).
export function getCollapsed(): Promise<boolean> {
  return new Promise((resolve) => chrome.storage.local.get({ 'ui.collapsed': false }, (s) => resolve(!!s['ui.collapsed'])));
}
export const saveCollapsed = (collapsed: boolean) => chrome.storage.local.set({ 'ui.collapsed': collapsed });

// Recent / starred packages: { recent: [...], starred: [...] } (lib/recent.ts).
export const RECENT_KEY = 'ui.recent';
export const loadRecent = () =>
  new Promise<unknown>((res) => chrome.storage.local.get({ [RECENT_KEY]: null }, (s) => res(s[RECENT_KEY] ?? {})));
export const saveRecent = (v: RecentState) => chrome.storage.local.set({ [RECENT_KEY]: v });

// ---- background worker ---------------------------------------------------------

/** Typed request to the background worker. */
export function send<T extends Request>(msg: T): Promise<ResultOf[T['type']]> {
  return new Promise((resolve, reject) =>
    chrome.runtime.sendMessage(msg, (r?: Response<ResultOf[T['type']]>) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!r) return reject(new Error('no response'));
      if (!r.ok) return reject(new Error(r.error));
      resolve(r);
    })
  );
}

// ---- a period's data -----------------------------------------------------------

export interface View {
  w: PeriodWindow;
  daily: Point[];
  period: Point[];
  prev: Point[] | null;
  points: Point[];
  prevPoints: Point[] | null;
  trimmed: boolean;
  empty: boolean;
  refs: string[];
}

export async function compute(pkg: string, settings: Settings, range: Range, offset: number): Promise<View> {
  const w = windowFor(range, offset);
  const pad = settings.baselineWeeks * 7;
  const fetchStart = addDays(range.compare ? w.prevStart : w.start, -pad);
  const fetchEnd = addDays(w.end, pad); // background caps at yesterday

  const refs = settings.references.filter((r) => r && r !== pkg);
  const resp = await send({ type: 'fetchSeries', packages: [pkg, ...refs], start: fetchStart, end: fetchEnd });
  const target = resp.series[0];
  if (!target?.data) throw new Error(target?.error || 'no data');
  const goodRefs = resp.series.slice(1).filter((r) => r.data && r.data.length);
  if (!goodRefs.length) throw new Error('failed to load reference packages');

  const daily: Point[] = correctSeries(target.data, goodRefs.map((r) => r.data ?? []), settings).map((d) => ({
    start: d.day,
    end: d.day,
    raw: d.raw,
    corrected: d.corrected,
    fixedDays: d.method === 'none' ? 0 : 1,
    gapDays: d.method === 'gap' ? 1 : 0,
    holidayDays: d.holiday && d.method === 'none' ? 1 : 0,
  }));
  const { period, prev, trimmed, empty } = slicePeriod(
    daily,
    w.start,
    w.end,
    range.compare ? { start: w.prevStart, end: w.prevEnd } : null
  );
  const toPoints = (arr: Point[]) => (range.gran === 'week' ? toWeekly(arr) : arr);
  return {
    w,
    daily,
    period,
    prev,
    points: toPoints(period),
    prevPoints: prev ? toPoints(prev) : null,
    trimmed,
    empty,
    refs: goodRefs.map((r) => r.name),
  };
}
