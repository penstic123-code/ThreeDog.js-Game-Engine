// Bake light: threedog bake light [-w game] [--out public/light/level.lightmap] [--size 1024] [--spacing 2] [--samples 16] [--page /index.html]
// Opens the game in a browser with a real GPU, bakes a lightmap of the meshes marked userData.static = true (light-bake-page.js) and writes one file for
// engine.loadLightmap: the map in half precision and the second UV set.
// Why system Chrome and not the repo's Chromium: three's LightMapper needs real WebGPU, and Playwright's Chromium has no dxil.dll, so it compiles through FXC, which fails
// on some of three's shaders with only a console error. Why this stops instead of falling back: a software bake takes minutes and proves nothing about the GPU path.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { cli, rel, TOOLS, viteOptions } from './paths.mjs';

const { dir: ROOT, opt } = cli(process.argv.slice(2), { values: ['out', 'size', 'spacing', 'samples', 'page'], positional: true });
const size = Number(opt.size ?? 1024), samples = Number(opt.samples ?? 16), spacing = opt.spacing === undefined ? undefined : Number(opt.spacing);
if (!Number.isInteger(Math.log2(size)) || size < 64 || size > 4096) { console.error(`✗ --size ${opt.size}: use a power of two from 64 to 4096`); process.exit(1); }
if (spacing !== undefined && !(spacing > 0)) { console.error(`✗ --spacing ${opt.spacing}: use a positive number of meters`); process.exit(1); }
const OUT = resolve(ROOT, opt.out ?? 'public/light/level.lightmap');

const [{ createServer }, { launchRealGPU }, { waitEngine }] = await Promise.all([import('vite'), import('./browser.mjs'), import('./wait-engine.mjs')]);
const server = await createServer(await viteOptions(ROOT, { logLevel: 'error', cacheDir: resolve(ROOT, '.threedog/vite-bake'), server: { port: 0, strictPort: false, fs: { strict: false } } }));
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');
let code = 0, browser;
try {
  browser = await launchRealGPU();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } }), errors = [];
  page.on('pageerror', x => errors.push(String(x)));
  // the first time vite meets three/webgpu it re-optimizes and reloads the page, which throws away the injected script: try again
  for (let i = 0; ; i++) {
    try {
      await page.goto(base + (opt.page ?? '/'));
      await waitEngine(page, { errors });
      await page.addScriptTag({ type: 'module', url: base + '/@fs' + TOOLS.replace(/\\/g, '/').replace(/^(?!\/)/, '/') + '/light-bake-page.js' });
      await page.waitForFunction(() => window.threedogBakeLightReady, null, { timeout: 60000 });
      break;
    } catch (e) { if (i === 2) throw e; }
  }
  const r = await page.evaluate(a => window.threedogBakeLight(a), { size, samples, spacing });
  if (r.gpu) console.log(`GPU: ${r.gpu}, backend ${r.backend}, browser ${browser.version()}`);
  if (r.error) { console.error('✗ ' + r.error); code = 1; } else {
    const table = Buffer.from(JSON.stringify(r.meta)), head = Buffer.alloc(8);
    head.writeUInt32LE(0x4d4c4454, 0); head.writeUInt32LE(table.length, 4);
    const pad = Buffer.alloc(((8 + table.length + 7) & ~7) - 8 - table.length);   // engine.loadLightmap reads aligned views
    const file = Buffer.concat([head, table, pad, Buffer.from(r.texture, 'base64'), Buffer.from(r.lists, 'base64')]);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, file);
    console.log(`✓ ${rel(OUT)}  ${(file.length / 1048576).toFixed(1)} MB, ${r.meta.meshes.length} mesh(es), ${size} map, probes ${r.probes.join('x')}, ${r.ms} ms`);
    for (const s of r.meta.skipped) console.log(`  skipped ${s.name}: ${s.why}`);
    if (r.warnings.excludedFaces) console.log(`  ${r.warnings.excludedFaces} face(s) too thin to unwrap`);
    console.log('  In the game: await engine.loadLightmap(path), and turn down the ambient light the bake saw (recipes/34-environment-lighting.md)');
  }
} catch (e) { console.error('✗ ' + String(e?.message ?? e).split('\n')[0]); code = 1; }
await browser?.close();
await server.close();
process.exit(code);
