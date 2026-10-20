// npm Downloads Corrected — content script for npmjs.com/package/* pages.
// Shows a floating panel (bottom-right, Shadow DOM) with download counts
// corrected for npm's stats outages, a period chart, and a Packages menu.
import { DEFAULTS } from './defaults.ts';
import { correctSeries, toWeekly } from './lib/correct.ts';
import { compact, mount, type Granularity } from './lib/chart.ts';
import { slicePeriod } from './lib/period.ts';
import * as R from './lib/recent.ts';
import { STYLES } from './lib/styles.ts';
import type {
  AuthorPackagesResult,
  Point,
  RangeId,
  RecentState,
  Request,
  Response,
  ResultOf,
  Settings,
} from './types.ts';

const PANEL_ID = 'npm-downloads-corrected';
const NPM_EPOCH = '2015-01-10';
const DAY = 864e5;

interface Range {
  id: RangeId;
  label: string;
  title: string;
  days: number;
  gran: Granularity;
  compare: boolean; // draw the previous period as a shadow line
}

const RANGES: readonly Range[] = [
  { id: '1w', label: '1W', title: 'Week', days: 7, gran: 'day', compare: true },
  { id: '1m', label: '1M', title: 'Month', days: 30, gran: 'day', compare: true },
  { id: '3m', label: '3M', title: 'Quarter', days: 91, gran: 'day', compare: true },
  { id: '1y', label: '1Y', title: 'Year', days: 52 * 7, gran: 'week', compare: true },
  { id: '2y', label: '2Y', title: '2 years', days: 104 * 7, gran: 'week', compare: false },
  { id: '5y', label: '5Y', title: '5 years', days: 261 * 7, gran: 'week', compare: false },
];
const DEFAULT_RANGE: RangeId = '1y';
const rangeById = (id: string | null | undefined): Range =>
  RANGES.find((r) => r.id === id) ?? RANGES.find((r) => r.id === DEFAULT_RANGE)!;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ESC[c]!);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(Date.parse(day + 'T00:00:00Z') + n * DAY);
