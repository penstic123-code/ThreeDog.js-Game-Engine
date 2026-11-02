// Automatic cache for code-generated models (engine.assets.cached / generator functions in the manifest) and the stale-bake check.
//
// During development (npm run dev) it provides:
//   POST /__threedog/cache/key        { name, src, params } → { key, hit }: hash = name + generator source + parameters +
//                                contents of the file it lives in and the project files it imports. Change the code and the hash changes, so the cache invalidates itself.
//                                Engine files count too: names imported from the engine entry (index.js / threedog), such as mergeColored, are traced to the file that defines them (with the engine files it imports),
//                                without hashing the whole engine (otherwise changing any engine code would invalidate every cache). node_modules does not count.
//                                External variables a generator uses (closures) are not in its source: the caller must put them in params (see Assets.cached, internal)
//   GET/PUT /__threedog/cache/<key>.glb   read/write this workspace's .threedog/cache/<key>.glb (only beyond 200 files are the oldest deleted)
//   GET /__threedog/bake-lists        for the bake page of npm run bake: { baked: URL of the module holding toGLB, lists: [{ url, from }] }
//   GET /models/baked/index.json     returns {} when nothing has been baked yet (not a 404)
// When building (npm run build):
//   stale baked files in public/models/baked/index.json (generator code changed) → error, telling you to run npm run bake
//   with no bake list, outputs an empty {}
//
//   Installed automatically by gameConfig (./gameConfig.js); paths (engine entry, style packs) are read from ../paths.mjs. File paths in hashes are relative to the repo root.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, relative, dirname, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { isLocalRequest } from './local.js';
import { ROOT as REPO, abs, rel, ENGINE, ENGINE_PKG, INDEX_JS_REL, STYLES_REL, BAKED_REL, ENGINE_CODE_DIRS_REL, optionalEntry } from '../paths.mjs';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.threedog', 'public', 'shots', '.git']);
// When looking for generator source the engine source is not searched (generators live in the game or the style pack)
const ENGINE_CODE = new Set(ENGINE_CODE_DIRS_REL.map(abs));
const BARREL = abs(INDEX_JS_REL), STYLES = abs(STYLES_REL);
const NAMED_RE = /(?:import|export)\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const names = list => list.split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(Boolean);
const SRC_EXT = new Set(['.js', '.mjs', '.ts']);
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;
const sha = s => createHash('sha1').update(s).digest('hex');

/** Read project source files (cached by modification time) */
function makeReader() {
  const files = new Map();   // path → { mtime, text, hash }
  return path => {
    const m = statSync(path).mtimeMs, c = files.get(path);
    if (c && c.mtime === m) return c;
    const text = readFileSync(path, 'utf8'), v = { mtime: m, text, hash: sha(text) };
    files.set(path, v); return v;
  };
}

/** Hash helpers for generators (shared by the dev server, the build check and npm run bake). root is the workspace directory (engine package or a game) */
export function keyMaker(root) {
  // Directories to search: this workspace; a game also adds the style packs (models from the style pack a game uses must be hashable and bakeable too)
  const roots = root === ENGINE ? [root] : [root, STYLES];
  const read = makeReader();
  let list = null, listAt = 0;
  const walk = () => {
    if (list && Date.now() - listAt < 1000) return list;
    list = []; listAt = Date.now();
    for (const r of roots) (function w(d) {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        const p = resolve(d, f.name);
        if (f.isDirectory()) { if (!SKIP_DIRS.has(f.name) && !ENGINE_CODE.has(p) && !f.name.startsWith('.')) w(p); }
        else if (SRC_EXT.has(extname(f.name))) list.push(p);
      }
    })(r);
    return list;
  };
  const resolveSpec = (file, spec) => {
    let p;
    if (spec === ENGINE_PKG) p = BARREL;                                                        // a game's import 'threedog'
    else if (optionalEntry(spec)) p = optionalEntry(spec);                                   // a style pack (@threedog/style-<name>) or an add-on (@threedog/terrain-noise)
    else if (!/^\.{1,2}\/|^\//.test(spec)) return null;
    else p = spec.startsWith('/') ? resolve(root, '.' + spec) : resolve(dirname(file), spec);
    if (!extname(p) && existsSync(p + '.js')) p += '.js';
    const r = relative(REPO, p);
    if (r.startsWith('..') || r.split(/[\\/]/).some(s => SKIP_DIRS.has(s))) return null;
    return p;
  };
  const isBarrel = p => p === BARREL;
  /** Which file each name in the entry file comes from */
  const barrelMap = p => {
    const map = new Map();
    for (const m of read(p).text.matchAll(NAMED_RE)) { const src = resolveSpec(p, m[2]); if (src) for (const n of names(m[1])) map.set(n, src); }
    return map;
  };
  const deps = (file, out) => {
    if (out.has(file) || !existsSync(file)) return out;
    out.add(file);
    const text = read(file).text, viaBarrel = new Set();
    // Imports by name from the engine entry: only traced to the files that define those names
    for (const m of text.matchAll(NAMED_RE)) {
      const p = resolveSpec(file, m[2]);
      if (!p || !isBarrel(p)) continue;
      viaBarrel.add(m[2]);
      const map = barrelMap(p);
      for (const n of names(m[1])) { const src = map.get(n); if (src) deps(src, out); }
    }
    for (const m of text.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2] || m[3];
      if (viaBarrel.has(spec)) continue;
      const p = resolveSpec(file, spec);
      if (p && !isBarrel(p)) deps(p, out);
    }
    return out;
  };
  /** { name, src, params } → { key, files }: files are the file the generator lives in and the files it imports (relative paths) */
  const keyOf = ({ name, src, params = null }) => {
    const found = walk().filter(f => read(f).text.includes(src)), all = new Set();
    for (const f of found) deps(f, all);
    const files = [...all].map(rel).sort();
    const key = sha([name, src, JSON.stringify(params), ...files.map(f => f + ':' + read(resolve(REPO, f)).hash)].join('\0')).slice(0, 16);
    return { key, files };
  };
  /** Content hash of a set of files together with the project files they import (npm run bake uses it to decide "nothing changed") */
  keyOf.filesHash = list => {
    const all = new Set(); for (const f of list) deps(resolve(REPO, f), all);
    return sha([...all].map(f => rel(f) + ':' + read(f).hash).sort().join('\0'));
  };
  /** Bake list files (relative to the repo root): engine style packs styles/<style pack>/index.js and bake.js in this workspace (except tests/) */
  keyOf.bakeLists = () => walk().filter(f => (dirname(dirname(f)) === STYLES && basename(f) === 'index.js')
    || (basename(f) === 'bake.js' &&!relative(root, f).split(/[\\/]/).includes('tests'))).map(rel).sort();
  return keyOf;
}

