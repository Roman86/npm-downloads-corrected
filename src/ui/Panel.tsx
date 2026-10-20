// The panel: header (collapse toggle, Packages menu), 7-day headline, range
// switcher, period navigation, period summary, chart, legend.
//
// No layout shift: the panel is anchored to the bottom, so any height change
// moves everything. Skeletons are the real markup with placeholder text (Ph:
// transparent text on a shimmer bar), so line heights match in any font; the
// summary always has the "vs previous 7 days" line; the period grid always
// has three cells.
import { batch, useSignal, useSignalEffect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import * as R from '../lib/recent.ts';
import { NPM_EPOCH, RANGES, rangeById, windowFor, yesterday, type Range } from '../lib/period.ts';
import type { Point, RecentState, Settings } from '../types.ts';
import { Chart, ChartSkeleton, Swatch } from './Chart.tsx';
import { compute, loadRecent, RECENT_KEY, saveCollapsed, saveRange, saveRecent, type View } from './data.ts';
import { PackagesMenu } from './PackagesMenu.tsx';
import { cx, errorText, fmt, human, pctStr, short, signed } from './util.ts';

interface Props {
  pkg: string;
  settings: Settings;
  host: HTMLElement;
  collapsed: boolean;
}

/** Placeholder text: keeps the line's metrics, drawn as a shimmer bar. */
export const Ph = ({ children }: { children: ComponentChildren }) => (
  <span class="ph" aria-hidden="true">
    {children}
  </span>
);

const sum = (arr: readonly Point[], k: 'raw' | 'corrected') => arr.reduce((s, d) => s + d[k], 0);

export function Panel({ pkg, settings, host, collapsed: initialCollapsed }: Props) {
  const collapsed = useSignal(initialCollapsed);
  const range = useSignal<Range>(rangeById(settings.range));
  const offset = useSignal(0);
  // Keyed by `${range}:${offset}`, so "is the current period loaded / failed"
  // is a comparison, not a flag that could lag behind a click.
  /** What's on screen: the last successfully loaded period (and its range). */
  const shown = useSignal<{ key: string; view: View; range: Range } | null>(null);
  const failed = useSignal<{ key: string; text: string } | null>(null);
  /** Daily points of the latest period (offset 0): the 7-day headline. */
  const headline = useSignal<Point[] | null>(null);
  const recent = useSignal<RecentState | null>(null);
  const menuOpen = useSignal(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const cache = useRef(new Map<string, Promise<View>>()).current;
  /** Resolved periods, so going back to one shows it at once (no dimming). */
  const done = useRef(new Map<string, { key: string; view: View; range: Range }>()).current;

  // Load the period whenever range/offset change; a stale response (the user
  // moved on) is dropped by the effect's cleanup.
  useSignalEffect(() => {
    const r = range.value, o = offset.value;
    const key = `${r.id}:${o}`;
    let alive = true;
    let job = cache.get(key);
    if (!job) cache.set(key, (job = compute(pkg, settings, r, o)));
    job.then(
      (view) => {
        if (!alive) return;
        const entry = { key, view, range: r };
        done.set(key, entry);
        batch(() => {
          shown.value = entry;
          if (o === 0) headline.value = view.daily;
          failed.value = null;
        });
      },
      (err) => {
        if (!alive) return;
        cache.delete(key);
        batch(() => {
          shown.value = null;
          failed.value = { key, text: errorText(err) };
        });
      }
    );
    return () => {
      alive = false;
    };
  });

  // Recent / starred packages: record this visit, follow changes from other tabs.
  useEffect(() => {
    let alive = true;
    loadRecent().then((stored) => {
      if (!alive) return;
      recent.value = R.visit(stored, pkg);
      saveRecent(recent.value);
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const change = changes[RECENT_KEY];
      if (area === 'local' && change?.newValue) recent.value = R.clean(change.newValue);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, [pkg]);

  const toggle = () => {
    collapsed.value = !collapsed.value;
    saveCollapsed(collapsed.value);
  };
  const go = (r: Range, o: number) =>
    batch(() => {
      range.value = r;
      offset.value = o;
      const hit = done.get(`${r.id}:${o}`);
      if (hit) shown.value = hit;
    });
  const pickRange = (r: Range) => {
    if (r.id === range.value.id) return;
    saveRange(r.id);
    go(r, 0); // a new range starts from "now"
  };
  // Left arrow (dir -1) goes back in time = larger offset.
  const step = (dir: 1 | -1) => go(range.value, Math.max(0, offset.value - dir));
  const star = (name: string) => {
    recent.value = R.toggleStar(recent.value, name).state;
    saveRecent(recent.value);
  };

  const c = collapsed.value;
  const r = range.value;
  const w = windowFor(r, offset.value);
  const key = `${r.id}:${offset.value}`;
  const s = shown.value;
  const error = failed.value?.key === key ? failed.value.text : null;
  const busy = s?.key !== key && !error;
  // Keep the previous chart and numbers, dimmed, until the new ones arrive.
  const dim = busy && !!s;
  const mini = headline.value ? `${fmt(sum(last7(headline.value), 'corrected'))} corrected · 7 days` : '';
  const backDisabled = busy || !s || s.view.empty || s.view.trimmed || w.start <= NPM_EPOCH;

  return (
    <>
      <div
        class={cx(
          'relative rounded-lg border border-border border-l-[3px] border-l-accent bg-bg text-left font-ui text-base text-fg shadow-panel',
          c
            ? 'overflow-hidden px-2.5 py-1.5'
            : 'max-h-[calc(100vh_-_32px)] w-[min(300px,calc(100vw_-_32px))] overflow-y-auto overscroll-contain px-3 py-2.5'
        )}
      >
        {/* Header: click to collapse / expand. */}
        <div
          class={cx(
            'group flex cursor-pointer items-center gap-2 rounded-sm select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            !c && 'mb-1'
          )}
          role="button"
          tabIndex={0}
          aria-expanded={!c}
          title="Collapse / expand"
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return; // e.g. Enter on the Packages button
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
        >
          {c && mini ? (
            <span class="min-w-0 flex-1 truncate text-md font-semibold text-fg-strong tabular-nums">{mini}</span>
          ) : (
            <div class="min-w-0 flex-1 truncate text-md font-semibold text-muted" title="npm downloads, corrected for outages">
              Corrected downloads
            </div>
          )}
          <button
            ref={menuBtn}
            type="button"
            class="inline-flex flex-none items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-xs font-semibold text-muted hover:border-muted hover:text-fg-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-expanded:border-muted aria-expanded:text-fg-strong"
            aria-haspopup="true"
            aria-expanded={menuOpen.value}
            title="Recent packages and more by this author"
            onClick={(e) => {
              e.stopPropagation();
              menuOpen.value = !menuOpen.value;
            }}
          >
            Packages
            {/* caret: points where the menu opens (down on the panel, up from the collapsed bar) */}
            <i class={cx('h-0 w-0 border-x-[3.5px] border-x-transparent', c ? 'border-b-4 border-b-current' : 'border-t-4 border-t-current')} aria-hidden="true" />
          </button>
          <span class="grid h-[18px] w-[18px] flex-none place-items-center rounded-sm text-muted group-hover:bg-subtle group-hover:text-fg-strong" aria-hidden="true">
            <i class={cx('block h-[7px] w-[7px] border-r-2 border-b-2 border-current', c ? 'translate-y-0.5 -rotate-135' : '-translate-y-0.5 rotate-45')} />
          </span>
        </div>

        {!c && (
          <>
            <div aria-busy={!headline.value && !error}>
              <Summary daily={headline.value} failed={!!error} />
            </div>

            <div class="mt-2.5 mb-1.5 flex gap-0.5 rounded-md bg-subtle p-0.5" role="tablist">
              {[...RANGES].reverse().map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={x.id === r.id}
                  title={x.title}
                  class="flex-1 rounded-sm py-[3px] text-xs font-semibold text-muted hover:text-fg-strong aria-selected:bg-raised aria-selected:text-accent aria-selected:shadow-tab"
                  onClick={() => pickRange(x)}
                >
                  {x.label}
                </button>
              ))}
            </div>

            <div class="mb-1.5 flex items-center gap-1.5">
              <Arrow dir={-1} label="Previous period" disabled={backDisabled} onClick={step} />
              <span class="flex-1 text-center text-sm text-fg tabular-nums">{`${human(w.start)} – ${human(w.end)}`}</span>
              <Arrow dir={1} label="Next period" disabled={offset.value === 0} onClick={step} />
            </div>

            <div class={cx('min-h-[18px] text-sm text-muted transition-opacity duration-150', dim && 'pointer-events-none opacity-40')}>
              {s ? <PeriodGrid view={s.view} range={s.range} /> : !error && <PeriodGrid />}
            </div>

            <div class={cx('relative mt-2 mb-1.5 min-h-[120px] transition-opacity duration-150', dim && 'pointer-events-none opacity-40')} aria-busy={busy}>
              {s ? (
                <Chart points={s.view.points} prev={s.view.prevPoints} granularity={s.range.gran} />
              ) : error ? (
                <div class="text-sm text-down">Error: {error}</div>
              ) : (
                <ChartSkeleton />
              )}
            </div>

            <div class="flex flex-wrap items-center gap-2.5 text-sm">
              <span>
                <Swatch kind="raw" /> npm
              </span>
              <span>
                <Swatch kind="corr" /> corrected
              </span>
              {(!s || s.view.prevPoints) && (
                <span>
                  <Swatch kind="prev" /> previous period
                </span>
              )}
              <span class="min-h-[1.45em] basis-full text-muted">
                {s ? outageCount(s.view, s.range) : !error && <Ph>Weeks with outages: 0/52</Ph>}
              </span>
            </div>
            <div class="mt-1 flow-root min-h-[1.4em] text-xs text-muted">
              {s ? `references: ${s.view.refs.join(', ')}` : !error && <Ph>references: semver, debug, ms, chalk</Ph>}
            </div>
          </>
        )}
      </div>

      <PackagesMenu
        pkg={pkg}
        open={menuOpen.value}
        onClose={() => (menuOpen.value = false)}
        host={host}
        button={menuBtn}
        collapsed={c}
        recent={recent.value}
        onStar={star}
      />
    </>
  );
}

function Arrow({ dir, label, disabled, onClick }: { dir: 1 | -1; label: string; disabled: boolean; onClick(dir: 1 | -1): void }) {
  return (
    <button
      type="button"
      class="h-[22px] w-[26px] rounded-sm border border-border bg-raised text-[16px] leading-none font-semibold text-fg enabled:hover:border-accent enabled:hover:text-accent disabled:opacity-35"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={() => onClick(dir)}
    >
      {dir < 0 ? '‹' : '›'}
    </button>
  );
}

const last7 = (daily: readonly Point[]) => daily.filter((d) => d.start <= yesterday()).slice(-7);

// Headline: the last 7 days, same window as npm's own "Weekly Downloads".
function Summary({ daily, failed }: { daily: Point[] | null; failed: boolean }) {
  if (!daily && failed) return <div class="text-sm text-muted">—</div>;
  const upToYesterday = daily?.filter((d) => d.start <= yesterday()) ?? null;
  const last = upToYesterday?.slice(-7) ?? [];
  const raw = sum(last, 'raw');
  const corr = sum(last, 'corrected');
  const fixed = last.filter((d) => d.fixedDays).length;
  // Same comparison as the chart's shadow line: vs the 7 days before.
  const prev7 = upToYesterday?.slice(-14, -7) ?? [];
  const prevCorr = prev7.length === 7 ? sum(prev7, 'corrected') : 0;
  const diff = corr - prevCorr;
  return (
    <>
      <div class="truncate text-xs text-muted">last 7 days</div>
      <div class="flex flex-wrap items-baseline gap-2">
        <span class="text-xl font-semibold text-fg-strong tabular-nums">{daily ? fmt(corr) : <Ph>000,000</Ph>}</span>
        {/* Correction size: neutral on purpose — green/red is reserved for change vs previous period. */}
        {fixed > 0 && (
          <span class="rounded-2xl bg-subtle px-[7px] py-px text-xs whitespace-nowrap text-fg" title="How much npm undercounted because of outages">
            adjusted {pctStr(corr, raw)}
          </span>
        )}
      </div>
      <div class="text-sm text-muted">{daily ? `npm: ${fmt(raw)}` : <Ph>npm: 000,000</Ph>}</div>
      {/* Always one line (a dash when there's nothing to compare with). */}
      <div class="text-sm text-muted">
        {!daily ? (
          <Ph>vs previous 7 days +0.0% (+0,000)</Ph>
        ) : prevCorr ? (
          <>
            vs previous 7 days <span class={diff >= 0 ? 'text-up' : 'text-down'}>{pctStr(corr, prevCorr)}</span> ({signed(diff)})
          </>
        ) : (
          'vs previous 7 days —'
        )}
      </div>
    </>
  );
}

// Fixed grid of stat cells (label / value / note) instead of a sentence, so
// nothing wraps mid-phrase. Always the same three cells and no extra lines,
// so the panel keeps its height for every package and period.
function PeriodGrid({ view, range }: { view?: View; range?: Range }) {
  if (!view || !range) {
    return (
      <div class="mt-0.5 flex gap-2">
        <Cell label={<Ph>Year</Ph>} value={<Ph>0,000,000</Ph>} note={<Ph>npm 0.0M</Ph>} />
        <Cell label={<Ph>adjustment</Ph>} value={<Ph>+0.0%</Ph>} note={<Ph>+000K</Ph>} />
        <Cell label={<Ph>change</Ph>} value={<Ph>+0.0%</Ph>} note={<Ph>prev. 0.0M</Ph>} />
      </div>
    );
  }
  const raw = sum(view.period, 'raw');
  const corr = sum(view.period, 'corrected');
  const firstDay = view.period[0];
  const young = view.trimmed && firstDay;
  const p = view.prev ? sum(view.prev, 'corrected') : 0;
  const change = pctStr(corr, p);
  return (
    <div class="mt-0.5 flex gap-2">
      <Cell
        label={young ? `since ${human(firstDay.start)}` : range.title}
        value={fmt(corr)}
        note={`npm ${short(raw)}`}
        tone="text-fg-strong"
        title={
          young
            ? `Data since ${human(firstDay.start)}: the package is younger than the period. Corrected total; below it — as reported by npm`
            : 'Corrected total; below it — as reported by npm'
        }
      />
      <Cell
        label="adjustment"
        value={corr !== raw ? pctStr(corr, raw) : '0%'}
        note={corr !== raw ? `+${short(corr - raw)}` : view.empty ? 'no downloads' : 'no outages'}
        title="How much npm undercounted because of outages"
      />
      {change ? (
        <Cell label="change" value={change} note={`prev. ${short(p)}`} tone={corr >= p ? 'text-up' : 'text-down'} title="Change vs the previous period" />
      ) : (
        <Cell
          label="change"
          value="—"
          note={range.compare ? 'new package' : 'not shown'}
          title={range.compare ? 'No data for the previous period yet' : 'Not compared for periods over a year'}
        />
      )}
    </div>
  );
}

function Cell({ label, value, note, tone = 'text-fg', title }: {
  label: ComponentChildren;
  value: ComponentChildren;
  note: ComponentChildren;
  tone?: string;
  title?: string;
}) {
  return (
    <div class="min-w-0 flex-1 first:grow-[1.6] not-first:border-l not-first:border-border not-first:pl-2" title={title}>
      <div class="truncate text-xs text-muted">{label}</div>
      <div class={cx('text-base leading-[1.35] font-semibold whitespace-nowrap tabular-nums', tone)}>{value}</div>
      <div class="truncate text-xs text-muted">{note}</div>
    </div>
  );
}

function outageCount(view: View, range: Range): string {
  if (!view.points.length) return '';
  const unit = range.gran === 'week' ? 'Weeks' : 'Days';
  const bad = view.points.filter((p) => p.fixedDays).length;
  return `${unit} with outages: ${bad}/${view.points.length}`;
}
