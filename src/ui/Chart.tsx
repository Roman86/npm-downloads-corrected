// Line chart with labelled axes and a floating hover tooltip. Geometry and
// texts come from lib/chart.ts; this file is only the SVG and the tooltip.
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  compact,
  dateLabel,
  full,
  H,
  indexAt,
  labelWidth,
  layout,
  M,
  noteLines,
  pctChange,
  shortPct,
  type Granularity,
} from '../lib/chart.ts';
import type { Point } from '../types.ts';
import { cx } from './util.ts';

interface Props {
  points: readonly Point[];
  /** Previous period, aligned to `points` from the end. */
  prev: readonly Point[] | null;
  granularity: Granularity;
}

export function Chart({ points, prev, granularity }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(-1);

  // Re-layout when the panel width changes (ignoring sub-pixel jitter).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = el.clientWidth;
    setWidth(last);
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - last) > 4) setWidth((last = el.clientWidth));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const l = useMemo(() => layout(points, prev, granularity, width), [points, prev, granularity, width]);
  const p = points[hover];
  const pp = l.prev?.[hover] ?? null;
  const before = points[hover - 1];

  // Float the tooltip above the plot, centred on the guide line and clamped
  // to the chart edges, so it never hides the lines being inspected.
  useLayoutEffect(() => {
    const t = tip.current;
    if (!t || !p) return;
    const xx = l.x(hover);
    const tw = t.offsetWidth, th = t.offsetHeight;
    const left = Math.max(0, Math.min(l.W - tw, xx - tw / 2));
    t.style.transform = `translate(${left}px, ${M.top - th - 6}px)`;
    t.style.setProperty('--arrow-x', `${Math.max(8, Math.min(tw - 8, xx - left))}px`);
  }, [hover, l, p]);

  if (!points.length) {
    return (
      <div ref={box} class="relative">
        <div class="text-sm text-muted">No data for this period</div>
      </div>
    );
  }

  const onMove = (e: PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    setHover(indexAt(l, points.length, ((e.clientX - r.left) * l.W) / r.width));
  };
  const xx = l.x(hover);

  return (
    <div ref={box} class="relative">
      <svg ref={svg} width={l.W} height={H} viewBox={`0 0 ${l.W} ${H}`} class="touch-none">
        {l.yTicks.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={l.W - M.right} y1={l.y(v)} y2={l.y(v)} class={v ? 'stroke-faint' : 'stroke-border'} stroke-width="1" />
            <text x={M.left - 5} y={l.y(v)} text-anchor="end" dominant-baseline="middle" class="font-ui text-2xs fill-muted tabular-nums">
              {compact(v)}
            </text>
          </g>
        ))}
        {l.xTicks.map((t) => {
          const tx = l.x(t.i);
          const half = labelWidth(t.label) / 2;
          return (
            <g key={t.i}>
              <line x1={tx} x2={tx} y1={M.top + l.ph} y2={M.top + l.ph + 3} class="stroke-border" stroke-width="1" />
              {/* keep edge labels inside the chart */}
              <text x={Math.max(half, Math.min(l.W - half, tx))} y={H - 4} text-anchor="middle" class="font-ui text-2xs fill-muted tabular-nums">
                {t.label}
              </text>
            </g>
          );
        })}
        {/* Shadow of the previous period: soft area + dashed line, behind everything. */}
        {l.prevPath && (
          <>
            <path d={l.prevPath.area} class="fill-prev opacity-10" />
            <path d={l.prevPath.line} fill="none" class="stroke-prev opacity-80" stroke-width="1.2" stroke-dasharray="3 2" />
          </>
        )}
        <path d={l.rawPath} fill="none" class="stroke-raw" stroke-width="1.2" stroke-linejoin="round" />
        <path d={l.corrPath} fill="none" class="stroke-accent" stroke-width="1.8" stroke-linejoin="round" />
        {points.map((pt, i) => pt.fixedDays ? <circle key={i} cx={l.x(i)} cy={l.y(pt.corrected)} r={l.markR} class="fill-accent" /> : null)}
        {p && (
          <>
            <line x1={xx} x2={xx} y1={M.top} y2={M.top + l.ph} class="stroke-muted" stroke-width="1" stroke-dasharray="2 2" />
            {pp && <circle cx={xx} cy={l.y(pp.corrected)} r="2.5" class="fill-prev stroke-bg" stroke-width="1" />}
            <circle cx={xx} cy={l.y(p.raw)} r="3" class="fill-bg stroke-raw" stroke-width="1.5" />
            <circle cx={xx} cy={l.y(p.corrected)} r="3.5" class="fill-accent stroke-bg" stroke-width="1.5" />
          </>
        )}
        <rect
          x={M.left}
          y={0}
          width={l.pw}
          height={H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(-1)}
        />
      </svg>
      {p && (
        <div
          ref={tip}
          class="tip pointer-events-none absolute top-0 left-0 z-10 w-[236px] max-w-full rounded-sm border border-tip-border bg-tip-bg px-2 py-1.5 text-sm leading-[1.45] text-tip-fg shadow-tip"
          // Value column wide enough for the largest number, so it never jumps.
          style={`--tip-val: ${full(l.max).length + 1}ch`}
        >
          <div class="mb-0.5 truncate text-tip-muted">{dateLabel(p, granularity)}</div>
          <Row sw="corr" label="corrected" delta={<Delta now={p.corrected} was={before?.corrected} />} value={full(p.corrected)} />
          <Row sw="raw" label="npm" delta={<Delta now={p.raw} was={before?.raw} />} value={full(p.raw)} />
          <Note lines={noteLines(p, granularity)} />
          {l.prev && <PrevRows p={p} pp={pp} granularity={granularity} />}
        </div>
      )}
    </div>
  );
}