const yesterday = () => iso(Date.now() - DAY);
const human = (day: string) => {
  const [y, m = 1, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const pctStr = (a: number, b: number) => {
  if (!b) return '';
  const p = ((a - b) / b) * 100;
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`;
};
// Shadow shift: the period rounded up to whole weeks, so weekdays line up.
const shiftOf = (range: Range) => Math.ceil(range.days / 7) * 7;
const short = compact;
const errorText = (err: unknown) => String((err instanceof Error && err.message) || err);

/** querySelector that fails loudly: the panel markup is ours, so a miss is a bug. */
function $<T extends Element = HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<Element>(sel);
  if (!el) throw new Error(`[npm-downloads-corrected] missing ${sel}`);
  return el as T;
}
/** Closest ancestor of an event target matching sel (targets may be text nodes). */
const closest = <T extends Element = HTMLElement>(target: EventTarget | null, sel: string): T | null =>
  target instanceof Element ? (target.closest(sel) as T | null) : null;

function packageFromUrl(): string | null {
  const m = location.pathname.match(/^\/package\/((?:@[^/]+\/)?[^/]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function getSettings(): Promise<Settings> {
  const defaults: Settings = { ...DEFAULTS, range: DEFAULT_RANGE };
  return new Promise((resolve) =>
    chrome.storage.sync.get(defaults, (s) => resolve({ ...defaults, ...(s as Partial<Settings>) }))
  );
}

// Collapsed state is a local UI preference (not synced across devices).
function getCollapsed(): Promise<boolean> {
  return new Promise((resolve) => chrome.storage.local.get({ 'ui.collapsed': false }, (s) => resolve(!!s['ui.collapsed'])));
}

/** Typed request to the background worker. */
function send<T extends Request>(msg: T): Promise<ResultOf[T['type']]> {
  return new Promise((resolve, reject) =>
    chrome.runtime.sendMessage(msg, (r?: Response<ResultOf[T['type']]>) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!r) return reject(new Error('no response'));
      if (!r.ok) return reject(new Error(r.error));
      resolve(r);
    })
  );
}

const fetchSeries = (packages: string[], start: string, end: string) =>
  send({ type: 'fetchSeries', packages, start, end });

const log = (...a: unknown[]) => console.info('[npm-downloads-corrected]', ...a);

// Skeletons are the real markup (same elements and classes) with placeholder
// text drawn as shimmer bars (.ph), so every line has exactly the height it
// will have with data — in any font — and nothing moves when data lands.
// (The panel is anchored to the bottom: any height change would shift it all.)
const sk = (w: string, h: number, extra = '') => `<span class="skel" style="width:${w};height:${h}px;${extra}"></span>`;
const ph = (text: string) => `<span class="ph" aria-hidden="true">${text}</span>`;
const SKEL_SUMMARY = `
    <div class="stat-label">last 7 days</div>
    <div class="row"><span class="big">${ph('000,000')}</span></div>
    <div class="muted">${ph('npm: 000,000')}</div>
    <div class="muted">${ph('vs previous 7 days +0.0% (+0,000)')}</div>`;
const SKEL_PERIOD = `<div class="stats">${[
  ['Year', '0,000,000', 'npm 0.0M'],
  ['adjustment', '+0.0%', '+000K'],
  ['change', '+0.0%', 'prev. 0.0M'],
]
  .map(
    ([label, value, note]) => `<div class="stat">
       <div class="stat-label">${ph(label!)}</div>
       <div class="stat-value">${ph(value!)}</div>
       <div class="stat-note">${ph(note!)}</div>
     </div>`
  )
  .join('')}</div>`;
const SKEL_CHART = `<div class="chart-skel" aria-hidden="true">
    <div class="chart-skel-y">${sk('22px', 8)}${sk('22px', 8)}${sk('10px', 8)}</div>
    <div class="skel chart-skel-plot"></div>
    <div class="chart-skel-x">${sk('20px', 8)}${sk('20px', 8)}${sk('20px', 8)}${sk('20px', 8)}${sk('20px', 8)}</div>
  </div>`;

// The panel lives in a shadow root so npm's CSS can't leak into it (and
// ours can't leak out). host goes into the page, panel is the root element
// inside the shadow tree.
function createPanel(): { host: HTMLElement; panel: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement('div');
  host.id = PANEL_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  const panel = document.createElement('div');
  panel.className = 'root';
  const pop = document.createElement('div');
  pop.className = 'recent-pop';
  pop.hidden = true;
  shadow.append(style, panel, pop);
  panel.innerHTML = `
    <div class="head" role="button" tabindex="0" aria-expanded="true" title="Collapse / expand">
      <div class="title" title="npm downloads, corrected for outages">Corrected downloads</div>
      <span class="mini"></span>
      <button type="button" class="recent-btn" aria-haspopup="true" aria-expanded="false" title="Recent packages and more by this author">Packages<span class="caret" aria-hidden="true"></span></button>
      <span class="toggle" aria-hidden="true"></span>
    </div>
    <div class="summary" aria-busy="true">${SKEL_SUMMARY}</div>
    <div class="ranges" role="tablist">
      ${[...RANGES].reverse().map((r) => `<button type="button" role="tab" data-range="${r.id}" title="${r.title}">${r.label}</button>`).join('')}
    </div>
    <div class="nav">
      <button type="button" class="arrow" data-dir="-1" title="Previous period" aria-label="Previous period">‹</button>
      <span class="dates"></span>
      <button type="button" class="arrow" data-dir="1" title="Next period" aria-label="Next period">›</button>
    </div>
    <div class="period muted">${SKEL_PERIOD}</div>
    <div class="chart-box" aria-busy="true"><div class="chart-slot">${SKEL_CHART}</div></div>
    <div class="legend">
      <span><i class="sw sw-raw"></i>npm</span>
      <span><i class="sw sw-corr"></i>corrected</span>
      <span class="legend-prev"><i class="sw sw-prev"></i>previous period</span>
      <span class="muted fixed-count">${ph('Weeks with outages: 0/52')}</span>
    </div>
    <div class="muted small refs">${ph('references: semver, debug, ms, chalk')}</div>`;
  return { host, panel, shadow };
}

interface PeriodWindow {
  start: string;
  end: string;
  prevStart: string;
  prevEnd: string;
}

interface View {
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

/** Per-page state; reset whenever the package changes. */
interface PageState {
  pkg: string;
  settings: Settings;
  host: HTMLElement;
  shadow: ShadowRoot;
  panel: HTMLElement;
  cache: Map<string, Promise<View>>;
  range: RangeId | null;
  offset: number;
  view: View | null;
  gran: Granularity;
  themeTimer: ReturnType<typeof setTimeout> | undefined;
  themeKey: string | null;
  ro: ResizeObserver | null;
  recent: RecentState | null;
  closeRecent: (() => void) | null;
  rerenderRecent: (() => void) | null;
}

let state: PageState | null = null;
let lastPkg: string | null = null; // package of the current page (set by check())

function windowFor(range: Range, offset: number): PeriodWindow {
  const end = addDays(yesterday(), -offset * range.days);
  const start = addDays(end, -(range.days - 1));
  const prevEnd = addDays(end, -shiftOf(range));
  const prevStart = addDays(prevEnd, -(range.days - 1));
  return { start, end, prevStart, prevEnd };
}

async function compute(st: PageState, range: Range, offset: number): Promise<View> {
  const { settings, pkg } = st;
  const w = windowFor(range, offset);
  const pad = settings.baselineWeeks * 7;
  const fetchStart = addDays(range.compare ? w.prevStart : w.start, -pad);
  const fetchEnd = addDays(w.end, pad); // background caps at yesterday

  const refs = settings.references.filter((r) => r && r !== pkg);
  const resp = await fetchSeries([pkg, ...refs], fetchStart, fetchEnd);
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

async function show(rangeId: string | null, offset: number): Promise<void> {
  const st = state;
  if (!st) return;
  const range = rangeById(rangeId);
  const { panel } = st;
  st.range = range.id;
  st.offset = offset;
  const key = `${range.id}:${offset}`;
  const isCurrent = () => st === state && st.range === range.id && st.offset === offset;

  panel.querySelectorAll<HTMLButtonElement>('.ranges button').forEach((b) =>
    b.setAttribute('aria-selected', String(b.dataset['range'] === range.id))
  );
  const w = windowFor(range, offset);
  $(panel, '.dates').textContent = `${human(w.start)} – ${human(w.end)}`;
  const [left, right] = panel.querySelectorAll<HTMLButtonElement>('.arrow');
  if (!left || !right) return;
  right.disabled = offset === 0;
  left.disabled = true; // enabled once we know there's earlier data
  const box = $(panel, '.chart-box');
  const periodEl = $(panel, '.period');
  const slot = $(panel, '.chart-slot');
  const cached = st.cache.has(key);
  if (!st.view) {
    // Nothing on screen yet (first load or after an error): skeletons.
    periodEl.innerHTML = SKEL_PERIOD;
    slot.innerHTML = SKEL_CHART;
  } else if (!cached) {
    // Keep the previous chart and numbers, dimmed, until the new ones arrive.
    box.classList.add('loading');
    periodEl.classList.add('loading');
  }
  box.setAttribute('aria-busy', 'true');

  try {
    let job = st.cache.get(key);
    if (!job) st.cache.set(key, (job = compute(st, range, offset)));
    const v = await job;
    if (!isCurrent()) return;

    if (offset === 0) renderSummary(panel, v.daily);
    renderPeriod(panel, v, range);
    left.disabled = v.empty || v.trimmed || w.start <= NPM_EPOCH;
    $(panel, '.legend-prev').hidden = !v.prevPoints;
    mount(slot, v.points, { granularity: range.gran, prev: v.prevPoints });
    st.view = v;
    st.gran = range.gran;
  } catch (err) {
    st.cache.delete(key);
    if (!isCurrent()) return;
    st.view = null;
    slot.innerHTML = `<div class="err">Error: ${esc(errorText(err))}</div>`;
    periodEl.innerHTML = '';
    $(panel, '.fixed-count').textContent = '';
    $(panel, '.refs').textContent = '';
    const summary = $(panel, '.summary');
    if (summary.getAttribute('aria-busy') === 'true') {
      summary.innerHTML = '<div class="muted">—</div>';
      summary.removeAttribute('aria-busy');
    }
  } finally {
    if (isCurrent()) {
      box.classList.remove('loading');
      periodEl.classList.remove('loading');
      box.removeAttribute('aria-busy');
    }
  }
}

const sum = (arr: readonly Point[], k: 'raw' | 'corrected') => arr.reduce((s, d) => s + d[k], 0);

// Headline: the last 7 days, same window as npm's own "Weekly Downloads".
function renderSummary(panel: HTMLElement, daily: readonly Point[]): void {
  const upToYesterday = daily.filter((d) => d.start <= yesterday());
  const last = upToYesterday.slice(-7);
  const raw = sum(last, 'raw');
  const corr = sum(last, 'corrected');
  const fixed = last.filter((d) => d.fixedDays).length;
  // Same comparison as the chart's shadow line: vs the 7 days before.
  const prev7 = upToYesterday.slice(-14, -7);
  const prevCorr = prev7.length === 7 ? sum(prev7, 'corrected') : 0;
  const diff = corr - prevCorr;
  const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;
  // Always one line (a dash when there's nothing to compare with), so the
  // summary has the same height for every package.
  const vsPrev = prevCorr
    ? `<div class="muted">vs previous 7 days <span class="${diff >= 0 ? 'up' : 'down'}">${pctStr(corr, prevCorr)}</span> (${signed(diff)})</div>`
    : '<div class="muted">vs previous 7 days —</div>';
  $(panel, '.mini').textContent = `${fmt(corr)} corrected · 7 days`;
  const summaryEl = $(panel, '.summary');
  summaryEl.removeAttribute('aria-busy');
  summaryEl.innerHTML = `
    <div class="stat-label">last 7 days</div>
    <div class="row">
      <span class="big">${fmt(corr)}</span>
      ${fixed ? `<span class="badge" title="How much npm undercounted because of outages">adjusted ${pctStr(corr, raw)}</span>` : ''}
    </div>
    <div class="muted">npm: ${fmt(raw)}</div>
    ${vsPrev}`;
}

function renderPeriod(panel: HTMLElement, v: View, range: Range): void {
  const raw = sum(v.period, 'raw');
  const corr = sum(v.period, 'corrected');
  // Fixed grid of stat cells (label / value / note) instead of a sentence,
  // so nothing wraps mid-phrase in npm's narrow sidebar.
  const cell = (label: string, value: string, note: string, cls = '', title = '') =>
    `<div class="stat"${title ? ` title="${title}"` : ''}>
       <div class="stat-label">${label}</div>
       <div class="stat-value ${cls}">${value}</div>
       <div class="stat-note">${note}</div>
     </div>`;
  // Always the same three cells and no extra lines, so the panel keeps its
  // height for every package and period (it's anchored to the bottom).
  const firstDay = v.period[0];
  const young = v.trimmed && firstDay;
  const cells = [
    cell(
      young ? `since ${human(firstDay.start)}` : range.title,
      fmt(corr),
      `npm ${short(raw)}`,
      'strong',
      young
        ? `Data since ${human(firstDay.start)}: the package is younger than the period. Corrected total; below it — as reported by npm`
        : 'Corrected total; below it — as reported by npm'
    ),
    cell(
      'adjustment',
      corr !== raw ? pctStr(corr, raw) : '0%',
      corr !== raw ? `+${short(corr - raw)}` : v.empty ? 'no downloads' : 'no outages',
      '',
      'How much npm undercounted because of outages'
    ),
  ];
  const p = v.prev ? sum(v.prev, 'corrected') : 0;
  const s = pctStr(corr, p);
  cells.push(
    s
      ? cell('change', s, `prev. ${short(p)}`, corr >= p ? 'up' : 'down', 'Change vs the previous period')
      : cell('change', '—', range.compare ? 'new package' : 'not shown', '', range.compare ? 'No data for the previous period yet' : 'Not compared for periods over a year')
  );
  const html = `<div class="stats">${cells.join('')}</div>`;
  $(panel, '.period').innerHTML = html;

  const unit = range.gran === 'week' ? 'Weeks' : 'Days';
  const bad = v.points.filter((p) => p.fixedDays).length;
  $(panel, '.fixed-count').textContent = v.points.length ? `${unit} with outages: ${bad}/${v.points.length}` : '';
  $(panel, '.refs').textContent = `references: ${v.refs.join(', ')}`;
}

function teardown(): void {
  if (state) {
    state.ro?.disconnect();
    clearTimeout(state.themeTimer);
    state.closeRecent?.();
    state.host.remove();
  }
  document.getElementById(PANEL_ID)?.remove();
  state = null;
}

async function start(pkg: string): Promise<void> {
  teardown();
  let settings: Settings, collapsed: boolean;
  try {
    [settings, collapsed] = await Promise.all([getSettings(), getCollapsed()]);
  } catch (err) {
    log('failed to read settings', err);
    return;
  }
  // The user may have navigated away while settings were loading.
  if (packageFromUrl() !== pkg || lastPkg !== pkg || state) return;
  const { host, panel, shadow } = createPanel();
  const st: PageState = {
    pkg,
    settings,
    host,
    shadow,
    panel,
    cache: new Map(),
    range: null,
    offset: 0,
    view: null,
    gran: 'week',
    themeTimer: undefined,
    themeKey: null,
    ro: null,
    recent: null,
    closeRecent: null,
    rerenderRecent: null,
  };
  state = st;
  setCollapsed(st, collapsed);
  ensurePlaced();
  applyTheme();
  // npm may still be rendering its sidebar (font, sparkline colour): re-read
  // the theme a few times shortly after load. Site theme switches are caught
  // by the attribute observer below.
  const retheme = (delays: number[]) => {
    const [delay, ...rest] = delays;
    if (delay === undefined || st !== state) return;
    st.themeTimer = setTimeout(() => {
      applyTheme();
      retheme(rest);
    }, delay);
  };
  retheme([500, 1500, 4000]);

  const head = $(panel, '.head');
  const toggle = () => {
    const next = !host.classList.contains('ndc-collapsed');
    setCollapsed(st, next);
    chrome.storage.local.set({ 'ui.collapsed': next });
  };
  head.addEventListener('click', (e) => {
    if (closest(e.target, '.recent-btn')) return;
    toggle();
  });
  setupRecent(st);
  head.addEventListener('keydown', (e) => {
    if (e.target !== head) return; // e.g. Enter on the Packages button
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  $(panel, '.ranges').addEventListener('click', (e) => {
    const btn = closest<HTMLButtonElement>(e.target, 'button[data-range]');
    const id = btn?.dataset['range'];
    if (!id || id === st.range) return;
    chrome.storage.sync.set({ range: id });
    show(id, 0); // a new range starts from "now"
  });
  $(panel, '.nav').addEventListener('click', (e) => {
    const btn = closest<HTMLButtonElement>(e.target, 'button.arrow');
    if (!btn || btn.disabled) return;
    // Left arrow (dir -1) goes back in time = larger offset.
    show(st.range, Math.max(0, st.offset - Number(btn.dataset['dir'])));
  });

  // Re-layout when the sidebar width changes.
  const slot = $(panel, '.chart-slot');
  let lastW = slot.clientWidth;
  st.ro = new ResizeObserver(() => {
    if (Math.abs(slot.clientWidth - lastW) > 4 && st === state && st.view) {
      lastW = slot.clientWidth;
      mount(slot, st.view.points, { granularity: st.gran, prev: st.view.prevPoints });
    }
  });
  st.ro.observe(slot);

  show(settings.range, 0);
}

// ---- Packages menu: Recent / starred + author's other packages -------------
// Recent: stored locally as { recent: [...], starred: [...] } (lib/recent.ts).
// By author: maintainers of this package → their packages (background.ts).
const RECENT_KEY = 'ui.recent';
const loadRecent = () =>
  new Promise<unknown>((res) => chrome.storage.local.get({ [RECENT_KEY]: null }, (s) => res(s[RECENT_KEY] ?? {})));
const saveRecent = (v: RecentState) => chrome.storage.local.set({ [RECENT_KEY]: v });
const pkgUrl = (name: string) => `https://www.npmjs.com/package/${name}`;

type AuthorState = AuthorPackagesResult | { error: string } | null; // null = loading

async function setupRecent(st: PageState): Promise<void> {
  const { pkg, shadow } = st;
  const btn = $<HTMLButtonElement>(shadow, '.recent-btn');
  const pop = $(shadow, '.recent-pop');

  const initial = R.visit(await loadRecent(), pkg);
  if (st !== state) return;
  st.recent = initial;
  saveRecent(initial);
  const recent = () => st.recent ?? initial;

  let tab: 'recent' | 'author' = 'recent';
  let author: AuthorState = null;
  let authorUser: string | null = null;

  const starOf = (name: string) => recent().starred.includes(name);
  const starBtn = (name: string, starred: boolean) => `<button type="button" class="rp-star${starred ? ' on' : ''}" data-name="${esc(name)}" aria-pressed="${starred}"
      title="${starred ? 'Unstar' : 'Star: keep on top of Recent'}">${starred ? '★' : '☆'}</button>`;
  const row = (name: string, starred: boolean, extra = '') => `
    <li class="rp-item${name === pkg ? ' current' : ''}">
      ${starBtn(name, starred)}
      <a class="rp-name" href="${esc(pkgUrl(name))}" title="${esc(name)}">${esc(name)}</a>
      ${extra}${name === pkg ? '<span class="rp-here">open</span>' : ''}
    </li>`;

  function body(): string {
    if (tab === 'recent') {
      const items = R.list(recent());
      return items.length
        ? `<ul class="rp-list">${items.map((i) => row(i.name, i.starred)).join('')}</ul>`
        : '<div class="rp-empty">Nothing yet</div>';
    }
    if (!author) {
      return `<ul class="rp-list" aria-busy="true">${['package-name-long', 'package-name', 'pkg-name-longer-one', 'pkg-name']
        // Same shape as a real row (star slot, name, weekly), placeholder text
        // as shimmer bars; not interactive.
        .map(
          (name) =>
            `<li class="rp-item rp-skel" aria-hidden="true"><span class="rp-star"></span><span class="rp-name">${ph(name)}</span><span class="rp-dl">${ph('00K/wk')}</span></li>`
        )
        .join('')}</ul>`;
    }
    if ('error' in author) return `<div class="rp-empty err">Couldn't load: ${esc(author.error)}</div>`;
    const a = author;
    if (!a.user) return '<div class="rp-empty">No maintainers listed for this package</div>';
    const who =
      a.maintainers.length > 1
        ? `<div class="rp-who">${a.maintainers
            .slice(0, 4)
            .map((m) => `<button type="button" class="rp-chip${m === a.user ? ' on' : ''}" data-user="${esc(m)}">${esc(m)}</button>`)
            .join('')}</div>`
        : '';
    const list = a.packages.length
      ? `<ul class="rp-list">${a.packages
          .map((p) =>
            row(
              p.name,
              starOf(p.name),
              p.weekly != null ? `<span class="rp-dl" title="weekly downloads (npm)">${short(p.weekly)}/wk</span>` : ''
            )
          )
          .join('')}</ul>`
      : '<div class="rp-empty">No other packages</div>';
    return who + list;
  }

  function hint(): string {
    if (tab === 'author' && author && !('error' in author) && author.user) {
      const n = author.total;
      return `<div class="rp-hint"><a href="https://www.npmjs.com/~${esc(author.user)}">@${esc(author.user)} on npm</a> · ${n} package${n === 1 ? '' : 's'} · npm weekly</div>`;
    }
    return `<div class="rp-hint">★ keeps a package on top of Recent</div>`;
  }

  function render(): void {
    const authorLabel = author && !('error' in author) && author.user ? `By @${author.user}` : 'By author';
    pop.innerHTML = `
      <div class="rp-tabs" role="tablist">
        <button type="button" role="tab" data-tab="recent" aria-selected="${tab === 'recent'}">Recent</button>
        <button type="button" role="tab" data-tab="author" aria-selected="${tab === 'author'}" title="Other packages by this package's maintainer">${esc(authorLabel)}</button>
      </div>
      <div class="rp-body">${body()}</div>
      ${hint()}`;
  }

  async function loadAuthor(user: string | null | undefined): Promise<void> {
    author = null;
    authorUser = user || null;
    render();
    try {
      const res = await send({ type: 'authorPackages', pkg, user: authorUser });
      if (st !== state) return;
      author = res;
    } catch (err) {
      if (st !== state) return;
      author = { error: errorText(err) };
    }
    if (!pop.hidden) render();
  }

  const onDocClick = (e: MouseEvent) => {
    if (!e.composedPath().includes(st.host)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      btn.focus();
    }
  };
  function open(): void {
    render();
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
  }
  function close(): void {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
  }
  st.closeRecent = close;
  st.rerenderRecent = () => {
    if (!pop.hidden) render();
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pop.hidden) open();
    else close();
  });
  pop.addEventListener('click', (e) => {
    const tabBtn = closest(e.target, '[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset['tab'] === 'author' ? 'author' : 'recent';
      if (tab === 'author' && !author) loadAuthor(authorUser);
      return render();
    }
    const chip = closest(e.target, '.rp-chip');
    if (chip) return void loadAuthor(chip.dataset['user']);
    const star = closest(e.target, '.rp-star');
    const name = star?.dataset['name'];
    if (!name) return;
    e.preventDefault();
    st.recent = R.toggleStar(recent(), name).state;
    saveRecent(st.recent);
    render();
  });
}

// Keep the list in sync when another tab changes it.
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[RECENT_KEY];
  if (area !== 'local' || !change || !state?.recent) return;
  if (change.newValue) state.recent = R.clean(change.newValue);
  state.rerenderRecent?.();
});

