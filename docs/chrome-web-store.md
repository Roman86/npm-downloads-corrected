# Chrome Web Store — what goes where

One file per dashboard field in `docs/store/text/`; copy a file's whole content into its field. Keep them in sync with README.md and PRIVACY.md. The store renders plain text (no Markdown).

## Store listing

| Field | Value |
|---|---|
| Title, Summary | from the manifest (name, description) |
| Description | `text/description.txt` |
| Category · Language | Developer Tools · English |
| Store icon | from the manifest (`static/icons/icon128.png`) |
| Screenshots (1280×800) | `screenshot-5-live-page.png` first (live npmjs.com page, dark, 1Y), then `screenshot-1…4`, `screenshot-6-options.png` last |
| Small promo tile (440×280) | `promo-440x280.png` |
| Official / homepage URL | https://github.com/Roman86/npm-downloads-corrected |
| Support URL | https://github.com/Roman86/npm-downloads-corrected/issues |

## Privacy practices

| Field | Value |
|---|---|
| Single purpose description | `text/single-purpose.txt` |
| Permission justification: `storage` | `text/permission-storage.txt` |
| Permission justification: host permissions (one field) | `text/permission-host.txt` (per-host variants: `permission-host-*.txt`, `permission-content-script-*.txt`) |
| Remote code | No, I am not using remote code (everything, including Preact, is bundled; nothing is loaded at runtime) |
| Data usage | nothing collected: leave every category unchecked |
| Certifications | check all three (not sold; not used for unrelated purposes; not used for creditworthiness) |
| Privacy policy URL | https://github.com/Roman86/npm-downloads-corrected/blob/main/PRIVACY.md |

## Distribution and account

Visibility: Public · Payments: Free of charge · Regions: all. Publisher account: **non-trader** (EEA Digital Services Act), contact e-mail set and verified in Account settings.

## Package

`npm run zip` → `npm-downloads-corrected-<version>.zip`: the contents of `dist/`, manifest at the root (needs the `zip` CLI). Bump the version in `static/manifest.json` and `package.json` before every upload.

## Screenshots

`screenshot-1…4` and `screenshot-6-options.png` (the settings page, `dist/options.html`, defaults) are the real UI (`dist/content.js`) on the test-fixture data, captured at 2× by `store-shots.mjs` (needs a global Playwright; adjust the import path) and composed on a plain background with a caption. Only the page around the panel is a mock, so the panel is exactly what users get; in 1M everything shown is real data, in the dark 3M frame the previous-period shadow (Apr–Jul) is synthesized. `screenshot-5-live-page.png` is the live npmjs.com page (dark, 1Y on tailwindcss-scoped-preflight, 2026-10-28), cropped to 16:10 and scaled to 1280×800. `promo-440x280.png` is rendered in Chromium from `promo-440x280.svg` (Inter font); its chart is real fixture data too.
