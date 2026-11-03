// Bundle size budget: the blank new-game template (templates/game), built for production, must stay under a loose gzip ceiling for its JS.
// Why: every game starts from this build, so an engine import that drags a big dependency into core (or a module that stops tree-shaking) shows here
// first, long before a game notices a slow first load. The ceiling is the size measured when it was set plus ~25%; raise it only for a growth you meant.
// On failure the detail lists the largest source modules of the build (rendered bytes, before gzip), so what grew is visible without another tool.
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ROOT, rel, viteOptions } from '../paths.mjs';
import { copyTemplates } from '../lib/scaffold.mjs';

/** gzip KB of all JS in dist/assets, lazy chunks included (navmesh wasm, draco decoder): 899 KB measured 2026-11-02, + 25% */
const CEILING_KB = 1125;

export const name = 'bundle size: the blank game template builds and its JS stays under the gzip ceiling';

export async function run({ check }) {
  // inside the repo's .threedog so `threedog` and `@threedog/tools/vite` resolve through the root node_modules, as in a real game workspace
  const dir = join(ROOT, '.threedog', 'bundle-size');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    copyTemplates(dir, { name: 'sizecheck' });
    const { build } = await import('vite');
    const res = await build(await viteOptions(dir, { logLevel: 'error' }));
    const outputs = [res].flat().flatMap(r => r.output ?? []);
    const assets = join(dir, 'dist', 'assets'), js = readdirSync(assets).filter(f => f.endsWith('.js'));
    const sizes = js.map(f => ({ f, kb: gzipSync(readFileSync(join(assets, f))).length / 1024 })).sort((a, b) => b.kb - a.kb);
    const total = Math.round(sizes.reduce((s, x) => s + x.kb, 0));
    // first load = the entry chunk plus what it imports statically (lazy chunks load only when a game uses navmesh, draco ...)
    const chunks = new Map(outputs.filter(o => o.type === 'chunk').map(o => [o.fileName, o])), first = new Set();
    const walk = f => { if (first.has(f) || !chunks.has(f)) return; first.add(f); chunks.get(f).imports.forEach(walk); };
    for (const o of chunks.values()) if (o.isEntry) walk(o.fileName);
    const firstKb = Math.round(sizes.filter(x => first.has('assets/' + x.f)).reduce((s, x) => s + x.kb, 0));
    // the source modules with the most rendered code, grouped to a package or engine folder (three/examples/jsm, threedog/core, ...)
    const by = new Map();
    for (const o of outputs) for (const [id, m] of Object.entries(o.modules ?? {})) {
      const p = id.replace(/\\/g, '/'), k = p.match(/node_modules\/((?:@[^/]+\/)?[^/]+(?:\/[^/]+)?)/)?.[1] ?? p.match(/packages\/(.+?\/[^/]+)\//)?.[1] ?? p.split('/').slice(-2).join('/');
      by.set(k, (by.get(k) ?? 0) + m.renderedLength);
    }
    const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, b]) => `${k} ${Math.round(b / 1024)} KB`).join(', ');
    check(`template JS: ${total} KB gzip in ${js.length} file(s), first load ${firstKb} KB (ceiling ${CEILING_KB} KB on the total)`, total <= CEILING_KB,
      `largest chunks: ${sizes.slice(0, 4).map(x => `${x.f} ${Math.round(x.kb)} KB`).join(', ')}; largest sources (rendered, before gzip): ${top}. ` +
      `Look at what an import added (git diff of index.js / core imports); raise CEILING_KB in ${rel(join(import.meta.dirname, 'bundle-size.mjs'))} only for a growth you meant`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
