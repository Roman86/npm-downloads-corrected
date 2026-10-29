# npm Downloads Corrected

A Chrome / Edge / Brave extension (Manifest V3) that corrects outage dips in npm download stats.

npm's download counter regularly loses data: on some days it reports a fraction of the real downloads, on others **0 for every package**. The weekly chart on npmjs.com then shows sharp drops that have nothing to do with real usage — it reads more like a health status of npm's stats pipeline than install counts. This extension detects those days by looking at huge reference packages and shows corrected numbers next to npm's own.

## What you get

On every `npmjs.com/package/*` page, a floating panel in the bottom-right corner:

- **Last 7 days**, corrected and as reported by npm, plus the change vs the previous 7 days.
- **Periods** 5Y · 2Y · 1Y · 3M · 1M · 1W (daily up to a quarter, weekly beyond), remembered between pages; **‹ ›** step one full period back or forward.
- **Chart**: grey — as reported by npm, purple — corrected, dots — days or weeks with outages. For 1Y and shorter, a dashed shadow of the previous period (aligned by weekday) and the change vs it.
- **Period summary**: corrected total, adjustment (how much npm undercounted), change vs the previous period.
- **Tooltip**: both values with their change vs the previous point (in fixed columns, so numbers don't jump while you move along the chart), what was corrected and why (npm-wide outage or data missing for this package), the previous-period value and the difference.
- **Packages menu**: *Recent* — the last 10 packages you opened, starred ones stay on top; *By @author* — the maintainer's other packages, sorted by weekly downloads.

The panel collapses to a single line (click its header). It renders in a Shadow DOM, so npm's styles can't break it, takes its font and colours from the page (npm's light or dark theme, npm purple accent), sits below npm's own menus and disappears when you leave a package page.

## How the correction works

An outage in npm's counting pipeline loses roughly the same share of downloads for every package on that day. Huge packages (`semver`, `debug`, `ms`, `chalk`, `tslib` — tens of millions of downloads a week) have very smooth curves, so a dip in them is almost certainly a counting loss, not a real drop.

1. **Usual level.** For each day: the median of the same weekday over ±4 weeks. Zero days are skipped (full outages often hit the same weekday several weeks in a row), and the window widens to ±8 weeks if fewer than two non-zero days remain.
2. **Capture ratio.** For each reference: `q = actual / usual level`. The day's ratio is the median across references, so one odd reference can't skew it.
3. **Partial outage.** If the ratio is below `0.9`, the package's value is scaled: `corrected = actual / q`.
4. **Full outage.** If the references dropped almost to zero (`q < 0.15`), dividing is unreliable — the day gets the package's own usual level.
5. **Package-level gap.** npm sometimes loses a day for a single package while the references are fine (the package shows 0). If a package that usually has ≥ 100 downloads on that weekday reports ≤ 5% of it, and already had that level in the weeks before, the day gets its usual level. Small packages (where a real 0 happens) and days before a package's launch are left alone.

6. **Holidays.** Around Christmas and New Year (Dec 22 – Jan 5) and on US Thanksgiving, real traffic drops for every package, references included — by ratios alone that looks exactly like an outage, and packages installed by people drop even deeper than CI-heavy references. On those days only full outages (npm reporting ~0) are corrected; the partial dip is real and stays. The tooltip marks such days as *holiday season — real dip, not corrected*.

Days without an outage are left untouched, and so are real spikes and drops of the package itself. Reference packages and thresholds can be changed in the extension's **Options**.

## Install

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/obgkbljnpilaekcjdcoiejlimhgnpimh) (Chrome, Edge, Brave and other Chromium browsers). Open any package page on npmjs.com.

## Data and privacy

- Download counts come from `api.npmjs.org/downloads/range`. It returns at most 18 months per request, so data is fetched in calendar-year chunks (a 5-year view is 6 requests per package on first load, at most 6 in parallel) and cached: past years for 7 days, the current year for 6 hours.
- The author's packages come from `registry.npmjs.org` (the package's maintainers, then a `maintainer:` search), cached for 12 hours.
- Permissions: `storage`, network access to `api.npmjs.org` and `registry.npmjs.org`, and a content script on `www.npmjs.com` (the whole site, because npm navigates between pages without reloading; the panel only appears on package pages). Nothing else — no access to other sites, tabs, history or cookies.
- Everything stays in the browser (`chrome.storage`); the extension has no server, collects no data and talks only to the two npm endpoints above. Full text: [PRIVACY.md](PRIVACY.md).

| Storage area | What is kept | Leaves the device |
|---|---|---|
| `storage.local` (this browser only) | cache of download statistics (expires automatically); recent and starred packages; whether the panel is collapsed | no |
| `storage.sync` (Chrome's extension sync) | Options settings (reference packages, thresholds) and the selected period | only between your own browsers, if Chrome sync is enabled |

## Project layout

TypeScript (strict); the panel is Preact + Tailwind CSS; esbuild bundles everything into plain scripts in `dist/` (nothing is loaded at runtime).

```
src/content.tsx        panel lifecycle on npmjs.com/package/* pages: SPA navigation, shadow root, theme
src/ui/Panel.tsx       the panel (Preact): header, 7-day headline, periods, summary grid, legend
src/ui/Chart.tsx       SVG chart and tooltip
src/ui/PackagesMenu.tsx  Recent / By author menu
src/ui/data.ts         settings and preferences (chrome.storage), background messages, a period's data
src/ui/theme.ts        colours and font from the page → CSS variables on the panel host
src/panel.css          panel stylesheet (Tailwind), compiled into content.js at build time
src/background.ts      service worker: npm API / registry requests, caching
src/options.ts         options page logic
src/popup.ts           toolbar popup (where the extension works)
src/types.ts           shared data shapes and content ↔ background messages
src/defaults.ts        reference packages and thresholds
src/lib/correct.ts     correction algorithm (no browser APIs)
src/lib/period.ts      periods: ranges, date windows, slicing a period out of the series (no browser APIs)
src/lib/chart.ts       chart geometry: scales, ticks, paths, tooltip texts (no browser APIs)
src/lib/recent.ts      recent / starred list logic
static/                manifest.json, options.html, popup.html, icons — copied into dist/ as is
scripts/build.ts       build (--watch, --zip): esbuild with a Tailwind plugin
test/                  Node tests; fixtures/ holds real npm data (Aug–Oct 2026)
CLAUDE.md              notes for AI-assisted development (decisions, data quirks)
```

## Development

Node 22.6+. `npm install`, then:

```
npm run build      # dist/  (chrome://extensions → Developer mode → Load unpacked → dist/)
npm run watch      # rebuild on change (reload the extension and the page after)
npm test           # tsc --noEmit + node --test
npm run zip        # dist/ → npm-downloads-corrected-<version>.zip
```

Tests run the TypeScript sources directly (Node's type stripping, no extra tooling). They cover the algorithm on synthetic data (partial and full outages, package-level gaps, small and young packages), a regression test on real npm data for `tailwindcss-scoped-preflight` and its references (Aug 1 – Oct 18, 2026, including npm-wide zero days; Christmas 2024 for the holiday rule), the period slicing (an npm-wide outage on the first day of a period is not a package launch), and the recent/starred list logic. The UI is checked in a browser with Playwright (not in the repo).

## License

[MIT](LICENSE)
