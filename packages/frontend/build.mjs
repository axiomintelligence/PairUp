// esbuild entry for @pairup/frontend.
// Outputs into ../../apps/web/public/ which @pairup/web serves with
// @fastify/static. Source maps in dev; minified in prod.

import { context as createContext, build } from 'esbuild';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const OUT_DIR = resolve(ROOT, '../../apps/web/public');
const PUBLIC_FILES_DIR = resolve(ROOT, 'public');

const dev = process.argv.includes('--dev');
const watch = process.argv.includes('--watch');

const sharedOptions = {
  entryPoints: [join(ROOT, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome108', 'firefox109', 'safari16'],
  platform: 'browser',
  outfile: join(OUT_DIR, 'app.js'),
  sourcemap: dev || watch ? 'inline' : true,
  minify: !dev && !watch,
  legalComments: 'none',
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev || watch ? 'development' : 'production'),
  },
};

async function copyStatic() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = await readdir(PUBLIC_FILES_DIR);
  for (const f of files) {
    await copyFile(join(PUBLIC_FILES_DIR, f), join(OUT_DIR, f));
  }
}

async function clean() {
  await rm(OUT_DIR, { recursive: true, force: true });
}

await clean();
await copyStatic();

if (watch) {
  const ctx = await createContext(sharedOptions);
  await ctx.watch();
  console.log(`watching: ${join(ROOT, 'src/**/*')} → ${OUT_DIR}/app.js`);
} else {
  const result = await build(sharedOptions);
  console.log(`built: ${OUT_DIR}/app.js (warnings=${result.warnings.length}, errors=${result.errors.length})`);
}
