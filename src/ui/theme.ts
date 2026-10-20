// Theme from the page: background and text colour around npm's "Weekly
// Downloads" heading, accent from npm's own sparkline, the page's font.
// Written as CSS variables on the host (see panel.css for the list), so the
// panel follows npm's light/dark theme and extensions like Dark Reader.
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(str: string | null | undefined): Rgba | null {
  const m = /rgba?\(([^)]+)\)/.exec(str ?? '');
  if (!m?.[1]) return null;
  const [r = NaN, g = NaN, b = NaN, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return [r, g, b].every(Number.isFinite) ? { r, g, b, a: Number.isFinite(a) ? a : 1 } : null;
}
const rgb = (r: number, g: number, b: number): Rgba => ({ r, g, b, a: 1 });
const css = (c: Rgba) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
const mix = (a: Rgba, b: Rgba, w: number): Rgba =>
  rgb(a.r * w + b.r * (1 - w), a.g * w + b.g * (1 - w), a.b * w + b.b * (1 - w));
const lum = (c: Rgba) => {
  const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const contrast = (a: Rgba, b: Rgba) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const saturation = (c: Rgba) => {
  const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
  return mx ? (mx - mn) / mx : 0;
};

function pageBackground(el: Element): Rgba {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = parseColor(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0.5) return c;
  }
  const dark =
    matchMedia('(prefers-color-scheme: dark)').matches &&
    /dark/.test(getComputedStyle(document.documentElement).colorScheme || '');
  return dark ? rgb(18, 18, 18) : rgb(255, 255, 255);
}

// The most saturated stroke/fill colour in npm's sparkline, if it's an SVG.
function sparklineColor(widget: Element | null): Rgba | null {
  if (!widget) return null;
  let best: Rgba | null = null;
  for (const n of widget.querySelectorAll('svg path, svg polyline, svg line, svg rect, svg circle')) {
    const cs = getComputedStyle(n);
    for (const c of [parseColor(cs.stroke), parseColor(cs.fill)]) {
      if (c && c.a > 0.3 && saturation(c) > 0.3 && (!best || saturation(c) > saturation(best))) best = c;
    }
  }
  return best && { ...best, a: 1 };
}

// The page's font, unless it's the browser default serif (an element with no
// font set) — then a system sans-serif instead of Times.
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
function pageFont(family: string): string {
  const first = (family.split(',')[0] ?? '').trim().replace(/["']/g, '').toLowerCase();
  return !first || first === 'serif' || first.startsWith('times') ? SYSTEM_FONT : family;
}

// Where to take the page's look from: npm's "Weekly Downloads" heading (it
// carries the sidebar's font and colours), else the main content area.
const HEADING_RE = /^\s*Weekly Downloads\s*$/i;
function themeSource(): Element {
  for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
    if (HEADING_RE.test(el.textContent ?? '') && el.getClientRects().length) return el;
  }
  return document.querySelector('main, [role="main"], #app, #root') ?? document.body;
}

// npm's sparkline (for the accent colour): the nearest ancestor of the
// heading that contains an SVG, at most a few levels up.
function sparklineHost(heading: Element): Element | null {
  let el: Element | null = heading;
  for (let i = 0; i < 4 && el?.parentElement; i++) {
    el = el.parentElement;
    if (el.querySelector('svg path, svg polyline')) return el;
  }
  return null;
}

function themeVars(): Record<string, string> {
  const ref = themeSource();
  const isHeading = ref.matches('h1, h2, h3, h4, h5, h6, [role="heading"]');
  const bg = pageBackground(ref);
  const textEl = isHeading && ref.parentElement ? ref.parentElement : ref;
  let fg = parseColor(getComputedStyle(textEl).color) ?? rgb(51, 51, 51);
  const dark = lum(bg) < 0.3;
  if (contrast(fg, bg) < 3) fg = dark ? rgb(230, 230, 230) : rgb(40, 40, 40);
  let accent = isHeading ? sparklineColor(sparklineHost(ref)) : null;
  // Default: npm's sparkline purple (when the sparkline colour can't be read, e.g. a canvas).
  if (!accent || contrast(accent, bg) < 1.8) accent = dark ? rgb(155, 117, 255) : rgb(137, 86, 255);

  return {
    '--bg': css(bg),
    '--fg-strong': css(fg),
    '--fg': css(mix(fg, bg, 0.85)),
    '--muted': css(mix(fg, bg, 0.55)),
    '--faint': css(mix(fg, bg, 0.08)),
    '--border': css(mix(fg, bg, 0.16)),
    '--subtle': css(mix(fg, bg, 0.07)),
    '--raised': dark ? css(mix(fg, bg, 0.16)) : '#fff',
    '--raw': css(mix(fg, bg, 0.4)),
    '--prev': css(mix(fg, bg, 0.5)),
    '--accent': css(accent),
    '--up': dark ? '#4cc38a' : '#2e8b57',
    '--down': dark ? '#ff6b6b' : '#cb3837',
    '--tip-bg': dark ? css(mix(fg, bg, 0.14)) : 'rgba(32, 32, 32, .94)',
    '--tip-fg': dark ? css(fg) : '#fff',
    '--tip-muted': dark ? css(mix(fg, bg, 0.65)) : '#c8c8c8',
    '--tip-border': dark ? css(mix(fg, bg, 0.25)) : 'transparent',
    '--skel-a': css(mix(fg, bg, 0.08)),
    '--skel-b': css(mix(fg, bg, 0.03)),
    '--shadow': dark ? '0 6px 24px rgba(0, 0, 0, .55)' : '0 6px 24px rgba(0, 0, 0, .14)',
    '--font': pageFont(getComputedStyle(ref).fontFamily),
  };
}

export interface Theme {
  dispose(): void;
}

/**
 * Keeps the host's theme variables in sync with the page: applied now, again
 * shortly after load (npm may still be rendering its sidebar: font, sparkline
 * colour), and whenever the site switches light/dark (class/attribute on
 * <html> or <body>) or the OS scheme changes.
 */
export function watchTheme(host: HTMLElement): Theme {
  let key: string | null = null;
  const apply = () => {
    const v = themeVars();
    const k = JSON.stringify(v);
    if (k === key) return;
    key = k;
    for (const [name, val] of Object.entries(v)) host.style.setProperty(name, val);
  };
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  };

  apply();
  const timers = [500, 1500, 4000].map((ms) => setTimeout(apply, ms));
  const observer = new MutationObserver(schedule);
  for (const el of [document.documentElement, document.body]) {
    observer.observe(el, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-color-scheme'],
    });
  }
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', schedule);

  return {
    dispose() {
      timers.forEach(clearTimeout);
      observer.disconnect();
      media.removeEventListener('change', schedule);
    },
  };
}
