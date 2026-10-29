// Shared types: data shapes and the messages between content script and
// background worker.

/** One day as returned by api.npmjs.org/downloads/range. */
export interface DayPoint {
  day: string; // YYYY-MM-DD
  downloads: number;
}

export type Method = 'none' | 'scaled' | 'baseline' | 'gap';

/** correctSeries() output. */
export interface CorrectedDay {
  day: string;
  raw: number;
  corrected: number;
  ratio: number;
  method: Method;
  /** Holiday season: everyone's traffic really drops, so partial dips aren't corrected. */
  holiday: boolean;
}

/** A displayed point: a day (start === end) or a 7-day bucket. */
export interface Point {
  start: string;
  end: string;
  raw: number;
  corrected: number;
  fixedDays: number;
  gapDays: number;
  holidayDays: number; // holiday-season days left uncorrected (real dip)
}

// Type aliases (not interfaces) so they're assignable to chrome.storage's
// index-signature parameter types.
export type CorrectionSettings = {
  references: string[];
  baselineWeeks: number;
  tolerance: number;
  minRatio: number;
  minRefs: number;
};

export type RangeId = '1w' | '1m' | '3m' | '1y' | '2y' | '5y';

export type Settings = CorrectionSettings & { range: RangeId };

export interface RecentState {
  recent: string[];
  starred: string[];
}

export interface AuthorPackage {
  name: string;
  weekly: number | null;
}

// ---- messages (content script → background) ----

export interface FetchSeriesRequest {
  type: 'fetchSeries';
  packages: string[];
  start: string;
  end: string;
}
export interface SeriesResult {
  name: string;
  data: DayPoint[] | null; // null when the request failed
  error: string | null;
}
export interface FetchSeriesResult {
  start: string; // clamped to npm's epoch
  end: string; // clamped to yesterday (UTC)
  series: SeriesResult[];
}

export interface AuthorPackagesRequest {
  type: 'authorPackages';
  pkg: string;
  user?: string | null | undefined;
}
export interface AuthorPackagesResult {
  maintainers: string[];
  user: string | null;
  total: number;
  packages: AuthorPackage[];
}

/** Open the extension's options page (content scripts can't call openOptionsPage themselves). */
export interface OpenOptionsRequest {
  type: 'openOptions';
}

export type Request = FetchSeriesRequest | AuthorPackagesRequest | OpenOptionsRequest;

export interface ResultOf {
  fetchSeries: FetchSeriesResult;
  authorPackages: AuthorPackagesResult;
  openOptions: Record<string, never>;
}

export type Response<T> = ({ ok: true } & T) | { ok: false; error: string };
