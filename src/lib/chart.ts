/*
 * Line chart with labelled axes and a floating hover tooltip.
 *
 * mount(container, points, { granularity: 'day' | 'week', prev })
 * points: start === end for days.
 */
import type { Point } from '../types.ts';

export type Granularity = 'day' | 'week';

export interface ChartOptions {
  granularity?: Granularity;
  /** Previous period, aligned to `points` from the end. */
  prev?: readonly Point[] | null;
}

export interface ChartHandle {
  show(i: number): void;
  hide(): void;
}

interface Tick {
  i: number;
  label: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const H = 120;
const M = { top: 8, right: 6, bottom: 18, left: 34 };
const CHAR_W = 5.6; // approx width of a 10px tick character

export function compact(n: number): string {
  const a = Math.abs(n);
  const f = (v: number, s: string) => (v >= 100 || Number.isInteger(v) ? Math.round(v) : +v.toFixed(1)) + s;
  if (a >= 1e9) return f(n / 1e9, 'B');
  if (a >= 1e6) return f(n / 1e6, 'M');
  if (a >= 1e3) return f(n / 1e3, 'K');
  return String(Math.round(n));
}

const full = (n: number) => Math.round(n).toLocaleString('en-US');
const signedPct = (p: number) => `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`;
/** Relative change in %, or null when there's no base to compare with. */
const pctChange = (now: number, was: number) => (was ? ((now - was) / was) * 100 : null);
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
function dateLabel(pt: Point, granularity: Granularity): string {
  if (granularity === 'day') {
    const p = parseDay(pt.end);
    return `${WEEKDAYS[p.wd]}, ${md(pt.end)}, ${p.y}`;
  }
  const a = parseDay(pt.start), b = parseDay(pt.end);
  const left = a.y === b.y ? md(pt.start) : `${md(pt.start)}, ${a.y}`;
  return `${left} – ${md(pt.end)}, ${b.y}`;
}

const labelWidth = (s: string) => s.length * CHAR_W + 2;

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

function el(name: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
  const n = document.createElementNS(SVG_NS, name) as SVGElement;
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(n);
  return n;
}

export function mount(container: HTMLElement, points: readonly Point[], opts: ChartOptions = {}): ChartHandle {
  const granularity = opts.granularity ?? 'week';
  container.innerHTML = '';
  container.classList.add('chart-wrap');
  if (!points.length) {
    container.innerHTML = '<div class="muted">No data for this period</div>';
    return { show() {}, hide() {} };
  }
  const W = Math.max(200, Math.round(container.clientWidth || 280));
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;

  // Previous period, aligned to the current one from the end.
  const prevSrc = opts.prev ?? null;
  const prev: (Point | null)[] | null = prevSrc
    ? points.map((_, i) => prevSrc[i - (points.length - prevSrc.length)] ?? null)
    : null;

  const max = Math.max(
    1,
    ...points.map((p) => Math.max(p.raw, p.corrected)),
    ...(prev ? prev.map((p) => (p ? p.corrected : 0)) : [])
  );
  const yt = niceTicks(max, 3);
  const top = yt[yt.length - 1]!;
  const x = (i: number) => M.left + (points.length > 1 ? (i * pw) / (points.length - 1) : pw / 2);
  const y = (v: number) => M.top + ph - (v / top) * ph;

  const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'chart' }, container);

  for (const v of yt) {
    el('line', { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v), class: v ? 'grid' : 'axis' }, svg);
    const t = el('text', { x: M.left - 5, y: y(v), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, svg);
    t.textContent = compact(v);
  }

  for (const t of xTicks(points, granularity, x)) {
    const xx = x(t.i);
    el('line', { x1: xx, x2: xx, y1: M.top + ph, y2: M.top + ph + 3, class: 'axis' }, svg);
    const half = labelWidth(t.label) / 2;
    const tx = Math.max(half, Math.min(W - half, xx)); // keep edge labels inside
    const lab = el('text', { x: tx, y: H - 4, class: 'tick', 'text-anchor': 'middle' }, svg);
    lab.textContent = t.label;
  }

  // Shadow of the previous period: soft area + dashed line, behind everything.
  if (prev) {
    let d = '', first = -1, last = -1;
    prev.forEach((p, i) => {
      if (!p) return;
      d += `${first < 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.corrected).toFixed(1)}`;
      if (first < 0) first = i;
      last = i;
    });
    if (first >= 0) {
      const base = y(0).toFixed(1);
      el('path', { d: `${d}L${x(last).toFixed(1)},${base}L${x(first).toFixed(1)},${base}Z`, class: 'prev-area' }, svg);
      el('path', { d, class: 'prev' }, svg);
    }
  }

  const path = (key: 'raw' | 'corrected') =>
    points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  el('path', { d: path('raw'), class: 'raw' }, svg);
  el('path', { d: path('corrected'), class: 'corr' }, svg);
  const markR = points.length > 150 ? 1.3 : 1.8;
  points.forEach((p, i) => {
    if (p.fixedDays) el('circle', { cx: x(i), cy: y(p.corrected), r: markR, class: 'mark' }, svg);
  });

  const guide = el('line', { y1: M.top, y2: M.top + ph, class: 'guide', visibility: 'hidden' }, svg);
  const dotPrev = el('circle', { r: 2.5, class: 'dot-prev', visibility: 'hidden' }, svg);
  const dotRaw = el('circle', { r: 3, class: 'dot-raw', visibility: 'hidden' }, svg);
  const dotCorr = el('circle', { r: 3.5, class: 'dot-corr', visibility: 'hidden' }, svg);
  const hit = el('rect', { x: M.left, y: 0, width: pw, height: H, fill: 'transparent' }, svg);
  const set = (n: Element, attrs: Record<string, string | number>) => {
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  };

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  tip.style.setProperty('--tip-val', `${full(max).length + 1}ch`);
  container.appendChild(tip);

  let current = -1;
  function show(i: number): void {
    if (i === current) return;
    const p = points[i];
    if (!p) return;
    current = i;
    const xx = x(i);
    for (const n of [guide, dotRaw, dotCorr]) n.setAttribute('visibility', 'visible');
    set(guide, { x1: xx, x2: xx });
    set(dotRaw, { cx: xx, cy: y(p.raw) });
    set(dotCorr, { cx: xx, cy: y(p.corrected) });
    const pp = prev?.[i] ?? null;
    if (pp) set(dotPrev, { visibility: 'visible', cx: xx, cy: y(pp.corrected) });
    else dotPrev.setAttribute('visibility', 'hidden');

    // Fixed grid (swatch | label | Δ vs previous point | value) with column
    // widths set once per chart, so numbers don't jump between points.
    const before = points[i - 1];
    const deltaCell = (now: number, was: number | undefined) => {
      const d = was === undefined ? null : pctChange(now, was);
      return d === null
        ? '<span class="tip-d tip-na">—</span>'
        : `<span class="tip-d ${d >= 0 ? 'up' : 'down'}" title="vs previous point">${shortPct(d)}</span>`;
    };
    const row = (cls: string, sw: string, label: string, delta: string, value: string) =>
      `<div class="tip-row ${cls}"><i class="sw ${sw}"></i><span class="tip-l">${label}</span>${delta}<b>${value}</b></div>`;

    let prevRows = '';
    if (prev) {
      // Always the same rows when the chart has a previous period ("—" where
      // it doesn't reach), so the tooltip keeps its height.
      const ch = pp ? pctChange(p.corrected, pp.corrected) : null;
      const d = pp ? p.corrected - pp.corrected : 0;
      const cls = d >= 0 ? 'up' : 'down';
      prevRows =
        `<div class="tip-sep"></div>` +
        // No delta here: the date spans the delta column (long weekly ranges fit).
        row('tip-prev tip-wide', 'sw-prev', pp ? dateLabel(pp, granularity) : 'previous period', '', pp ? full(pp.corrected) : '—') +
        row(
          'tip-prev',
          'sw-none',
          'change',
          ch === null ? '<span class="tip-d tip-na">—</span>' : `<span class="tip-d ${cls}">${shortPct(ch)}</span>`,
          pp ? `<span class="${cls}">${d >= 0 ? '+' : '−'}${full(Math.abs(d))}</span>` : '—'
        );
    }

    const diff = p.corrected - p.raw;
    const pct = p.raw ? (diff / p.raw) * 100 : 0;
    const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
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
      lines.push(
        granularity === 'day' ? 'holiday season' : `${days(p.holidayDays)} holiday season`,
        'real dip, not corrected'
      );
    }
    const note = lines.length
      ? `<div class="tip-note">${lines.join('<br>')}</div>`
      : `<div class="tip-note tip-ok">no outages</div>`;

    tip.innerHTML =
      `<div class="tip-date">${dateLabel(p, granularity)}</div>` +
      row('', 'sw-corr', 'corrected', deltaCell(p.corrected, before?.corrected), full(p.corrected)) +
      row('', 'sw-raw', 'npm', deltaCell(p.raw, before?.raw), full(p.raw)) +
      note +
      prevRows;
    tip.hidden = false;

    // Float above the plot, centred on the guide line and clamped to the
    // chart edges, so it never hides the lines being inspected.
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = Math.max(0, Math.min(W - tw, xx - tw / 2));
    tip.style.transform = `translate(${left}px, ${M.top - th - 6}px)`;
    tip.style.setProperty('--ndc-arrow', `${Math.max(8, Math.min(tw - 8, xx - left))}px`);
  }
  function hide(): void {
    current = -1;
    tip.hidden = true;
    for (const n of [guide, dotRaw, dotCorr, dotPrev]) n.setAttribute('visibility', 'hidden');
  }
  function onMove(e: PointerEvent): void {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / r.width;
    const i = Math.round(((px - M.left) / pw) * (points.length - 1));
    show(Math.max(0, Math.min(points.length - 1, i)));
  }
  hit.addEventListener('pointermove', onMove as EventListener);
  hit.addEventListener('pointerdown', onMove as EventListener);
  hit.addEventListener('pointerleave', hide);

  return { show, hide };
}
