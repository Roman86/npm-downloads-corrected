# CLAUDE.md — notes for working on this repo

Chrome MV3 extension that shows npm download counts corrected for npm's stats outages. TypeScript (strict) in `src/`; the panel is Preact (+ signals) with Tailwind v4 in `src/panel.css`; esbuild bundles everything into `dist/` (one minified IIFE per entry: content, background, options). See README.md for features and the algorithm; this file records **why** things are the way they are, so they don't get re-litigated.

## Run / test

- `npm run build` → `dist/` (`npm run watch` for rebuilds). `npm test` = `tsc --noEmit` + `node --test test/*.test.ts`.
- Tests and `scripts/build.ts` run as `.ts` directly via Node's type stripping (Node ≥ 22.6). Hence `erasableSyntaxOnly`: no enums, namespaces or parameter properties; imports use explicit `.ts`/`.tsx` extensions; type-only imports use `import type`.
- UI components are `.tsx` (Preact JSX, `jsxImportSource: preact`); Node can't run them, so **Node tests import only `src/lib/*`** (pure `.ts`, no DOM). Keep logic that deserves a test there (`correct`, `period`, `chart` geometry, `recent`).
- Runtime dependencies: `preact`, `@preact/signals` (inlined into content.js). Dev: typescript, esbuild, @types/*, tailwindcss, @tailwindcss/node, @tailwindcss/oxide. All pinned exactly. Nothing is loaded at runtime besides the bundles.
- `static/` is copied with `cp -R` (Node's `cpSync` fails with EACCES on some mounted volumes, e.g. virtiofs in a container).
- Manual: `chrome://extensions` → Developer mode → Load unpacked → `dist/`; open any `npmjs.com/package/*` page. After code changes: reload the extension **and** the npm page. The console logs `[npm-downloads-corrected] vX.Y.Z: panel shown for <pkg>` — use it to confirm which build is running.
- Bump `version` in both `static/manifest.json` and `package.json` for every user-visible change.
- Browser tests are not in the repo. They were done with Playwright: serve a mock `https://www.npmjs.com/package/*` page via `page.route`, stub `window.chrome` (storage.sync/local/onChanged, runtime.sendMessage dispatching to **all** onMessage listeners, getManifest), inject `dist/background.js` + `dist/content.js` with `addScriptTag`, and mock `api.npmjs.org` / `registry.npmjs.org` (with `access-control-allow-origin: *`). Selectors pierce the shadow root in Playwright; in `page.evaluate` use `document.getElementById('npm-downloads-corrected').shadowRoot` — its first element is the panel, its last the Packages menu (there is no `<style>`: the stylesheet is attached via `adoptedStyleSheets`). Measure block offsets of the panel's direct children skeleton vs loaded (they must be identical), check `getComputedStyle(panel).boxShadow !== 'none'` (see the @property note below), and run with `colorScheme: 'dark'` too.

## Facts about npm's data (verified on real data, Aug–Oct 2026)

- On outage days npm reports **0 for every package**, references included (e.g. 2026-08-14, 09-03, 09-07, 09-08, 09-15, 10-06, 10-13…10-15). Partial-loss days also exist (refs ~14% low).
- Outages repeat on the **same weekday** for weeks (several Tuesdays in a row). Hence the weekday baseline **skips zero days** and widens to ±8 weeks when < 2 non-zero neighbours remain. Without this the median collapsed to 0 and outage days stayed at 0 (the bug behind 10-06 showing 0 and 10-13 showing half).
- An npm-wide outage can be the **first day of a period** (1W on 2026-10-20: Oct 13–15 were zero days). The young-package trim therefore uses `corrected > 0`, not `raw > 0` (`lib/period.ts`, `slicePeriod`); with `raw` the week was cut to Oct 16+ and the ‹ arrow disabled (bug in 1.5.5).
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

## UI stack (Preact + Tailwind, since 1.6.0)

- **Why**: the imperative version (string templates + `innerHTML` + manual re-render functions + "is this response still current" checks) was 900 lines; declarative rendering with signals removed most of it. Preact was chosen over Solid/Svelte (esbuild needs no plugin for its JSX) and Lit (no JSX, 4× the size); the bundle grew by ~22 KB minified.
- **State in `Panel.tsx` is keyed**: `shown` / `failed` carry the request key `${range}:${offset}`; "busy" is `shown.key !== key`, not a flag — a flag lagged one frame behind a click. Resolved periods are kept in `done` so going back to one shows it at once, without the dimming transition.
- **Stylesheet**: `src/panel.css` (real CSS, Tailwind v4: theme + utilities only, **no preflight** — the host has `all: initial` and a tiny base layer of our own). The build's esbuild plugin compiles it to a string (`import css from './panel.css'`), attached to the shadow root with `adoptedStyleSheets`. Sizes are px, not rem (rem would follow npm's root font inside the shadow root); `--spacing: 4px`, text sizes `2xs…xl` = 10/11/12/13/14/20 px, all `@theme inline`.
- **Colours**: the page-derived runtime variables (`--bg`, `--fg`, `--accent`, … set on the host by `ui/theme.ts`) are mapped in `@theme inline` to `bg-bg`, `text-muted`, `stroke-accent`, etc. Keep it that way: theming by `prefers-color-scheme` in the CSS was rejected (the panel must follow the page, which also covers Dark Reader-style extensions).
- **`@property` does not register from a shadow root's stylesheet in Chrome.** Tailwind's `translate-*`, `shadow-*`, `ring-*` compose from `--tw-*` variables whose initial values come from `@property`; in the shadow root they silently did nothing (no shadow, no chevron offset). The build unwraps Tailwind's `@supports` fallback (`unwrapPropertiesFallback` in `scripts/build.ts`) so the `*` rule with the initial values always applies; `@layer properties` is declared first in `panel.css` so utilities still win. Don't remove either.
- Markup rules that keep the layout stable are in the comments of `Panel.tsx` (skeleton = real markup + `Ph` placeholders; three summary cells; one "vs previous" line).

## Performance rules

- The body `MutationObserver` must stay cheap: rAF-coalesced, ignores mutations inside our host (shadow DOM mutations aren't observed anyway). No full-document text walks on mutations.
- `chrome.storage.local` is capped at 10 MB; cache writes go through `cacheSet` (never let a failed write break the panel). Pruning is throttled and its timestamp persisted (the service worker restarts often).
- At most 6 parallel requests to the downloads API; 429 → one retry after 1.5 s.

## Code map

- `src/content.tsx` — panel lifecycle only: SPA navigation via MutationObserver + popstate, teardown when leaving a package page, shadow root + stylesheet, `render(<Panel/>)`, theme watcher.
- `src/ui/Panel.tsx` — the panel (header, headline, ranges, nav, period grid, chart box, legend) and its state; `src/ui/Chart.tsx` — SVG + tooltip; `src/ui/PackagesMenu.tsx` — Recent / By author; `src/ui/data.ts` — chrome.storage, `send()`, `compute()` (a period's View); `src/ui/theme.ts` — page colours → host variables; `src/panel.css` — stylesheet.
- `src/lib/correct.ts` — pure algorithm (`correctSeries`, `toWeekly`); `src/lib/period.ts` — ranges, `windowFor`, `slicePeriod`; `src/lib/chart.ts` — chart geometry (`layout`, ticks, `noteLines`); `src/lib/recent.ts` — list logic. All Node-testable.
- `src/background.ts` — all network + caching; one typed dispatcher (`fetchSeries`, `authorPackages`).
- `src/types.ts` — data shapes and the message contract (`Request`, `ResultOf`, `Response<T>`). Content calls the worker only through the typed `send()`; add a message by extending `Request`/`ResultOf` and `HANDLERS`.
- `static/` — `manifest.json`, `options.html`, icons; copied verbatim into `dist/`.
- No globals: modules import each other and esbuild inlines them. The host element id is `npm-downloads-corrected`.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `build:`, `docs:`…), version in parentheses when bumped.

## Conventions

- Code, comments, UI text and commit messages in English.
- When unsure how something looks on the real npmjs.com, say so — mocks have repeatedly differed from the live site.
