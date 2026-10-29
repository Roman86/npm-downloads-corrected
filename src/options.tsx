// Options page (Preact + signals). The draft is edited locally and written to
// chrome.storage.sync on Save; every field shows whether it differs from the
// saved value ("unsaved") and from the default (a "Reset to …" button), and
// Save is disabled while anything is invalid.
import { computed, signal } from '@preact/signals';
import { render } from 'preact';
import type { JSX } from 'preact';
import { DEFAULTS } from './defaults.ts';
import type { CorrectionSettings } from './types.ts';

type Draft = {
  references: string; // raw textarea text
  baselineWeeks: number;
  tolerance: number;
  minRatio: number;
  minRefs: number;
};
type NumericKey = Exclude<keyof Draft, 'references'>;

const LIMITS: Record<NumericKey, { min: number; max: number; step: number }> = {
  baselineWeeks: { min: 1, max: 12, step: 1 },
  tolerance: { min: 0.01, max: 0.5, step: 0.01 },
  minRatio: { min: 0.01, max: 0.9, step: 0.01 },
  minRefs: { min: 1, max: 50, step: 1 },
};

// npm package names: lowercase, URL-safe, optional @scope/.
const NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function toDraft(s: CorrectionSettings): Draft {
  return { ...s, references: s.references.join(', ') };
}
function parseRefs(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
}
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}
const pct = (x: number) => `${Math.round(x * 100)}%`;

const saved = signal<CorrectionSettings>(DEFAULTS);
const draft = signal<Draft>(toDraft(DEFAULTS));
const status = signal('');
const loaded = signal(false);

const refs = computed(() => parseRefs(draft.value.references));

type Errors = Partial<Record<keyof Draft, string>>;
const errors = computed<Errors>(() => {
  const d = draft.value;
  const e: Errors = {};
  const bad = refs.value.filter((r) => !NAME.test(r));
  if (!refs.value.length) e.references = 'At least one reference package is needed.';
  else if (bad.length) e.references = `Not a valid package name: ${bad.join(', ')}`;
  for (const k of Object.keys(LIMITS) as NumericKey[]) {
    const { min, max, step } = LIMITS[k];
    const v = d[k];
    if (!Number.isFinite(v) || v < min - 1e-9 || v > max + 1e-9) e[k] = `Must be between ${fmt(k, min)} and ${fmt(k, max)}.`;
    else if (step === 1 && !Number.isInteger(v)) e[k] = 'Must be a whole number.';
  }
  if (!e.tolerance && !e.minRatio && d.minRatio >= 1 - d.tolerance)
    e.minRatio = `Must be below 100% − outage threshold = ${pct(1 - d.tolerance)}.`;
  if (!e.minRefs && !e.references && d.minRefs > refs.value.length)
    e.minRefs = `Only ${refs.value.length} reference package${refs.value.length === 1 ? ' is' : 's are'} listed.`;
  return e;
});
const valid = computed(() => Object.keys(errors.value).length === 0);

function fmt(k: NumericKey, v: number): string {
  return k === 'tolerance' || k === 'minRatio' ? pct(v) : String(v);
}
function same(k: keyof Draft, a: Draft, b: CorrectionSettings): boolean {
  if (k === 'references') return parseRefs(a.references).join(',') === b.references.join(',');
  return near(a[k], b[k]);
}
const dirty = computed(() => (Object.keys(DEFAULTS) as (keyof Draft)[]).some((k) => !same(k, draft.value, saved.value)));
const customized = computed(() => (Object.keys(DEFAULTS) as (keyof Draft)[]).some((k) => !same(k, draft.value, DEFAULTS)));

function set<K extends keyof Draft>(k: K, v: Draft[K]): void {
  draft.value = { ...draft.value, [k]: v };
  status.value = '';
}
function toSettings(d: Draft): CorrectionSettings {
  return {
    references: parseRefs(d.references),
    baselineWeeks: d.baselineWeeks,
    tolerance: d.tolerance,
    minRatio: d.minRatio,
    minRefs: d.minRefs,
  };
}
function save(): void {
  if (!valid.value) return;
  const out = toSettings(draft.value);
  chrome.storage.sync.set(out, () => {
    saved.value = out;
    draft.value = toDraft(out);
    status.value = 'Saved. Reload the npm page to apply.';
  });
}

chrome.storage.sync.get(DEFAULTS, (stored) => {
  const s = { ...DEFAULTS, ...(stored as Partial<CorrectionSettings>) };
  saved.value = s;
  draft.value = toDraft(s);
  loaded.value = true;
});

