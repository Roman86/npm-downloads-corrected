// npm Downloads Corrected — content script for npmjs.com/package/* pages.
// Shows a floating panel (bottom-right, Shadow DOM) with download counts
// corrected for npm's stats outages, a period chart, and a Packages menu.
//
// This file is the panel's lifecycle on npm's SPA; the panel itself is
// ui/Panel.tsx (Preact), its stylesheet panel.css (Tailwind).
import { render } from 'preact';
import css from './panel.css';
import { getCollapsed, getSettings } from './ui/data.ts';
import { Panel } from './ui/Panel.tsx';
import { watchTheme, type Theme } from './ui/theme.ts';
import { log } from './ui/util.ts';

const PANEL_ID = 'npm-downloads-corrected';

// The panel lives in a shadow root so npm's CSS can't leak into it (and ours
// can't leak out). One stylesheet, shared by every mount.
let sheet: CSSStyleSheet | null = null;
function styles(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  }
  return sheet;
}

interface Mounted {
  pkg: string;
  host: HTMLElement;
  shadow: ShadowRoot;
  theme: Theme;
}
let mounted: Mounted | null = null;
let lastPkg: string | null = null; // package of the current page (set by check())

function packageFromUrl(): string | null {
  const m = location.pathname.match(/^\/package\/((?:@[^/]+\/)?[^/]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

function teardown(): void {
  if (mounted) {
    mounted.theme.dispose();
    render(null, mounted.shadow);
    mounted.host.remove();
  }
  document.getElementById(PANEL_ID)?.remove();
  mounted = null;
}

async function start(pkg: string): Promise<void> {
  teardown();
  let settings, collapsed;
  try {
    [settings, collapsed] = await Promise.all([getSettings(), getCollapsed()]);
  } catch (err) {
    log('failed to read settings', err);
    return;
  }
  // The user may have navigated away while settings were loading.
  if (packageFromUrl() !== pkg || lastPkg !== pkg || mounted) return;

  const host = document.createElement('div');
  host.id = PANEL_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.adoptedStyleSheets = [styles()];
  mounted = { pkg, host, shadow, theme: watchTheme(host) };
  render(<Panel key={pkg} pkg={pkg} settings={settings} host={host} collapsed={collapsed} />, shadow);
  ensurePlaced();
}

// Always a floating panel in the bottom-right corner, attached to <body>
// (not npm's React tree, so npm's re-renders and CSS don't affect it).
function ensurePlaced(): void {
  if (!mounted || mounted.host.isConnected) return;
  document.body.appendChild(mounted.host);
  let version = '?';
  try {
    version = chrome.runtime.getManifest().version;
  } catch {
    /* extension context gone (reloaded) */
  }
  log(`v${version}: panel shown for`, mounted.pkg);
}

// npmjs.com is a SPA: react to every URL change, including leaving the
// package page (profile, search, settings…) — then the panel is removed.
function check(): void {
  const pkg = packageFromUrl();
  if (!pkg) {
    if (lastPkg || mounted) {
      lastPkg = null;
      teardown();
    }
    return;
  }
  if (pkg !== lastPkg) {
    lastPkg = pkg;
    start(pkg);
    return;
  }
  ensurePlaced();
}
// Coalesce bursts of DOM mutations into one check per frame.
let scheduled = false;
const scheduleCheck = () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    check();
  });
};
// Ignore mutations inside our own panel (shadow DOM mutations aren't observed anyway).
new MutationObserver((records) => {
  const host = mounted?.host;
  if (host && records.every((r) => host.contains(r.target))) return;
  scheduleCheck();
}).observe(document.body, { childList: true, subtree: true });
window.addEventListener('popstate', check);
check();
