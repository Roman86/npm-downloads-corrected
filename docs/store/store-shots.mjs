// Store screenshots 1280×800: the real panel (dist/content.js) on real fixture
// data, captured at 2× and composed on a plain background with a caption.
import { chromium } from '/usr/local/share/npm-global/lib/node_modules/playwright/index.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const ROOT = '/home/node/npm-downloads-corrected-chrome-extension';
const DIST = `${ROOT}/dist`;
const OUT = process.env.OUT || `${ROOT}/docs/store`;
mkdirSync(OUT, { recursive: true });
const PKG = 'tailwindcss-scoped-preflight';
const FIX = JSON.parse(readFileSync(`${ROOT}/test/fixtures/npm-2026-08-01_2026-10-18.json`, 'utf8')).series;
const TODAY = '2026-10-19'; // fixture ends 2026-10-18 = "yesterday"

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>${PKG} - npm</title>
<style>
  body { margin: 0; font-family: "Fira Sans", "Helvetica Neue", Arial, sans-serif; color: #262626; background: #fff; }
  @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } }
  main { padding: 40px; display: flex; gap: 40px; } article { flex: 1; } aside { width: 300px; }
  h3 { font-size: 13px; text-transform: uppercase; color: #757575; }
  @media (prefers-color-scheme: dark) { h3 { color: #a0a0a0; } }
</style></head><body><main><article><h1>${PKG}</h1>${'<p>Lorem ipsum dolor sit amet.</p>'.repeat(40)}</article>
<aside><section><h3>Weekly Downloads</h3><p>52,587</p><svg width="200" height="40"><path d="M0 30 L50 10 L100 25 L200 5" stroke="#8956ff" fill="none" stroke-width="2"/></svg></section></aside>
</main></body></html>`;

// Fixture days as is; days outside it borrow the same weekday from the first weeks (cycled).
const DAY = 864e5;
function series(pkg, start, end) {
  const fx = FIX[pkg] || FIX.semver;
  const byDay = new Map(fx.map((d) => [d.day, d.downloads]));
  const out = [];
  for (let t = Date.parse(start + 'T00:00:00Z'); t <= Date.parse(end + 'T00:00:00Z'); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10);
    let v = byDay.get(day);
    if (v == null) {
      const i = Math.round((t - Date.parse(fx[0].day + 'T00:00:00Z')) / DAY);
      const k = ((i % 28) + 28) % 28; // same weekday, first 4 weeks of the fixture
      v = fx.filter((d) => d.day < '2026-08-29')[k]?.downloads ?? 0;
      if (v === 0) v = fx[k + 7].downloads;
    }
    out.push({ day, downloads: v });
  }
  return out;
}

const chromeStub = (recent) => {
  const mem = { sync: {}, local: { 'ui.recent': recent } };
  const changed = new Set();
  const area = (name) => ({
    get(keys, cb) {
      const store = mem[name], out = {};
      if (keys == null) Object.assign(out, store);
      else if (typeof keys === 'string') { if (keys in store) out[keys] = store[keys]; }
      else if (Array.isArray(keys)) keys.forEach((k) => { if (k in store) out[k] = store[k]; });
      else for (const k in keys) out[k] = k in store ? store[k] : keys[k];
      const p = Promise.resolve(out); if (cb) p.then(cb); return p;
    },
    set(items, cb) {
      const changes = {};
      for (const k in items) { changes[k] = { oldValue: mem[name][k], newValue: items[k] }; mem[name][k] = items[k]; }
      changed.forEach((l) => l(changes, name));
      const p = Promise.resolve(); if (cb) p.then(cb); return p;
    },
    remove(keys, cb) { for (const k of [].concat(keys)) delete mem[name][k]; const p = Promise.resolve(); if (cb) p.then(cb); return p; },
  });
  const listeners = [];
  window.chrome = {
    storage: { sync: area('sync'), local: area('local'), onChanged: { addListener: (l) => changed.add(l), removeListener: (l) => changed.delete(l) } },
    runtime: { id: 'test', lastError: undefined, getManifest: () => ({ version: 'store' }),
      onMessage: { addListener: (l) => listeners.push(l) },
      sendMessage(msg, cb) { let done = false; for (const l of listeners) l(msg, {}, (r) => { if (!done) { done = true; cb && cb(r); } }); } },
  };
};

const RECENT = { recent: ['tailwindcss-scoped-preflight', 'tailwindcss', 'preact', '@preact/signals', 'esbuild', 'typescript', 'zod'], starred: ['tailwindcss', 'preact'] };

async function session(dark) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00Z`));
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await page.addInitScript(chromeStub, RECENT);
  await page.route('https://www.npmjs.com/**', (route) => route.fulfill({ contentType: 'text/html', body: HTML }));
  await page.route('https://api.npmjs.org/**', (route) => {
    const m = route.request().url().match(/downloads\/range\/(\d{4}-\d\d-\d\d):(\d{4}-\d\d-\d\d)\/(.+)$/);
    route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ start: m[1], end: m[2], package: m[3], downloads: series(decodeURIComponent(m[3]), m[1], m[2]) }) });
  });
  await page.route('https://registry.npmjs.org/**', (route) => {
    const url = route.request().url();
    let body;
    if (url.endsWith('/latest')) body = { maintainers: [{ name: 'roman86' }] };
    else if (url.includes('maintainer:')) body = { total: 4, objects: [
      { package: { name: PKG }, downloads: { weekly: 52587 } },
      { package: { name: 'npm-downloads-corrected' }, downloads: { weekly: 1200 } },
      { package: { name: 'react-scoped-styles' }, downloads: { weekly: 8310 } },
      { package: { name: '@roman86/cli' }, downloads: { weekly: 420 } } ] };
    else body = { objects: [] };
    route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.goto(`https://www.npmjs.com/package/${PKG}`);
  await page.addScriptTag({ path: `${DIST}/background.js` });
  await page.addScriptTag({ path: `${DIST}/content.js` });
  const host = page.locator('#npm-downloads-corrected');
  await host.waitFor();
  const loaded = async () => { await page.waitForFunction(() => document.getElementById('npm-downloads-corrected').shadowRoot.querySelector('svg path'), null, { timeout: 10000 }); await page.waitForTimeout(400); };
  return { browser, page, host, loaded };
}

const shots = [];
async function shot(host, name, caption) {
  const file = `${OUT}/_${name}.png`;
  await host.screenshot({ path: file });
  shots.push({ name, file, caption });
}

// Light: 1M (all real data), tooltip on an npm-wide outage day, Packages menu.
{
  const { browser, page, host, loaded } = await session(false);
  await host.locator('[role=tab]', { hasText: '1M' }).click();
  await loaded();
  await shot(host, 'panel-1m', ['Corrected download counts', 'next to npm’s own, on every package page']);

  // Hover until the tooltip shows an outage day in mid-October.
  const bb = await host.locator('svg').first().boundingBox();
  const tipText = () => page.evaluate(() => document.getElementById('npm-downloads-corrected').shadowRoot.querySelector('.tip')?.textContent || '');
  let found = false;
  for (let fx = 0.55; fx < 0.95 && !found; fx += 0.01) {
    await page.mouse.move(bb.x + bb.width * fx, bb.y + bb.height / 2);
    await page.waitForTimeout(30);
    const t = await tipText();
    if (/Oct 1[45]/.test(t) && /outage/i.test(t)) found = true;
  }
  console.log('tooltip found:', found, (await tipText()).slice(0, 80));
  await shot(host, 'tooltip', ['Hover a day to see', 'what was corrected and why']);
  await page.mouse.move(5, 5);

  await host.locator('button[aria-haspopup]').click();
  await page.waitForTimeout(200);
  await shot(host, 'menu-recent', ['Recent and starred packages,', 'and the author’s other packages']);
  await page.keyboard.press('Escape');
  await browser.close();
}
// Dark: 3M.
{
  const { browser, host, loaded } = await session(true);
  await host.locator('[role=tab]', { hasText: '3M' }).click();
  await loaded();
  await shot(host, 'dark-3m', ['Follows npm’s dark theme;', 'a quarter, a year or five at a glance']);
  await browser.close();
}

// Compose 1280×800 frames.
const browser = await chromium.launch();
for (const [i, s] of shots.entries()) {
  const dark = s.name.startsWith('dark');
  const img = readFileSync(s.file).toString('base64');
  const html = `<!doctype html><meta charset="utf-8">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=block">
  <style>
    html,body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:Inter,'Liberation Sans',Arial,sans-serif}
    body{background:${dark ? 'linear-gradient(135deg,#262b33,#1a1d23)' : 'linear-gradient(135deg,#f6f3ff,#eef0f4)'};color:${dark ? '#fff' : '#1f2329'};display:flex;align-items:center}
    .text{flex:1;padding:0 56px 0 72px}
    h1{font-size:40px;line-height:1.15;font-weight:700;margin:0 0 18px;letter-spacing:-.3px}
    p{font-size:20px;line-height:1.4;margin:0;color:${dark ? '#a3a9b3' : '#5c6470'}}
    .brand{display:flex;align-items:center;gap:12px;margin-bottom:34px;font-size:17px;font-weight:600;color:${dark ? '#c9b3ff' : '#6b3fe6'}}
    .brand img{width:40px;height:40px}
    .shot{flex:none;padding-right:72px;display:flex;align-items:center}
    .shot img{display:block;width:${Math.round((await imgWidth(s.file)) / 2 * 1.35)}px;border-radius:14px;box-shadow:0 24px 64px rgba(0,0,0,${dark ? '.55' : '.18'}),0 0 0 1px rgba(0,0,0,${dark ? '.4' : '.06'})}
  </style>
  <body>
    <div class="text">
      <div class="brand"><img src="data:image/svg+xml;base64,${readFileSync(`${ROOT}/static/icons/icon128.svg`).toString('base64')}">npm Downloads Corrected</div>
      <h1>${s.caption[0]}</h1><p>${s.caption[1]}</p>
    </div>
    <div class="shot"><img src="data:image/png;base64,${img}"></div>
  </body>`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/screenshot-${i + 1}-${s.name}.png` });
  await page.close();
}
await browser.close();

async function imgWidth(file) {
  const b = readFileSync(file);
  return b.readUInt32BE(16); // PNG IHDR width
}
console.log('done:', shots.map((s) => s.name).join(', '));