/** Stale items in the bake list (generator code changed, file lost): [{ name, why }] */
export function staleBaked(root, index, keyOf = keyMaker(root)) {
  const dir = resolve(root, 'public/models/baked'), out = [];
  for (const [name, it] of Object.entries(index)) {
    if (!existsSync(resolve(dir, it.file))) out.push({ name, why: 'missing' });
    else if (it.source !== 'file' && keyOf({ ...it, name }).key !== it.key) out.push({ name, why: 'changed' });
  }
  return out;
}

const STRINGS = {
  stale: 'Baked files are stale (generator code changed or a file is missing): {list}\nRun npm run bake first (it only re-bakes what changed), then build.',
};

export default function threedogCache({ maxFiles = 200 } = {}) {
  let root = process.cwd(), base = '/', keyOf = null, command = 'serve';
  const cacheDir = () => resolve(root, '.threedog/cache');
  const indexFile = () => resolve(root, 'public/models/baked/index.json');
  const body = req => new Promise((ok, bad) => { const a = []; req.on('data', c => a.push(c)); req.on('end', () => ok(Buffer.concat(a))); req.on('error', bad); });
  const prune = () => {
    const files = readdirSync(cacheDir()).map(f => ({ f, t: statSync(resolve(cacheDir(), f)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { f } of files.slice(maxFiles)) unlinkSync(resolve(cacheDir(), f));
  };
  return {
    name: 'threedog-cache',
    configResolved(c) { root = c.root; base = c.base; command = c.command; keyOf = keyMaker(root); },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url.split('?')[0];
        if (path === base + 'models/baked/index.json' && !existsSync(indexFile())) { res.setHeader('Content-Type', 'application/json'); return res.end('{}'); }
        if ((path === '/__threedog/bake-lists' || path.startsWith('/__threedog/cache/')) && !isLocalRequest(req, { sameOrigin: true })) { res.statusCode = 403; return res.end(); }
        if (path === '/__threedog/bake-lists') {   // modules the bake page (packages/tools/bake-page.js) loads: absolute paths go through vite's /@fs/
          const fsUrl = f => '/@fs' + abs(f).replace(/\\/g, '/').replace(/^(?!\/)/, '/');
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ baked: fsUrl(BAKED_REL), lists: keyOf.bakeLists().map(f => ({ url: fsUrl(f), from: f })) }));
        }
        if (!path.startsWith('/__threedog/cache/')) return next();
        try {
          const name = path.slice('/__threedog/cache/'.length);
          if (name === 'key' && req.method === 'POST') {
            const { key, files } = keyOf(JSON.parse(await body(req)));
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ key, files, hit: existsSync(resolve(cacheDir(), key + '.glb')) }));
          }
          if (!/^[0-9a-f]{16}\.glb$/.test(name)) return next();
          const file = resolve(cacheDir(), name);
          if (req.method === 'PUT') { mkdirSync(cacheDir(), { recursive: true }); writeFileSync(file, await body(req)); prune(); return res.end('ok'); }
          if (!existsSync(file)) return next();
          res.setHeader('Content-Type', 'model/gltf-binary');
          res.end(readFileSync(file));
        } catch (err) { res.statusCode = 500; res.end(String(err)); }
      });
    },
    buildStart() {
      if (command !== 'build' || !existsSync(indexFile())) return;
      const bad = staleBaked(root, JSON.parse(readFileSync(indexFile(), 'utf8')), keyOf);
      if (bad.length) this.error(STRINGS.stale.replace('{list}', bad.map(b => b.name).join(', ')));
    },
    generateBundle() {
      if (!existsSync(indexFile())) this.emitFile({ type: 'asset', fileName: 'models/baked/index.json', source: '{}' });
    },
  };
}
