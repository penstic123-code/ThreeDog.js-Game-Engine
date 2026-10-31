// vite preset: each workspace's (engine package, each game) vite.config.js is a single line:
//   import { gameConfig } from '@threedog/tools/vite';
//   export default gameConfig(import.meta.dirname);
// What it does:
//   · multi-page entry: collects the *.html in the directory automatically (index.html → main, the rest by file name), so a new page needs no manual input
//   · when running tests (THREEDOG_TEST, set by npm test / npm run shot / npm run perf) it also adds the tests/<name>/index.html test pages
//   · cache directory .threedog/vite; errorRelay: during development sends browser errors to the terminal and this directory's .threedog/errors.log; threedogBridge: the dev bridge (npx threedog describe|step|press…, dev only); threedogCache: automatic cache for generated models and the stale-bake check (.threedog/cache)
//   · turns on import.meta.env.THREEDOG_TEST (test builds also enable the development-time checks), and Workers as ES modules
// extra is shallow-merged into the returned config (add plugins and the like when needed).
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import errorRelay from './vite-error-relay.js';
import threedogBridge from './vite-threedog-bridge.js';
import threedogCache from './vite-threedog-cache.js';

/** The pages a directory builds: { entry name: absolute html path } */
function pagesOf(dir, { test = !!process.env.THREEDOG_TEST } = {}) {
  const input = {};
  for (const f of readdirSync(dir).filter(f => f.endsWith('.html')).sort()) input[f === 'index.html' ? 'main' : f.slice(0, -5)] = resolve(dir, f);
  const tests = resolve(dir, 'tests');
  if (test && existsSync(tests)) for (const d of readdirSync(tests, { withFileTypes: true })) {
    const html = resolve(tests, d.name, 'index.html');
    if (d.isDirectory() && existsSync(html)) input['test-' + d.name] = html;
  }
  return input;
}

export function gameConfig(dir, extra = {}) {
  return defineConfig({
    root: dir,
    cacheDir: resolve(dir, '.threedog/vite'),   // the dependency pre-bundle cache also goes in this workspace's .threedog/ (no node_modules is created in the game directory)
    plugins: [errorRelay(), threedogBridge(), threedogCache()],
    define: { 'import.meta.env.THREEDOG_TEST': JSON.stringify(!!process.env.THREEDOG_TEST) },
    worker: { format: 'es' },
    build: { target: 'es2022', chunkSizeWarningLimit: 2000, outDir: resolve(dir, 'dist'), emptyOutDir: true, rollupOptions: { input: pagesOf(dir) } },
    ...extra,
  });
}

export default gameConfig;
