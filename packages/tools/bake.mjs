// Bake: npm run bake [-- name …]
// Exports code-generated models (the bake list in this workspace's bake.js files) to this workspace's public/models/baked/<name>.glb and writes the manifest index.json.
// A built game reads these files directly (fast); in development engine.assets notices changed generator code and computes on the fly with a hint, so no need to bake every time.
// When you need to run it:
//   · before building for release (npm run build reports an error if a baked file is out of date)
//   · to take a generated model into Blender: after baking, write that entry in the bake list as { build, source: 'file' }, and the file is no longer overwritten
// Incremental: entries whose hash (generator source + parameters + contents of the file it lives in and the files it imports) did not change are not re-baked. Files for names removed from the list are deleted.
//
//   npm run bake                 bake what changed
//   npm run bake -- city-block   bake only this one (several allowed)
//   npm run bake -- --force      re-bake everything
//   npm run bake -- -w my-game  bake a game's (default: the workspace of the current directory, then the engine package)
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { keyMaker, staleBaked } from './vite/vite-threedog-cache.js';
import { cli, rel, TOOLS, viteOptions } from './paths.mjs';

const t0 = Date.now();
const { dir: ROOT, opt, rest: only } = cli(process.argv.slice(2), { flags: ['force', 'gpu', 'software'], positional: true });   // ROOT = the workspace to bake
const DIR = resolve(ROOT, 'public/models/baked'), INDEX = resolve(DIR, 'index.json');
const force = !!opt.force;
const kb = n => (n / 1024).toFixed(1) + ' KB';

const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
// If nothing changed (manifest files and the files they import are identical, baked files are all there), no browser is needed
const keyOf = keyMaker(ROOT), SIG = resolve(ROOT, '.threedog/bake-sig');
const sig = keyOf.filesHash(keyOf.bakeLists()) + ':' + Object.keys(index).sort().join(',');
if (!force && !only.length && existsSync(SIG) && readFileSync(SIG, 'utf8') === sig && !staleBaked(ROOT, index, keyOf).length) {
  console.log(`Nothing changed, no re-bake needed (${Object.keys(index).length} total, took ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(0);
}
const withExists = Object.fromEntries(Object.entries(index).map(([k, v]) => [k, { ...v, exists: !force && existsSync(resolve(DIR, v.file)) }]));

const [{ createServer }, { launchBrowser }] = await Promise.all([import('vite'), import('./browser.mjs')]);   // loaded only when there is something to bake
// Use its own dependency cache directory: do not fight with a running npm run dev over node_modules/.vite
const server = await createServer(await viteOptions(ROOT, { logLevel: 'error', cacheDir: resolve(ROOT, '.threedog/vite-bake'), server: { port: 0, strictPort: false } }));
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await launchBrowser();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
let results = [];
// The first time vite meets a new dependency it re-optimizes and reloads the page, and a dynamic import may fail: retry
for (let i = 0; i < 3 && !results.length; i++) {
  try {
    await page.goto(base + '/@fs' + TOOLS.replace(/\\/g, '/').replace(/^(?!\/)/, '/') + '/bake.html');   // a page in the tools package, opened through vite's /@fs/
    await page.waitForFunction(() => window.threedogBakeReady, null, { timeout: 60000 });
    results = await page.evaluate(a => window.threedogBake(a), { only, index: withExists });
    errors.length = 0;
  } catch (e) { errors.push(String(e).split('\n')[0]); }
}
await browser.close();
await server.close();
if (errors.length) { console.log('Bake page error:\n  ' + errors.join('\n  ')); process.exit(1); }

mkdirSync(DIR, { recursive: true });
const seen = new Set(results.map(r => r.name));
let baked = 0, bytes = 0;
for (const r of results) {
  if (r.status !== 'baked') {
    if (r.status === 'file') index[r.name].source = 'file';
    const why = { same: 'unchanged', file: 'file wins (source: file)', skip: '' }[r.status];
    if (why) console.log(`  ${why}  ${r.name}`);
    continue;
  }
  const buf = Buffer.from(r.data, 'base64'), file = r.name.replace(/[^\w.-]+/g, '_') + '.glb';
  writeFileSync(resolve(DIR, file), buf);
  index[r.name] = { file, key: r.key, src: r.src, params: r.params, from: r.from, bytes: buf.length, ...(r.source === 'file' ? { source: 'file' } : {}) };
  baked++; bytes += buf.length;
  console.log(`✓ ${r.name}  ${kb(buf.length)} (generated in ${r.ms} ms, from ${r.from})`);
}
for (const name of Object.keys(index)) if (!seen.has(name)) {   // no longer in the list
  // file comes from the committed index.json: only delete plain file names inside baked/ (a hand-edited "../x" must not delete outside it)
  const f = index[name].file;
  if (typeof f === 'string' && basename(f) === f && existsSync(resolve(DIR, f))) unlinkSync(resolve(DIR, f));
  console.log(`  deleted  ${name} (no longer in the list)`);
  delete index[name];
}
writeFileSync(INDEX, JSON.stringify(index, null, 1));
mkdirSync(dirname(SIG), { recursive: true });
writeFileSync(SIG, keyOf.filesHash(keyOf.bakeLists()) + ':' + Object.keys(index).sort().join(','));
console.log(`\n${rel(ROOT)}: baked ${baked} (${kb(bytes)}), ${Object.keys(index).length} total, took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(0);
