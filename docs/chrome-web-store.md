# Chrome Web Store — listing and privacy texts

Copy-paste source for the developer dashboard. Keep in sync with README.md and PRIVACY.md.
The store renders plain text (no Markdown) in the description.

## Store listing

**Title** (from manifest): npm Downloads Corrected

**Summary** (from manifest `description`, ≤ 132 chars):
Fixes outage dips in npmjs.com download stats by comparing against huge reference packages.

**Category**: Developer Tools · **Language**: English

**Description**:

```
npm's download counter loses data: on some days it reports a fraction of the real downloads, on others 0 for every package. The chart on npmjs.com then shows drops that have nothing to do with real usage.

This extension detects those days by comparing against huge reference packages (semver, debug, ms, chalk, tslib) and shows corrected numbers next to npm's own, in a small panel on every package page:

• Last 7 days, corrected and as reported by npm.
• Periods from a week to five years. Grey: npm, purple: corrected, dots: days with outages, dashed: the previous period.
• Tooltip with what was corrected and why.
• Recent and starred packages, and the maintainer's other packages.

Real spikes and drops of the package itself are left untouched, and so are holiday dips. Reference packages and thresholds can be changed in Options.

No data is collected. The extension talks only to api.npmjs.org and registry.npmjs.org, and everything it stores stays in your browser.

Open source (MIT): https://github.com/Roman86/npm-downloads-corrected
```

**Official / homepage URL**: https://github.com/Roman86/npm-downloads-corrected
**Support URL**: https://github.com/Roman86/npm-downloads-corrected/issues

**Graphics**: store icon 128×128 — `static/icons/icon128.png`. Screenshots 1280×800 — `docs/store/screenshot-*.png`: the real panel (`dist/content.js`) on the fixture data, captured at 2× by `docs/store/store-shots.mjs` (needs a global Playwright; adjust the import path) and composed on a plain background with a caption. Only the page around the panel is a mock, so the panel is exactly what users get; in 1M everything shown is real data, in the dark 3M frame the previous-period shadow (Apr–Jul) is synthesized. Small promo tile 440×280 — `docs/store/promo-440x280.png` (rendered in Chromium from `promo-440x280.svg` next to it, Inter font; the chart is real `tailwindcss-scoped-preflight` data from the test fixture, Sep–Oct 2026). `screenshot-5-live-page.png` is the live npmjs.com page (dark theme, 1Y on tailwindcss-scoped-preflight, 2026-10-28), cropped to 16:10 and scaled to 1280×800. Upload it first: it shows the panel in context. Optional: small promo tile 440×280, marquee 1400×560.

## Privacy practices

**Single purpose description**:

```
Shows npm download statistics corrected for outages in npm's stats pipeline, as a panel on npmjs.com package pages.
```

**Permission justifications**:

- `storage`:
  ```
  Browser-local storage (chrome.storage) for the user's settings (reference packages, thresholds), the last 10 packages they opened and the ones they starred, and a cache of download statistics already fetched from npm, so package pages open without refetching. Nothing is sent to any server.
  ```
- Host permission `https://api.npmjs.org/*`:
  ```
  Fetches daily download counts for the package being viewed and for the reference packages. This is the data the correction is computed from. Requests contain package names only.
  ```
- Host permission `https://registry.npmjs.org/*`:
  ```
  Reads the package's maintainers and the maintainer's other packages for the "By author" list in the panel's Packages menu.
  ```
- Content script on `https://www.npmjs.com/*`:
  ```
  Renders the panel on npmjs.com package pages. It is registered for the whole site because npmjs.com is a single-page app: navigating from search or the home page to a package does not reload the page, so a /package/* match alone would miss those navigations. The script itself only acts on package pages and only adds its own panel; it does not read or change the page's content.
  ```

**Remote code**: No, I am not using remote code. (Everything, including the Preact library, is bundled into the extension's own scripts; nothing is loaded at runtime.)

**Data usage**: no data collected — leave every category unchecked (personally identifiable information, health, financial and payment, authentication, personal communications, location, web history, user activity, website content).

**Certifications** (check all three): not sold to third parties; not used or transferred for purposes unrelated to the item's core functionality; not used or transferred to determine creditworthiness or for lending purposes.

**Privacy policy URL**: https://github.com/Roman86/npm-downloads-corrected/blob/main/PRIVACY.md

## Distribution

Visibility: Public · Payments: Free of charge · Regions: all.
Publisher account: declare as **non-trader** (EEA Digital Services Act) — free extension, published by an individual.

## Package

`npm run zip` → `npm-downloads-corrected-<version>.zip`: the contents of `dist/`, manifest at the root (needs the `zip` CLI). Bump the version in `static/manifest.json` and `package.json` before every upload.