// ---- Theme -----------------------------------------------------------------
// Colours come from the page: background and text colour around the panel,
// accent from npm's own sparkline. Works for npm's light and dark themes.
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(str: string | null | undefined): Rgba | null {
  const m = /rgba?\(([^)]+)\)/.exec(str ?? '');
  if (!m?.[1]) return null;
  const [r = NaN, g = NaN, b = NaN, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [r, g, b].every(Number.isFinite) ? { r, g, b, a: Number.isFinite(a) ? a : 1 } : null;
}
const rgb = (r: number, g: number, b: number): Rgba => ({ r, g, b, a: 1 });
const css = (c: Rgba) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
const mix = (a: Rgba, b: Rgba, w: number): Rgba =>
  rgb(a.r * w + b.r * (1 - w), a.g * w + b.g * (1 - w), a.b * w + b.b * (1 - w));
const lum = (c: Rgba) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const contrast = (a: Rgba, b: Rgba) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const saturation = (c: Rgba) => {
  const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
  return mx ? (mx - mn) / mx : 0;
};

function pageBackground(el: Element): Rgba {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = parseColor(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0.5) return c;
  }
  const dark =
    matchMedia('(prefers-color-scheme: dark)').matches &&
    /dark/.test(getComputedStyle(document.documentElement).colorScheme || '');
  return dark ? rgb(18, 18, 18) : rgb(255, 255, 255);
}

