/**
 * Bundles and runs every test file in tests/.
 *
 * Dependency-free on purpose: the project has no test framework and this task did
 * not add one. Each test file is plain TypeScript with its own assertions, bundled
 * by the esbuild that already ships with Vite and run as a child process, so a
 * failure in one file is reported without stopping the others.
 *
 * A child process per file rather than an import, because the test files call
 * process.exit and an import would take the runner down with them.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const outdir = join(root, 'node_modules', '.cache', 'chord-crush-tests');
const files = readdirSync(join(root, 'tests'))
  .filter((name) => name.endsWith('.test.ts'))
  .sort();

if (files.length === 0) {
  console.log('no test files found');
  process.exit(1);
}

await build({
  entryPoints: files.map((name) => join(root, 'tests', name)),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir,
  outExtension: { '.js': '.cjs' },
  logLevel: 'warning',
});

let failed = 0;

for (const name of files) {
  const output = join(outdir, name.replace(/\.ts$/, '.cjs'));
  const result = spawnSync(process.execPath, [output], { stdio: 'inherit' });

  if (result.status !== 0) failed++;
}

process.exit(failed === 0 ? 0 : 1);