// Tooltip row: swatch | label | change vs previous point | value — the same
// columns in every row (widths set once per chart), so numbers don't jump.
function Row({ sw, label, delta, value, wide, muted }: {
  sw: 'corr' | 'raw' | 'prev' | 'none';
  label: string;
  delta?: ComponentChildren;
  value: ComponentChildren;
  wide?: boolean;
  muted?: boolean;
}) {
  return (
    <div class={cx('grid grid-cols-[12px_minmax(0,1fr)_7ch_var(--tip-val,9ch)] items-center gap-x-1.5 whitespace-nowrap tabular-nums', muted && 'text-tip-muted')}>
      <Swatch kind={sw} />
      {/* No delta on wide rows: the date spans the delta column (long weekly ranges fit). */}
      <span class={cx('truncate', wide && 'col-span-2')}>{label}</span>
      {!wide && (delta ?? <NoDelta />)}
      <b class="text-right">{value}</b>
    </div>
  );
}

const NoDelta = () => <span class="text-right text-xs text-tip-muted opacity-60">—</span>;

function Delta({ now, was }: { now: number; was: number | undefined }) {
  const d = was === undefined ? null : pctChange(now, was);
  if (d === null) return <NoDelta />;
  return (
    <span class={cx('text-right text-xs', d >= 0 ? 'text-tip-up' : 'text-tip-down')} title="vs previous point">
      {shortPct(d)}
    </span>
  );
}

// Two lines reserved, so rows below don't move when the note changes.
function Note({ lines }: { lines: string[] }) {
  return (
    <div class={cx('mt-0.5 min-h-[2.8em] text-xs leading-[1.4]', lines.length ? 'text-tip-muted' : 'text-tip-up')}>
      {lines.length ? lines.map((s, i) => (i ? [<br />, s] : s)) : 'no outages'}
    </div>
  );
}

// Always the same rows when the chart has a previous period ("—" where it
// doesn't reach), so the tooltip keeps its height.
function PrevRows({ p, pp, granularity }: { p: Point; pp: Point | null; granularity: Granularity }) {
  const ch = pp ? pctChange(p.corrected, pp.corrected) : null;
  const d = pp ? p.corrected - pp.corrected : 0;
  const cls = d >= 0 ? 'text-tip-up' : 'text-tip-down';
  return (
    <>
      <div class="mt-1 mb-[3px] h-px bg-current opacity-15" />
      <Row sw="prev" wide muted label={pp ? dateLabel(pp, granularity) : 'previous period'} value={pp ? full(pp.corrected) : '—'} />
      <Row
        sw="none"
        muted
        label="change"
        delta={ch === null ? <NoDelta /> : <span class={cx('text-right text-xs', cls)}>{shortPct(ch)}</span>}
        value={pp ? <span class={cls}>{`${d >= 0 ? '+' : '−'}${full(Math.abs(d))}`}</span> : '—'}
      />
    </>
  );
}

/** Legend / tooltip swatch: a short line in the series' colour. */
export function Swatch({ kind }: { kind: 'corr' | 'raw' | 'prev' | 'none' }) {
  return (
    <i
      class={cx(
        'inline-block h-0.5 w-3 align-middle',
        kind === 'corr' && 'bg-accent',
        kind === 'raw' && 'bg-raw',
        kind === 'prev' && 'sw-prev',
        kind === 'none' && 'invisible'
      )}
    />
  );
}

/** Chart-shaped skeleton: axis labels and the plot area as shimmer bars. */
export function ChartSkeleton() {
  const bar = (w: string) => <span class={cx('skel h-2', w)} />;
  return (
    <div class="relative h-[120px]" aria-hidden="true">
      <div class="absolute top-1 bottom-3.5 left-1 flex w-6 flex-col items-end justify-between">
        {bar('w-[22px]')}
        {bar('w-[22px]')}
        {bar('w-2.5')}
      </div>
      <div class="skel absolute top-2 right-1.5 bottom-[18px] left-[34px] rounded-sm opacity-70" />
      <div class="absolute right-1.5 bottom-0.5 left-[34px] flex justify-between">
        {[1, 2, 3, 4, 5].map((k) => <span key={k} class="skel h-2 w-5" />)}
      </div>
    </div>
  );
}
