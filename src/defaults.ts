import type { CorrectionSettings } from './types.ts';

// Shared defaults for the content script, options page and background worker.
// References: packages with tens/hundreds of millions of weekly downloads,
// pulled in transitively by almost everything, so their curve is very smooth.
export const DEFAULTS: CorrectionSettings = {
  references: ['semver', 'debug', 'ms', 'chalk', 'tslib'],
  baselineWeeks: 4,
  tolerance: 0.1,
  minRatio: 0.15,
  minRefs: 2,
};
