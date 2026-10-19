/*
 * Panel styles. They live inside the panel's shadow root, so npm's CSS can't
 * leak in and ours can't leak out. All colours are CSS variables that
 * content.js fills from the page's theme (see applyTheme there); the values
 * below are light-theme defaults.
 */
export const STYLES = `
/* Floating panel, bottom-right. Host layout is !important because page rules
   aimed at the host element would otherwise beat :host rules. Low z-index:
   above page content, below npm's own menus. */
:host {
  all: initial !important;
  display: block !important;
  position: fixed !important; right: 16px !important; bottom: 16px !important; z-index: 1 !important;
  width: min(300px, calc(100vw - 32px)) !important;
  margin: 0 !important; padding: 0 !important;
  --bg: #fff; --fg: #333; --fg-strong: #111; --muted: #8a8a8a; --faint: #efefef;
  --border: #e5e5e5; --subtle: #f2f2f2; --raised: #fff; --accent: #8956ff;
  --raw: #b9b9b9; --prev: #7a8aa0; --up: #2e8b57; --down: #cb3837;
  --tip-bg: rgba(32, 32, 32, .94); --tip-fg: #fff; --tip-muted: #c8c8c8; --tip-border: transparent;
  --skel-a: #ececec; --skel-b: #f6f6f6; --shadow: 0 6px 24px rgba(0, 0, 0, .14);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
:host(.ndc-collapsed) { width: auto !important; max-width: min(300px, calc(100vw - 32px)) !important; }
*, *::before, *::after { box-sizing: border-box; }
button { font-family: inherit; }

.root {
  position: relative; width: 100%; padding: 10px 12px;
  max-height: calc(100vh - 32px); overflow-y: auto; overscroll-behavior: contain;
  border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 6px;
  box-shadow: var(--shadow);
  font: 14px/1.4 var(--font); color: var(--fg); background: var(--bg); text-align: left;
}

.head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; cursor: pointer; user-select: none; border-radius: 4px; }
.head:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.title { flex: 1; min-width: 0; font-weight: 600; color: var(--muted); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mini { display: none; font-weight: 600; font-size: 13px; color: var(--fg-strong); font-variant-numeric: tabular-nums; }
.toggle { flex: none; width: 18px; height: 18px; border-radius: 4px; color: var(--muted); display: grid; place-items: center; }
.toggle::before { content: ""; width: 7px; height: 7px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: translateY(-2px) rotate(45deg); }
.head:hover .toggle { background: var(--subtle); color: var(--fg-strong); }

/* Collapsed: one line with the 7-day number. */
:host(.ndc-collapsed) .root { padding: 6px 10px; overflow: hidden; }
:host(.ndc-collapsed) .root > :not(.head) { display: none; }
:host(.ndc-collapsed) .head { margin: 0; }
:host(.ndc-collapsed) .mini:not(:empty) { display: block; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
:host(.ndc-collapsed) .head:has(.mini:not(:empty)) .title { display: none; }
:host(.ndc-collapsed) .toggle::before { transform: translateY(2px) rotate(-135deg); }

.row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.big { font-size: 20px; font-weight: 600; color: var(--fg-strong); font-variant-numeric: tabular-nums; }
/* Correction size: neutral on purpose — green/red is reserved for change vs previous period. */
.badge { font-size: 11px; color: var(--fg); background: var(--subtle); border-radius: 10px; padding: 1px 7px; white-space: nowrap; }
.muted { color: var(--muted); font-size: 12px; }
.small { font-size: 11px; margin-top: 4px; }
.err { color: var(--down); font-size: 12px; }

.ranges { display: flex; gap: 2px; margin: 10px 0 6px; padding: 2px; background: var(--subtle); border-radius: 5px; }
.ranges button { flex: 1; padding: 3px 0; border: 0; border-radius: 4px; background: transparent; font-size: 11px; font-weight: 600; line-height: 1.4; color: var(--muted); cursor: pointer; }
.ranges button:hover { color: var(--fg-strong); }
.ranges button[aria-selected="true"] { background: var(--raised); color: var(--accent); box-shadow: 0 1px 2px rgba(0, 0, 0, .12); }
.nav { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; }
.dates { flex: 1; text-align: center; font-size: 12px; color: var(--fg); font-variant-numeric: tabular-nums; }
.arrow { width: 26px; height: 22px; padding: 0; border: 1px solid var(--border); border-radius: 4px; background: var(--raised); color: var(--fg); font-size: 16px; font-weight: 600; line-height: 1; cursor: pointer; }
.arrow:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.arrow:disabled { opacity: .35; cursor: default; }

.up { color: var(--up); }
.down { color: var(--down); }
.period { min-height: 18px; transition: opacity .15s; }
.stats { display: flex; gap: 8px; margin-top: 2px; }
.stat { flex: 1 1 0; min-width: 0; }
.stat:first-child { flex-grow: 1.6; }
.stat + .stat { border-left: 1px solid var(--border); padding-left: 8px; }
.stat-label, .stat-note { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stat-value { font-size: 14px; font-weight: 600; color: var(--fg); font-variant-numeric: tabular-nums; white-space: nowrap; line-height: 1.35; }
.stat-value.strong { color: var(--fg-strong); }
.stat-value.up { color: var(--up); }
.stat-value.down { color: var(--down); }

.chart-box { position: relative; min-height: 120px; margin: 8px 0 6px; transition: opacity .15s; }
.loading { opacity: .4; pointer-events: none; }
.chart-wrap { position: relative; }
.chart { display: block; overflow: visible; touch-action: none; }
.raw { fill: none; stroke: var(--raw); stroke-width: 1.2; stroke-linejoin: round; }
.corr { fill: none; stroke: var(--accent); stroke-width: 1.8; stroke-linejoin: round; }
.mark { fill: var(--accent); }
.grid { stroke: var(--faint); stroke-width: 1; }
.axis { stroke: var(--border); stroke-width: 1; }
.tick { font: 10px var(--font); fill: var(--muted); font-variant-numeric: tabular-nums; }
.guide { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 2; }
.dot-raw { fill: var(--bg); stroke: var(--raw); stroke-width: 1.5; }
.dot-corr { fill: var(--accent); stroke: var(--bg); stroke-width: 1.5; }
.prev { fill: none; stroke: var(--prev); stroke-width: 1.2; stroke-dasharray: 3 2; opacity: .8; }
.prev-area { fill: var(--prev); opacity: .1; }
.dot-prev { fill: var(--prev); stroke: var(--bg); stroke-width: 1; }

.tip {
  position: absolute; left: 0; top: 0; z-index: 10; pointer-events: none;
  /* Fixed width: the tooltip must not resize (and shift) from point to point. */
  width: 236px; max-width: 100%; box-sizing: border-box;
  padding: 6px 8px; border-radius: 4px; border: 1px solid var(--tip-border);
  background: var(--tip-bg); color: var(--tip-fg); font-size: 12px; line-height: 1.45;
  box-shadow: 0 2px 8px rgba(0, 0, 0, .25);
}
.tip[hidden] { display: none; }
.tip::after { content: ""; position: absolute; top: 100%; left: var(--ndc-arrow, 50%); margin-left: -5px; border: 5px solid transparent; border-top-color: var(--tip-bg); }
.tip-date { color: var(--tip-muted); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* swatch | label | change vs previous point | value — same columns in every row */
.tip-row {
  display: grid; grid-template-columns: 12px minmax(0, 1fr) 7ch var(--tip-val, 9ch); column-gap: 6px;
  align-items: center; white-space: nowrap; font-variant-numeric: tabular-nums;
}
.tip-row .sw { margin: 0; }
.tip-l { overflow: hidden; text-overflow: ellipsis; }
.tip-wide .tip-l { grid-column: 2 / 4; }
.tip-d { text-align: right; font-size: 11px; }
.tip-na { color: var(--tip-muted); opacity: .6; }
.tip-row b { text-align: right; }
/* Reserve two lines so rows below don't move when the note changes. */
.tip-note { color: var(--tip-muted); margin-top: 2px; font-size: 11px; line-height: 1.4; min-height: 2.8em; }
.tip-ok { color: #8fd6a4; }
.tip-sep { height: 1px; background: currentColor; opacity: .15; margin: 4px 0 3px; }
.tip-prev { color: var(--tip-muted); }
.sw-none { visibility: hidden; }
.tip .up { color: #8fd6a4; }
.tip .down { color: #ff9c9b; }

.legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; align-items: center; }
.legend-prev[hidden] { display: none; }
.legend .fixed-count { flex-basis: 100%; min-height: 1.45em; }
.sw { display: inline-block; width: 12px; height: 2px; margin-right: 4px; vertical-align: middle; }
.sw-raw { background: var(--raw); }
.sw-corr { background: var(--accent); }
.sw-prev { background: repeating-linear-gradient(90deg, var(--prev) 0 3px, transparent 3px 5px); }
.refs { min-height: 1.4em; display: flow-root; }

/* Skeletons */
.skel {
  display: block; border-radius: 3px;
  background: linear-gradient(90deg, var(--skel-a) 25%, var(--skel-b) 45%, var(--skel-a) 65%);
  background-size: 300% 100%; animation: shimmer 1.3s ease-in-out infinite;
}
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) { .skel { animation: none; } }
/* Placeholder text: keeps the real line metrics, shows a shimmer bar instead of glyphs. */
.ph {
  color: transparent !important; border-radius: 3px; -webkit-box-decoration-break: clone; box-decoration-break: clone;
  background: linear-gradient(90deg, var(--skel-a) 25%, var(--skel-b) 45%, var(--skel-a) 65%);
  background-size: 300% 100%; animation: shimmer 1.3s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) { .ph { animation: none; } }
.chart-skel { position: relative; height: 120px; }
.chart-skel-plot { position: absolute; left: 34px; right: 6px; top: 8px; bottom: 18px; border-radius: 4px; opacity: .7; }
.chart-skel-y { position: absolute; left: 4px; top: 4px; bottom: 14px; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; width: 24px; }
.chart-skel-x { position: absolute; left: 34px; right: 6px; bottom: 2px; display: flex; justify-content: space-between; }

/* Recent packages */
.recent-btn {
  flex: none; display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px;
  border: 1px solid var(--border); border-radius: 4px; background: transparent;
  color: var(--muted); font-size: 11px; font-weight: 600; line-height: 1.4; cursor: pointer;
}
.recent-btn:hover, .recent-btn[aria-expanded="true"] { color: var(--fg-strong); border-color: var(--muted); }
.recent-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.caret { width: 0; height: 0; border-left: 3.5px solid transparent; border-right: 3.5px solid transparent; border-bottom: 4px solid currentColor; }
:host(:not(.ndc-collapsed)) .caret { border-bottom: 0; border-top: 4px solid currentColor; } /* opens downward */
.recent-pop {
  position: absolute; right: 0; bottom: calc(100% + 6px); width: 100%; min-width: 240px; z-index: 2;
  padding: 6px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg);
  box-shadow: var(--shadow); font: 13px/1.4 var(--font); color: var(--fg);
}
.recent-pop[hidden] { display: none; }
/* Expanded panel: drop down over the panel content (always on screen).
   Collapsed bar at the bottom of the screen: open upward. */
:host(:not(.ndc-collapsed)) .recent-pop { top: 36px; bottom: auto; left: 8px; right: 8px; width: auto; min-width: 0; }
.rp-tabs { display: flex; gap: 2px; padding: 2px; margin-bottom: 4px; background: var(--subtle); border-radius: 5px; }
.rp-tabs button { flex: 1; min-width: 0; padding: 3px 6px; border: 0; border-radius: 4px; background: transparent; color: var(--muted);
  font-size: 11px; font-weight: 600; line-height: 1.4; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-tabs button:hover { color: var(--fg-strong); }
.rp-tabs button[aria-selected="true"] { background: var(--raised); color: var(--accent); box-shadow: 0 1px 2px rgba(0, 0, 0, .12); }
.rp-list { max-height: 300px; overflow-y: auto; overscroll-behavior: contain; }
.rp-dl { flex: none; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; margin-right: 4px; }
.rp-who { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px 4px 6px; }
.rp-chip { padding: 1px 8px; border: 1px solid var(--border); border-radius: 10px; background: transparent; color: var(--muted); font-size: 11px; cursor: pointer; }
.rp-chip.on { color: var(--accent); border-color: var(--accent); }
.rp-empty.err { color: var(--down); }
.rp-hint a { color: inherit; }
.rp-hint a:hover { color: var(--accent); }
.recent-pop ul { list-style: none; margin: 0; padding: 0; }
.rp-item { display: flex; align-items: center; gap: 4px; padding: 2px; border-radius: 4px; }
.rp-item:hover { background: var(--subtle); }
.rp-skel { pointer-events: none; }
.rp-star { flex: none; width: 24px; height: 24px; border: 0; border-radius: 4px; background: transparent; color: var(--muted); font-size: 15px; line-height: 1; cursor: pointer; }
.rp-star:hover { color: var(--fg-strong); }
.rp-star.on { color: #e3a008; }
.rp-name { flex: 1; min-width: 0; color: var(--fg); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 3px 2px; }
.rp-name:hover { color: var(--accent); text-decoration: underline; }
.rp-item.current .rp-name { font-weight: 600; color: var(--fg-strong); }
.rp-here { flex: none; font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 8px; padding: 0 6px; margin-right: 4px; }
.rp-empty { padding: 6px; color: var(--muted); }
.rp-hint { font-size: 11px; color: var(--muted); padding: 6px 6px 2px; border-top: 1px solid var(--border); margin-top: 4px; }

@media print { :host { display: none !important; } }
`;
