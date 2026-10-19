// npm Downloads Corrected — background service worker.
//
// All network access lives here (cross-origin from npmjs.com pages):
//   - daily downloads: api.npmjs.org/downloads/range. The endpoint returns at
//     most 18 months per call, so data is fetched and cached in calendar-year
//     chunks (past years: 7 days, the current year: 6 hours — npm sometimes
//     backfills).
//   - an author's packages: registry.npmjs.org (maintainers of a package, then
//     a `maintainer:` search that already includes weekly downloads), 12 hours.
//
// Message types and response shapes: see Request / ResultOf in types.ts.
import { DEFAULTS } from './defaults.ts';
import type {
  AuthorPackage,
  AuthorPackagesRequest,
  AuthorPackagesResult,
  DayPoint,
  FetchSeriesRequest,
  FetchSeriesResult,
  Request,
  ResultOf,
} from './types.ts';

const DAY = 864e5;
const HOUR = 3600 * 1000;
const TTL_CURRENT = 6 * HOUR;
const TTL_PAST = 7 * 24 * HOUR;
const TTL_AUTHOR = 12 * HOUR;
const PRUNE_EVERY_MS = 6 * HOUR;
const NPM_EPOCH = '2015-01-10'; // earliest date the downloads API has data for
const MAX_PARALLEL = 6;
const REGISTRY = 'https://registry.npmjs.org';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const errorText = (err: unknown) => String((err instanceof Error && err.message) || err);

// ---- Storage helpers ----------------------------------------------------------

interface Cached<T> {
  t: number;
  data: T;
}
interface CachedYear extends Cached<DayPoint[]> {
  end: string;
}

async function cacheGet<T>(key: string): Promise<T | undefined> {
  return (await chrome.storage.local.get(key))[key] as T | undefined;
}

// chrome.storage.local is capped (10 MB). Download chunks are only a cache, so
// a failed write must never break the panel: on failure, drop cached download
// chunks (except the reference packages, which every page needs) and retry once.
async function cacheSet(key: string, value: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    try {
      const all = await chrome.storage.local.get(null);
      const { references } = (await chrome.storage.sync.get({ references: DEFAULTS.references })) as {
        references: string[];
      };
      const keep = new Set(references);
      const drop = Object.keys(all).filter((k) => k.startsWith('dl:') && !keep.has(k.split(':')[1] ?? ''));
      if (drop.length) await chrome.storage.local.remove(drop);
      await chrome.storage.local.set({ [key]: value });
    } catch {
      console.warn('[npm-downloads-corrected] cache write failed:', err);
    }
  }
}

async function cachedJson<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<Cached<T>>(key);
  if (hit && Date.now() - hit.t < ttl) return hit.data;
  const data = await load();
  await cacheSet(key, { t: Date.now(), data } satisfies Cached<T>);
  return data;
}

// Remove expired cache entries. Reading all of storage isn't free, so at most
// every few hours (the time is persisted: the service worker restarts often).
async function pruneCache(): Promise<void> {
  const last = (await cacheGet<number>('meta:lastPrune')) ?? 0;
  if (Date.now() - last < PRUNE_EVERY_MS) return;
  await chrome.storage.local.set({ 'meta:lastPrune': Date.now() });
  const all = (await chrome.storage.local.get(null)) as Record<string, Partial<Cached<unknown>> | undefined>;
  const now = Date.now();
  const age = (k: string) => now - (all[k]?.t ?? 0);
  const stale = Object.keys(all).filter(
    (k) =>
      (k.startsWith('dl:') && age(k) > TTL_PAST) ||
      ((k.startsWith('author:') || k.startsWith('maint:')) && age(k) > TTL_AUTHOR)
  );
  if (stale.length) await chrome.storage.local.remove(stale);
}

// ---- Downloads (api.npmjs.org) ---------------------------------------------------

// Small concurrency limiter so a 5-year view doesn't fire 36 requests at once.
let active = 0;
const queue: (() => void)[] = [];
function limited<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      active++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          active--;
          pump();
        });
    });
    pump();
  });
}
function pump(): void {
  while (active < MAX_PARALLEL && queue.length) queue.shift()!();
}

const inflight = new Map<string, Promise<DayPoint[]>>();

async function fetchYear(pkg: string, year: number, lastDay: string): Promise<DayPoint[]> {
  const currentYear = Number(lastDay.slice(0, 4));
  const s = year === 2015 ? NPM_EPOCH : `${year}-01-01`;
  const e = year === currentYear ? lastDay : `${year}-12-31`;
  const key = `dl:${pkg}:${year}`;

  const cached = await cacheGet<CachedYear>(key);
  const ttl = year === currentYear ? TTL_CURRENT : TTL_PAST;
  if (cached && Date.now() - cached.t < ttl && cached.end === e) return cached.data;

  const flightKey = `${key}:${e}`;
  const running = inflight.get(flightKey);
  if (running) return running;

  const p = limited(async () => {
    const url = `https://api.npmjs.org/downloads/range/${s}:${e}/${pkg}`;
    let res = await fetch(url);
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(url);
    }
    if (res.status === 404) return []; // package didn't exist in that period
    if (!res.ok) throw new Error(`${pkg} ${year}: HTTP ${res.status}`);
    const json = (await res.json()) as { downloads?: DayPoint[] };
    const data = (json.downloads ?? []).map((d) => ({ day: d.day, downloads: d.downloads }));
    await cacheSet(key, { t: Date.now(), end: e, data } satisfies CachedYear);
    return data;
  }).finally(() => inflight.delete(flightKey));

  inflight.set(flightKey, p);
  return p;
}

