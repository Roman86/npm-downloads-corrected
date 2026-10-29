# Privacy policy — npm Downloads Corrected

_Last updated: 2026-10-28_

**npm Downloads Corrected** is a browser extension that shows npm download counts corrected for outages in npm's statistics pipeline, on `npmjs.com` package pages.

## What the extension does with data

- **It collects no data.** The extension has no server of its own, no analytics, no telemetry and no accounts. Nothing about you or your browsing is sent anywhere.
- **It talks to two npm endpoints only**, the same ones the npmjs.com website uses:
  - `api.npmjs.org` — daily download counts for the package you are looking at and for a few reference packages (`semver`, `debug`, `ms`, `chalk`, `tslib` by default);
  - `registry.npmjs.org` — the package's maintainers and the maintainer's other packages, for the "By author" list.

  These requests contain package names only. They are subject to [npm's privacy policy](https://docs.npmjs.com/policies/privacy).
- **It runs only on `https://www.npmjs.com/`** and only acts on package pages. It does not read or modify any other site, and it has no access to your tabs, history, cookies or downloads.

## What is stored, and where

Everything is stored in your browser through `chrome.storage`, never on a server:

| Storage area | What is kept | Leaves the device |
|---|---|---|
| `storage.local` (this browser only) | cache of download statistics fetched from npm (expires automatically); the last 10 packages you opened on npmjs.com and the ones you starred; whether the panel is collapsed | no |
| `storage.sync` (Chrome's extension sync) | settings from the Settings page (reference packages, thresholds) and the selected period | only between your own browsers, if Chrome sync is enabled for extensions |

Uninstalling the extension removes all of it.

## Changes and contact

The extension is open source: <https://github.com/Roman86/npm-downloads-corrected>. Changes to this policy are published there. Questions: open an issue in that repository.
