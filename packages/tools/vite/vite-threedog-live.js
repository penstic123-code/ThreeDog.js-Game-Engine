// Live dev tuning (dev server only): shader hot reload, and the endpoint the dev panel's "write back" button saves to.
//
// Shader hot reload: `import frag from './water.frag?raw'` of a .glsl / .vert / .frag / .vs / .fs file is served as its text wrapped in
// `// threedog:begin file=<path>` ... `// threedog:end` (comments: the shader compiles the same), and the module accepts its own updates: on save it
// calls engine.debug.reloadGlsl(oldText, newText, file) in the page, which recompiles the materials using that text (render/hotGlsl.js) without a
// page reload. When no material uses it (the text was copied into an onBeforeCompile closure, or the engine is not on window.engine) the page reloads.
// A compile error then names the file and line (render/shaderErrors.js reads the markers). Production builds get vite's plain ?raw text (no markers).
// Plain Vite equivalent: import.meta.hot.accept('./water.frag?raw', m => { mat.fragmentShader = m.default; mat.needsUpdate = true; }).
//
// Tune write-back: POST /__threedog/tune { values, css, materials, models } (local requests only) saves <root>/.threedog/tune.json; then
// `threedog tune write <file>` prints the change as a diff and `--apply` writes it (packages/tools/tune.mjs). Nothing is written to code from here.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { relative, join } from 'node:path';
import { isLocalRequest, readBody } from './local.js';

const GLSL = /\.(glsl|vert|frag|vs|fs)$/;
const GALLERY_BOOT = 'virtual:threedog/gallery-boot';

/** @returns {import('vite').Plugin} */
export default function threedogLive() {
  let root = process.cwd();
  return {
    name: 'threedog-live',
    apply: 'serve',
    enforce: 'pre',
    configResolved(c) { root = c.root; },
    configureServer(server) {
      server.middlewares.use('/__threedog/tune', async (req, res) => {
        if (req.method !== 'POST' || !isLocalRequest(req, { sameOrigin: true })) { res.statusCode = 403; return res.end(); }
        try {
          const body = JSON.parse(await readBody(req, 256 * 1024)), dir = join(root, '.threedog');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, 'tune.json'), JSON.stringify(body, null, 1));
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, file: '.threedog/tune.json', next: 'threedog tune write <file> (dry run), then add --apply' }));
        } catch (err) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: String(err) })); }
      });
    },
    // Asset hot swap: the game's assets.js (its asset packs, <root>/assets.js) accepts its own updates. Saving an art module it imports (art/tree.js)
    // re-runs that module and assets.js only (Vite's HMR chain), so only those generators are new functions; engine.debug.reloadAssets(new packs)
    // rebuilds them and swaps every live copy in place (core/assets/assetHot.js). Why this file: it is the one place a game registers its models, so
    // no game code has to opt in. A file the game's main.js also imports directly has another chain to the root: Vite reloads the page then.
    transform(code, id) {
      if (id.split('?')[0].replaceAll('\\', '/') !== join(root, 'assets.js').replaceAll('\\', '/')) return null;
      return code + `
if (import.meta.hot) import.meta.hot.accept(m => {
  const e = globalThis.engine;
  if (!m || !e?.debug?.reloadAssets) return import.meta.hot.invalidate('assets.js changed and no engine is on window.engine: reloading the page');
  e.debug.reloadAssets(m.default).catch(err => { console.error('[threedog] asset hot swap failed', err); import.meta.hot.invalidate('asset hot swap failed: reloading the page'); });
});`;
    },
    // Asset gallery (dev): ?gallery=1 opens @threedog/tools/gallery over the running game (every registered model on a turntable under three
    // neutral light setups); `threedog gallery --shots` uses the same page headless. Injected here so a game needs no code for it.
    // (a virtual module, not inline code: an injected inline script is not run through import resolution, so its bare import would not resolve)
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: '/@id/' + GALLERY_BOOT }, injectTo: 'body' }];
    },
    resolveId(id) { return id === GALLERY_BOOT ? '\0' + GALLERY_BOOT : null; },
    load(id) {
      if (id === '\0' + GALLERY_BOOT) return `if (/[?&]gallery\\b/.test(location.search)) import('@threedog/tools/gallery').then(m => m.openWhenReady());`;
      const [file, query] = id.split('?');
      if (query !== 'raw' || !GLSL.test(file)) return null;
      const text = readFileSync(file, 'utf8'), rel = relative(root, file).replaceAll('\\', '/');
      // a #version line must stay first (RawShaderMaterial with glslVersion): serve such a file unwrapped (no file:line, hot reload still works)
      const code = /^\s*#version/.test(text) ? text : `// threedog:begin file=${rel}\n${text}\n// threedog:end`;
      this.addWatchFile(file);
      return `const code = ${JSON.stringify(code)};
export default code;
if (import.meta.hot) import.meta.hot.accept(m => {
  if (!m) return;
  const e = globalThis.engine, r = e?.debug?.reloadGlsl?.(code, m.default, ${JSON.stringify(rel)});
  if (r?.materials) console.info('[threedog] shader hot reload: ${rel} -> ' + r.materials + ' material(s) recompiled (' + r.names.slice(0, 5).join(', ') + ')');
  else import.meta.hot.invalidate('no material holds the text of ${rel} (copied into an onBeforeCompile closure?): reloading the page');
});`;
    },
  };
}