async function fetchRange(pkg: string, start: string, end: string, lastDay: string): Promise<DayPoint[]> {
  const y0 = Math.max(2015, Number(start.slice(0, 4)));
  const y1 = Number(end.slice(0, 4));
  const years: number[] = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  // Chunks always span the whole year (up to lastDay for the current one),
  // so the cache is shared between any requested windows.
  const chunks = await Promise.all(years.map((y) => fetchYear(pkg, y, lastDay)));
  return chunks.flat().filter((d) => d.day >= start && d.day <= end);
}

async function fetchSeries({ packages, start, end }: FetchSeriesRequest): Promise<FetchSeriesResult> {
  // npm stats lag by about a day; never ask beyond yesterday (UTC).
  const lastDay = iso(new Date(Date.now() - DAY));
  if (!end || end > lastDay) end = lastDay;
  if (!start || start < NPM_EPOCH) start = NPM_EPOCH;
  if (start > end) return { start, end, series: packages.map((name) => ({ name, data: [], error: null })) };

  const s = start, e = end;
  const results = await Promise.allSettled(packages.map((p) => fetchRange(p, s, e, lastDay)));
  pruneCache().catch(() => {});
  return {
    start,
    end,
    series: results.map((r, i) => ({
      name: packages[i]!,
      data: r.status === 'fulfilled' ? r.value : null,
      error: r.status === 'rejected' ? String(r.reason) : null,
    })),
  };
}

// ---- Author's other packages (registry.npmjs.org) -------------------------------

interface RegistryUser {
  name?: string;
  username?: string;
}
interface SearchResponse {
  total?: number;
  objects?: {
    package?: { name?: string; maintainers?: RegistryUser[] };
    downloads?: { weekly?: number };
  }[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

const userNames = (list: RegistryUser[] | undefined) =>
  (list ?? []).map((m) => m.name || m.username).filter((n): n is string => !!n);

// Maintainer usernames of a package. `_npmUser` (the publisher) is not used:
// with CI publishing it is "GitHub Actions", not a person.
function maintainersOf(pkg: string): Promise<string[]> {
  return cachedJson(`maint:${pkg}`, TTL_AUTHOR, async () => {
    try {
      const latest = await getJson<{ maintainers?: RegistryUser[] }>(`${REGISTRY}/${pkg.replace('/', '%2F')}/latest`);
      const names = userNames(latest.maintainers);
      if (names.length) return names;
    } catch {
      /* fall through to search */
    }
    const found = await getJson<SearchResponse>(`${REGISTRY}/-/v1/search?text=${encodeURIComponent(pkg)}&size=20`);
    const hit = (found.objects ?? []).find((o) => o.package?.name === pkg);
    return userNames(hit?.package?.maintainers);
  });
}

// Packages a user maintains, most downloaded first.
function packagesBy(user: string): Promise<{ total: number; packages: AuthorPackage[] }> {
  return cachedJson(`author:${user}`, TTL_AUTHOR, async () => {
    const res = await getJson<SearchResponse>(
      `${REGISTRY}/-/v1/search?text=maintainer:${encodeURIComponent(user)}&size=250`
    );
    const packages: AuthorPackage[] = [];
    for (const o of res.objects ?? []) {
      const name = o.package?.name;
      if (!name) continue;
      const weekly = o.downloads?.weekly;
      packages.push({ name, weekly: typeof weekly === 'number' && Number.isFinite(weekly) ? weekly : null });
    }
    packages.sort((a, b) => (b.weekly ?? 0) - (a.weekly ?? 0));
    return { total: res.total || packages.length, packages };
  });
}

async function authorPackages({ pkg, user }: AuthorPackagesRequest): Promise<AuthorPackagesResult> {
  const maintainers = await maintainersOf(pkg);
  const who = user && maintainers.includes(user) ? user : maintainers[0];
  if (!who) return { maintainers, user: null, packages: [], total: 0 };
  const { total, packages } = await packagesBy(who);
  return { maintainers, user: who, total, packages };
}

// ---- Messages ---------------------------------------------------------------------

type Handlers = { [K in Request['type']]: (msg: Extract<Request, { type: K }>) => Promise<ResultOf[K]> };
const HANDLERS: Handlers = { fetchSeries, authorPackages };

function dispatch(msg: Request): Promise<ResultOf[Request['type']]> {
  switch (msg.type) {
    case 'fetchSeries':
      return HANDLERS.fetchSeries(msg);
    case 'authorPackages':
      return HANDLERS.authorPackages(msg);
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  const type = (msg as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !(type in HANDLERS)) return false;
  dispatch(msg as Request)
    .then((data) => sendResponse({ ok: true, ...data }))
    .catch((err: unknown) => sendResponse({ ok: false, error: errorText(err) }));
  return true; // async response
});
