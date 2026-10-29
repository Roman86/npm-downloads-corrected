// Build the extension into dist/ (load that folder in chrome://extensions).
//   node scripts/build.ts          one-off build
//   node scripts/build.ts --watch  rebuild on change
//   node scripts/build.ts --zip    build + npm-downloads-corrected-<version>.zip
import { build, context, type BuildOptions, type Plugin } from 'esbuild';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const args = new Set(process.argv.slice(2));

// Tailwind for the panel: `import css from './panel.css'` gives the compiled
// stylesheet as a string (only the utilities used in src/). The content
// script puts it into the panel's shadow root; there is no CSS file in dist/.
// Chrome ignores @property rules that come from a shadow root's stylesheet, so
// the --tw-* variables that translate-*, shadow-* and friends compose from
// never get their initial values there. Tailwind emits a fallback for browsers
// without @property, wrapped in @supports (…); unwrap it so it applies in
// Chrome too (it is a `*` rule in the lowest layer, so utilities still win).
function unwrapPropertiesFallback(css: string): string {
  const m = /@layer properties\s*\{\s*@supports\s/.exec(css);
  if (!m) return css;
  const open = css.indexOf('{', m.index + m[0].length); // end of the @supports condition
  let depth = 0, end = open;
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    else if (css[end] === '}' && --depth === 0) break;
  }
  return `${css.slice(0, m.index)}@layer properties{${css.slice(open + 1, end)}${css.slice(end + 1)}`;
}

const tailwind: Plugin = {
  name: 'tailwind',
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async (a) => {
      const compiler = await compile(readFileSync(a.path, 'utf8'), {
        base: dirname(a.path),
        onDependency: () => {},
      });
      const scanner = new Scanner({ sources: [{ base: src, pattern: '**/*.{ts,tsx}', negated: false }] });
      const css = unwrapPropertiesFallback(optimize(compiler.build(scanner.scan()), { minify: true }).code);
      // Rebuild on any source change: that's where the class names live.
      return { contents: css, loader: 'text', watchFiles: scanner.files.concat(a.path) };
    });
  },
};

const options: BuildOptions = {
  absWorkingDir: root,
  // Each entry becomes one self-contained classic script (content scripts and
  // a non-module service worker can't use ES imports).
  entryPoints: {
    content: 'src/content.tsx',
    background: 'src/background.ts',
    options: 'src/options.ts',
    popup: 'src/popup.ts',
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome105',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [tailwind],
};

function copyStatic(): void {
  // manifest.json, options.html, popup.html, icons/ (cp: fs.cpSync fails on some mounts)
  execFileSync('cp', ['-R', `${join(root, 'static')}/.`, dist]);
}

if (args.has('--watch')) {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  copyStatic();
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching src/ … (static/ is copied once; rerun after editing it)');
} else {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  copyStatic();
  await build(options);

  if (args.has('--zip')) {
    const { version } = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8')) as { version: string };
    const zip = join(root, `npm-downloads-corrected-${version}.zip`);
    rmSync(zip, { force: true });
    execFileSync('zip', ['-qr', zip, '.'], { cwd: dist });
    console.log(`→ ${zip}`);
  }
}
