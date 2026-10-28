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

Everything is stored in your browser (`chrome.storage`), never elsewhere:

- a cache of download statistics fetched from npm (so pages open faster; expires automatically);
- the list of packages you recently opened on npmjs.com and the ones you starred (the "Recent" list; at most 10 recent entries);
- your settings from the Options page (reference packages and thresholds) and the selected period. These may be synced between your own browsers by Chrome's built-in extension sync, if you have it enabled.

Uninstalling the extension removes all of it.

## Changes and contact

The extension is open source: <https://github.com/Roman86/npm-downloads-corrected>. Changes to this policy are published there. Questions: open an issue in that repository.
