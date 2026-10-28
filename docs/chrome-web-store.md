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
npm's download counter regularly loses data: on some days it reports a fraction of the real downloads, on others 0 for every package. The weekly chart on npmjs.com then shows sharp drops that have nothing to do with real usage. This extension detects those days and shows corrected numbers next to npm's own, right on the package page.

WHAT YOU GET
On every npmjs.com package page, a small floating panel in the bottom-right corner:
• Last 7 days — corrected and as reported by npm, plus the change vs the previous 7 days.
• Periods 5Y · 2Y · 1Y · 3M · 1M · 1W (daily up to a quarter, weekly beyond), with ‹ › to step one period back or forward.
• Chart — grey: as reported by npm, purple: corrected, dots: days with outages. For 1Y and shorter, a dashed shadow of the previous period and the change vs it.
• Period summary — corrected total, how much npm undercounted, change vs the previous period.
• Tooltip — both values, what was corrected and why (npm-wide outage, or data missing for this package only), the previous-period value.
• Packages menu — Recent (the last 10 packages you opened, starred ones on top) and By author (the maintainer's other packages, sorted by weekly downloads).
The panel collapses to a single line, follows npm's light or dark theme and never breaks the page layout.

HOW THE CORRECTION WORKS
An outage in npm's counting pipeline loses roughly the same share of downloads for every package on that day. Huge packages (semver, debug, ms, chalk, tslib — tens of millions of downloads a week) have very smooth curves, so a dip in them is almost certainly a counting loss, not a real drop. For each day the extension compares the references against their usual same-weekday level; if they dropped, the package's value for that day is scaled up by the same ratio (or, on days when npm reported ~0 for everything, replaced by the package's own usual level). Real spikes and drops of the package itself are left untouched, and so are holiday dips, when everything really is quieter. Reference packages and thresholds can be changed in Options.

PRIVACY
No data is collected and nothing is sent anywhere except the two npm endpoints the npmjs.com site itself uses (api.npmjs.org for download counts, registry.npmjs.org for maintainers). Stored in your browser only: the statistics cache, your recent/starred packages and the panel state (local storage, never leaves the device); the Options settings and the selected period (Chrome's extension sync, so they follow you between your own browsers). Open source (MIT): https://github.com/Roman86/npm-downloads-corrected
```

**Official / homepage URL**: https://github.com/Roman86/npm-downloads-corrected
**Support URL**: https://github.com/Roman86/npm-downloads-corrected/issues

**Graphics**: store icon 128×128 — `static/icons/icon128.png`. Screenshots 1280×800 — `docs/store/screenshot-*.png`: the real panel (`dist/content.js`) on the fixture data, captured at 2× by `docs/store/store-shots.mjs` (needs a global Playwright; adjust the import path) and composed on a plain background with a caption. Only the page around the panel is a mock, so the panel is exactly what users get; in 1M everything shown is real data, in the dark 3M frame the previous-period shadow (Apr–Jul) is synthesized. Small promo tile 440×280 — `docs/store/promo-440x280.png` (rendered in Chromium from `promo-440x280.svg` next to it, Inter font; the chart is real `tailwindcss-scoped-preflight` data from the test fixture, Sep–Oct 2026). A screenshot of the live npmjs.com page with the panel can be added on top (1280×800, PNG/JPEG, up to 5 in total). Optional: small promo tile 440×280, marquee 1400×560.

## Privacy practices

**Single purpose description**:

```
Shows npm download statistics corrected for outages in npm's stats pipeline, as a panel on npmjs.com package pages.
```

**Permission justifications**:

- `storage`:
  ```
  Caches download statistics fetched from npm so pages open quickly, and keeps the user's settings (reference packages, thresholds), the last 10 packages they opened and the ones they starred. All of it stays in the browser.
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

`npm run zip` → `npm-downloads-corrected-<version>.zip` (the contents of `dist/`, manifest at the root). Needs the `zip` CLI (macOS has it). Bump the version in `static/manifest.json` and `package.json` before every upload; the store rejects a version it has already seen.
