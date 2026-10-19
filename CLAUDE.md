# CLAUDE.md — notes for working on this repo

Chrome MV3 extension that shows npm download counts corrected for npm's stats outages. TypeScript (strict) in `src/`, bundled by esbuild into `dist/` (one IIFE per entry: content, background, options). See README.md for features and the algorithm; this file records **why** things are the way they are, so they don't get re-litigated.

## Run / test

- `npm run build` → `dist/` (`npm run watch` for rebuilds). `npm test` = `tsc --noEmit` + `node --test test/*.test.ts`.
- Tests and `scripts/build.ts` run as `.ts` directly via Node's type stripping (Node ≥ 22.6). Hence `erasableSyntaxOnly`: no enums, namespaces or parameter properties; imports use explicit `.ts` extensions; type-only imports use `import type`.
- Dev dependencies only (typescript, esbuild, @types/chrome, @types/node), pinned exactly. Nothing ships at runtime besides the bundles.
- Manual: `chrome://extensions` → Developer mode → Load unpacked → `dist/`; open any `npmjs.com/package/*` page. After code changes: reload the extension **and** the npm page. The console logs `[npm-downloads-corrected] vX.Y.Z: panel shown for <pkg>` — use it to confirm which build is running.
- Bump `version` in both `static/manifest.json` and `package.json` for every user-visible change.
- Browser tests are not in the repo. They were done with Playwright: serve a mock `https://www.npmjs.com/package/*` page via `page.route`, stub `window.chrome` (storage.sync/local/onChanged, runtime.sendMessage dispatching to **all** onMessage listeners, getManifest), inject `dist/background.js` + `dist/content.js` with `addScriptTag`, and mock `api.npmjs.org` / `registry.npmjs.org` (with `access-control-allow-origin: *`). Selectors pierce the shadow root in Playwright; in `page.evaluate` use `document.getElementById('npm-downloads-corrected').shadowRoot`.

## Facts about npm's data (verified on real data, Aug–Oct 2026)

- On outage days npm reports **0 for every package**, references included (e.g. 2026-08-14, 09-03, 09-07, 09-08, 09-15, 10-06, 10-13…10-15). Partial-loss days also exist (refs ~14% low).
- Outages repeat on the **same weekday** for weeks (several Tuesdays in a row). Hence the weekday baseline **skips zero days** and widens to ±8 weeks when < 2 non-zero neighbours remain. Without this the median collapsed to 0 and outage days stayed at 0 (the bug behind 10-06 showing 0 and 10-13 showing half).
- npm can also lose a day for a single package while refs are fine → "package-level gap" rule (≤ 5% of usual level, usual ≥ 100/day, existed before). Small packages have real zeros — don't touch them.
- **Holidays look like outages.** Christmas 2024: refs fell to ~50% of normal, `tailwindcss-scoped-preflight` to ~29% (people-installed packages drop deeper than CI-heavy refs); the dip ran Dec 23 – Jan 3, smooth, no zeros. Ratio correction "fixed" that week 11,339 → 21,663. Hence `isHoliday` (Dec 22 – Jan 5, US Thanksgiving Thu+Fri): on those days only full outages (q < minRatio) are corrected and the gap rule needs a hard 0. Pinned by `test/fixtures/npm-2024-11-04_2025-01-26.json`.
- `test/fixtures/npm-2026-08-01_2026-10-18.json` holds real data for `tailwindcss-scoped-preflight` + the 5 references; the regression test pins last-week npm = 52,587 → corrected ≈ 118,921. Keep it passing.
- Downloads API: max 18 months per range request → fetched in calendar-year chunks. Registry: `/<pkg>/latest` → `maintainers`; `_npmUser` is useless with CI publishing ("GitHub Actions"). `/-/v1/search?text=maintainer:<user>` already includes `downloads.weekly`.

## Design decisions (and what was tried and rejected)

- **Floating panel only**, bottom-right, attached to `<body>`. Inline placement under npm's Weekly Downloads block was tried several ways (heading search, section-label climbing, geometry self-checks) and kept landing inside npm's flex row / under the README on the real page. The floating panel is a deliberate choice — don't reintroduce DOM-embedding.
- Content script matches **all of `https://www.npmjs.com/*`**, not just `/package/*`: npm is a SPA and Chrome injects only on a full page load, so entering a package from search/home wouldn't show the panel. The script itself only acts on package URLs. Permissions stay npm-only: `storage` + host access to `api.npmjs.org` / `registry.npmjs.org`.
- **Shadow DOM** for the panel; host layout rules are `!important` (page rules on the host otherwise beat `:host`). npm's CSS leaked into the panel before this.
- **z-index: 1** — above page content, below npm's own menus (an earlier 9999 covered the profile menu).
- **Theme from the page**: colours/font from the "Weekly Downloads" heading (else `main`/`#app`), never from `<body>` (no font there → Times). Accent: npm sparkline colour if readable, else npm purple `#8956FF` (red was rejected as alarming). Green/red only for change vs previous period; the "adjustment" is neutral grey.
- Previous-period shadow is aligned by weekday (shift = period rounded up to whole weeks; 1M uses 35 days). The previous period is corrected too.
- **No layout shift.** The panel is anchored to the bottom, so any height change moves everything. Skeletons are the real markup with placeholder text (`.ph`: transparent text on a shimmer bar), so line heights match in any font; the summary always has the "vs previous 7 days" line (dash if none); the period grid always has three cells and no extra lines (a young package shows "since <date>" as the first cell's label). Check with a Playwright measurement of block offsets skeleton vs loaded.
- Headline is always the last 7 days (same window as npm's widget); the period switcher affects the chart and the summary grid only.
- Range buttons are ordered 5Y → 1W. UI is English only (localization was dropped on purpose).
- Packages menu: Recent = 10, starred on top, **no star limit** (a limit was tried and dropped). "By @author" = first maintainer, chips to switch when several.

## Performance rules

- The body `MutationObserver` must stay cheap: rAF-coalesced, ignores mutations inside our host (shadow DOM mutations aren't observed anyway). No full-document text walks on mutations.
- `chrome.storage.local` is capped at 10 MB; cache writes go through `cacheSet` (never let a failed write break the panel). Pruning is throttled and its timestamp persisted (the service worker restarts often).
- At most 6 parallel requests to the downloads API; 429 → one retry after 1.5 s.

## Code map

- `src/content.ts` — panel lifecycle (SPA navigation via MutationObserver + popstate; teardown when leaving a package page), data → view, summary/period rendering, Packages menu, theming.
- `src/lib/correct.ts` — pure algorithm (`correctSeries`, `toWeekly`), Node-testable.
- `src/lib/chart.ts` — SVG chart + tooltip; `src/lib/recent.ts` — pure list logic; `src/lib/styles.ts` — CSS string for the shadow root.
- `src/background.ts` — all network + caching; one typed dispatcher (`fetchSeries`, `authorPackages`).
- `src/types.ts` — data shapes and the message contract (`Request`, `ResultOf`, `Response<T>`). Content calls the worker only through the typed `send()`; add a message by extending `Request`/`ResultOf` and `HANDLERS`.
- `static/` — `manifest.json`, `options.html`, icons; copied verbatim into `dist/`.
- No globals: modules import each other and esbuild inlines them. The host element id is `npm-downloads-corrected`.

## Conventions

- Code, comments, UI text and commit messages in English.
- When unsure how something looks on the real npmjs.com, say so — mocks have repeatedly differed from the live site.