// The most saturated stroke/fill colour in npm's sparkline, if it's an SVG.
function sparklineColor(widget: Element | null): Rgba | null {
  if (!widget) return null;
  let best: Rgba | null = null;
  for (const n of widget.querySelectorAll('svg path, svg polyline, svg line, svg rect, svg circle')) {
    const cs = getComputedStyle(n);
    for (const c of [parseColor(cs.stroke), parseColor(cs.fill)]) {
      if (c && c.a > 0.3 && saturation(c) > 0.3 && (!best || saturation(c) > saturation(best))) best = c;
    }
  }
  return best && { ...best, a: 1 };
}

// The page's font, unless it's the browser default serif (an element with no
// font set) — then a system sans-serif instead of Times.
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
function pageFont(family: string): string {
  const first = (family.split(',')[0] ?? '').trim().replace(/["']/g, '').toLowerCase();
  return !first || first === 'serif' || first.startsWith('times') ? SYSTEM_FONT : family;
}

function applyTheme(): void {
  const st = state;
  if (!st) return;
  const ref = themeSource();
  const isHeading = ref.matches('h1, h2, h3, h4, h5, h6, [role="heading"]');
  const bg = pageBackground(ref);
  const textEl = isHeading && ref.parentElement ? ref.parentElement : ref;
  let fg = parseColor(getComputedStyle(textEl).color) ?? rgb(51, 51, 51);
  const dark = lum(bg) < 0.3;
  if (contrast(fg, bg) < 3) fg = dark ? rgb(230, 230, 230) : rgb(40, 40, 40);
  let accent = isHeading ? sparklineColor(sparklineHost(ref)) : null;
  // Default: npm's sparkline purple (when the sparkline colour can't be read, e.g. a canvas).
  if (!accent || contrast(accent, bg) < 1.8) accent = dark ? rgb(155, 117, 255) : rgb(137, 86, 255);

  const v: Record<string, string> = {
    '--bg': css(bg),
    '--fg-strong': css(fg),
    '--fg': css(mix(fg, bg, 0.85)),
    '--muted': css(mix(fg, bg, 0.55)),
    '--faint': css(mix(fg, bg, 0.08)),
    '--border': css(mix(fg, bg, 0.16)),
    '--subtle': css(mix(fg, bg, 0.07)),
    '--raised': dark ? css(mix(fg, bg, 0.16)) : '#fff',
    '--raw': css(mix(fg, bg, 0.4)),
    '--prev': css(mix(fg, bg, 0.5)),
    '--accent': css(accent),
    '--up': dark ? '#4cc38a' : '#2e8b57',
    '--down': dark ? '#ff6b6b' : '#cb3837',
    '--tip-bg': dark ? css(mix(fg, bg, 0.14)) : 'rgba(32, 32, 32, .94)',
    '--tip-fg': dark ? css(fg) : '#fff',
    '--tip-muted': dark ? css(mix(fg, bg, 0.65)) : '#c8c8c8',
    '--tip-border': dark ? css(mix(fg, bg, 0.25)) : 'transparent',
    '--skel-a': css(mix(fg, bg, 0.08)),
    '--skel-b': css(mix(fg, bg, 0.03)),
    '--shadow': dark ? '0 6px 24px rgba(0, 0, 0, .55)' : '0 6px 24px rgba(0, 0, 0, .14)',
    '--font': pageFont(getComputedStyle(ref).fontFamily),
  };
  const key = JSON.stringify(v);
  if (key === st.themeKey) return;
  st.themeKey = key;
  for (const [k, val] of Object.entries(v)) st.host.style.setProperty(k, val);
}

// Re-theme when the site switches light/dark (class/attribute on <html> or
// <body>) or the OS scheme changes.
let themeScheduled = false;
const scheduleTheme = () => {
  if (themeScheduled) return;
  themeScheduled = true;
  requestAnimationFrame(() => {
    themeScheduled = false;
    applyTheme();
  });
};
const themeObserver = new MutationObserver(scheduleTheme);
for (const el of [document.documentElement, document.body]) {
  themeObserver.observe(el, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-color-scheme'],
  });
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleTheme);

// ---- Placement -----------------------------------------------------------
// Always a floating panel in the bottom-right corner, attached to <body>
// (not npm's React tree, so npm's re-renders and CSS don't affect it).
function ensurePlaced(): void {
  if (!state || state.host.isConnected) return;
  document.body.appendChild(state.host);
  let version = '?';
  try {
    version = chrome.runtime.getManifest().version;
  } catch {
    /* extension context gone (reloaded) */
  }
  log(`v${version}: panel shown for`, state.pkg);
}

// Where to take the page's look from: npm's "Weekly Downloads" heading (it
// carries the sidebar's font and colours), else the main content area.
const HEADING_RE = /^\s*Weekly Downloads\s*$/i;
function themeSource(): Element {
  for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
    if (HEADING_RE.test(el.textContent ?? '') && el.getClientRects().length) return el;
  }
  return document.querySelector('main, [role="main"], #app, #root') ?? document.body;
}