// Label row: name, "unsaved" marker when the draft differs from what is stored,
// "Reset to <default>" when it differs from the default.
function Head({ k, label, text }: { k: keyof Draft; label: string; text: string }) {
  const unsaved = !same(k, draft.value, saved.value);
  const isDefault = same(k, draft.value, DEFAULTS);
  return (
    <div class="head">
      <label for={k}>{label}</label>
      <span class="meta">
        {unsaved && <span class="unsaved">unsaved</span>}
        {!isDefault && (
          <button type="button" class="link" onClick={() => set(k, toDraft(DEFAULTS)[k])} title="Reset to default">
            ↺ Reset to {text}
          </button>
        )}
      </span>
    </div>
  );
}

function Problem({ k }: { k: keyof Draft }) {
  const e = errors.value[k];
  return e ? <div class="error">{e}</div> : null;
}

function Slider({ k, label, hint, format }: { k: NumericKey; label: string; hint: (v: number) => JSX.Element; format: (v: number) => string }) {
  const { min, max, step } = LIMITS[k];
  const v = draft.value[k];
  return (
    <div class={`field${errors.value[k] ? ' invalid' : ''}`}>
      <Head k={k} label={label} text={format(DEFAULTS[k])} />
      <div class="slider">
        <input
          id={k}
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, v))}
          onInput={(e) => set(k, Number((e.currentTarget as HTMLInputElement).value))}
        />
        <output for={k}>{format(v)}</output>
      </div>
      <Problem k={k} />
      <p class="hint">{hint(v)}</p>
    </div>
  );
}

function App() {
  const d = draft.value;
  const n = refs.value.length;
  const refOptions = Array.from({ length: Math.max(n, d.minRefs, 1) }, (_, i) => i + 1);
  return (
    <main class={loaded.value ? '' : 'loading'}>
      <div class={`field${errors.value.references ? ' invalid' : ''}`}>
        <Head k="references" label="Reference packages" text="defaults" />
        <textarea
          id="references"
          rows={3}
          spellcheck={false}
          value={d.references}
          onInput={(e) => set('references', (e.currentTarget as HTMLTextAreaElement).value)}
        />
        <Problem k="references" />
        <p class="hint">
          Comma-separated. Huge packages installed transitively almost everywhere; more references make the estimate more
          robust. <b>{n}</b> listed.
        </p>
      </div>

      <Slider
        k="baselineWeeks"
        label="Baseline window"
        format={(v) => `±${v} weeks`}
        hint={(v) => (
          <>
            A day's usual level is the median of the same weekday over the <b>{v}</b> weeks before and after it. Outage
            days are skipped; the window widens when too few remain.
          </>
        )}
      />

      <Slider
        k="tolerance"
        label="Outage threshold"
        format={pct}
        hint={(v) => (
          <>
            A day counts as damaged when the references are more than <b>{pct(v)}</b> below their usual level. The
            package's number is then scaled up by the same share.
          </>
        )}
      />

      <Slider
        k="minRatio"
        label="Full-outage level"
        format={pct}
        hint={(v) => (
          <>
            When the references fall below <b>{pct(v)}</b> of their usual level, scaling is unreliable: the day is filled
            with the package's own usual level for that weekday instead.
          </>
        )}
      />

      <div class={`field${errors.value.minRefs ? ' invalid' : ''}`}>
        <Head k="minRefs" label="References required per day" text={String(DEFAULTS.minRefs)} />
        <select id="minRefs" value={d.minRefs} onChange={(e) => set('minRefs', Number((e.currentTarget as HTMLSelectElement).value))}>
          {refOptions.map((i) => (
            <option value={i}>{i === 1 ? '1 reference' : `${i} references`}</option>
          ))}
        </select>
        <Problem k="minRefs" />
        <p class="hint">Days where fewer references have data are left as npm reports them.</p>
      </div>

      <div class="actions">
        <button type="button" class="primary" disabled={!dirty.value || !valid.value} onClick={save}>
          Save
        </button>
        {dirty.value && (
          <button type="button" class="link" onClick={() => { draft.value = toDraft(saved.value); status.value = ''; }}>
            Discard changes
          </button>
        )}
        {customized.value && (
          <button type="button" class="link" onClick={() => { draft.value = toDraft(DEFAULTS); status.value = ''; }}>
            Reset all to defaults
          </button>
        )}
        <span class="status">{status.value}</span>
      </div>
    </main>
  );
}

render(<App />, document.getElementById('app')!);
