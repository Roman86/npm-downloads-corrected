// Small formatting helpers shared by the panel components.
export { compact as short } from '../lib/chart.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** "Oct 12, 2026" */
export const human = (day: string) => {
  const [y, m = 1, d] = day.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

/** "+12.3%" / "−4.0%", or '' when there is nothing to compare with. */
export const pctStr = (a: number, b: number) => {
  if (!b) return '';
  const p = ((a - b) / b) * 100;
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`;
};

export const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;

export const errorText = (err: unknown) => String((err instanceof Error && err.message) || err);

export const log = (...a: unknown[]) => console.info('[npm-downloads-corrected]', ...a);

/** Class names joined, falsy entries skipped. */
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