// npm's sparkline (for the accent colour): the nearest ancestor of the
// heading that contains an SVG, at most a few levels up.
function sparklineHost(heading: Element): Element | null {
  let el: Element | null = heading;
  for (let i = 0; i < 4 && el?.parentElement; i++) {
    el = el.parentElement;
    if (el.querySelector('svg path, svg polyline')) return el;
  }
  return null;
}

function setCollapsed(st: PageState, collapsed: boolean): void {
  st.host.classList.toggle('ndc-collapsed', collapsed);
  $(st.panel, '.head').setAttribute('aria-expanded', String(!collapsed));
}

// npmjs.com is a SPA: react to every URL change, including leaving the
// package page (profile, search, settings…) — then the panel is removed.
function check(): void {
  const pkg = packageFromUrl();
  if (!pkg) {
    if (lastPkg || state) {
      lastPkg = null;
      teardown();
    }
    return;
  }
  if (pkg !== lastPkg) {
    lastPkg = pkg;
    start(pkg);
    return;
  }
  ensurePlaced();
}
// Coalesce bursts of DOM mutations into one check per frame.
let scheduled = false;
const scheduleCheck = () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    check();
  });
};
// Ignore mutations inside our own panel (chart redraws, tooltip on hover).
new MutationObserver((records) => {
  const host = state?.host;
  if (host && records.every((r) => host.contains(r.target))) return;
  scheduleCheck();
}).observe(document.body, { childList: true, subtree: true });
window.addEventListener('popstate', check);
check();
