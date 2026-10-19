/*
 * Recent / starred packages (pure logic, testable in Node).
 *
 * State: { recent: [name…] (most recent first, never starred ones),
 *          starred: [name…] (in the order they were starred) }
 * Shown list: all starred first, then recent — MAX_TOTAL rows in total, but
 * always at least MIN_RECENT recent ones even with many starred.
 */
import type { RecentState } from '../types.ts';

export const MAX_TOTAL = 10;
export const MIN_RECENT = 3;

export interface RecentItem {
  name: string;
  starred: boolean;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string') : []);

/** Normalizes whatever came out of storage. */
export function clean(s: unknown): RecentState {
  const o = (s && typeof s === 'object' ? s : {}) as Partial<Record<keyof RecentState, unknown>>;
  return { recent: strings(o.recent), starred: strings(o.starred) };
}

/** Record a visit: the package moves to the top of the recent part. */
export function visit(state: unknown, name: string): RecentState {
  const s = clean(state);
  if (s.starred.includes(name)) return s;
  s.recent = [name, ...s.recent.filter((n) => n !== name && !s.starred.includes(n))].slice(0, MAX_TOTAL);
  return s;
}

/** Star / unstar (no limit on starred). */
export function toggleStar(state: unknown, name: string): { state: RecentState; starred: boolean } {
  const s = clean(state);
  if (s.starred.includes(name)) {
    s.starred = s.starred.filter((n) => n !== name);
    s.recent = [name, ...s.recent.filter((n) => n !== name)].slice(0, MAX_TOTAL);
    return { state: s, starred: false };
  }
  s.starred = [...s.starred, name];
  s.recent = s.recent.filter((n) => n !== name);
  return { state: s, starred: true };
}

/** What the dropdown shows, in order. */
export function list(state: unknown): RecentItem[] {
  const s = clean(state);
  const rest = s.recent.filter((n) => !s.starred.includes(n));
  return [
    ...s.starred.map((name) => ({ name, starred: true })),
    ...rest.map((name) => ({ name, starred: false })),
  ].slice(0, s.starred.length + Math.max(MIN_RECENT, MAX_TOTAL - s.starred.length));
}
