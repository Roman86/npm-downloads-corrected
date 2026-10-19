// Build the extension into dist/ (load that folder in chrome://extensions).
//   node scripts/build.ts          one-off build
//   node scripts/build.ts --watch  rebuild on change
//   node scripts/build.ts --zip    build + npm-downloads-corrected-<version>.zip
import { build, context, type BuildOptions } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const args = new Set(process.argv.slice(2));

const options: BuildOptions = {
  absWorkingDir: root,
  // Each entry becomes one self-contained classic script (content scripts and
  // a non-module service worker can't use ES imports).
  entryPoints: {
    content: 'src/content.ts',
    background: 'src/background.ts',
    options: 'src/options.ts',
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome105',
  legalComments: 'none',
  logLevel: 'info',
};

function copyStatic(): void {
  // manifest.json, options.html, icons/
  cpSync(join(root, 'static'), dist, { recursive: true });
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
