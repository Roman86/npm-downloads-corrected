import { DEFAULTS } from './defaults.ts';
import type { CorrectionSettings } from './types.ts';

const NUMERIC = ['baselineWeeks', 'tolerance', 'minRatio', 'minRefs'] as const;

function input(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error(`#${id} missing`);
  return el as HTMLInputElement;
}
const status = document.getElementById('status')!;

chrome.storage.sync.get(DEFAULTS, (stored) => {
  const s = stored as unknown as CorrectionSettings;
  input('references').value = s.references.join(', ');
  for (const k of NUMERIC) input(k).value = String(s[k]);
});

document.getElementById('save')!.addEventListener('click', () => {
  const refs = input('references').value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const out: CorrectionSettings = { ...DEFAULTS, references: refs.length ? refs : DEFAULTS.references };
  for (const k of NUMERIC) {
    const v = parseFloat(input(k).value);
    out[k] = Number.isFinite(v) ? v : DEFAULTS[k];
  }
  chrome.storage.sync.set(out, () => {
    status.textContent = 'Saved. Data is cached for 6 hours.';
    setTimeout(() => (status.textContent = ''), 2500);
  });
});
