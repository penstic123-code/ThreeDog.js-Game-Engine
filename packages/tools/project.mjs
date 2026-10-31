// Which project a command runs in (helper of paths.mjs, which re-exports TOOLS and project): the monorepo, or a game that installed threedog from npm.
// Lives next to paths.mjs so TOOLS (the folder of this file) and the createRequire fallback resolve the same as they did there.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/** The tools package folder (where this file lives) */
export const TOOLS = realpathSync(dirname(fileURLToPath(import.meta.url)));
export const readJson = f => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const MONO = (() => { const r = resolve(TOOLS, '..', '..'); return readJson(join(r, 'packages', 'engine', 'package.json'))?.name === 'threedog' ? r : null; })();
export const subdirs = d => existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter(x => x.isDirectory() && x.name !== 'node_modules' && !x.name.startsWith('.')).map(x => join(d, x.name)).sort() : [];

/** Nearest folder at or above dir whose package.json depends on threedog (or is the engine itself); null if none */
function gameRootOf(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    const pkg = readJson(join(d, 'package.json'));
    if (pkg && !d.split(sep).includes('node_modules')) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      if (deps.threedog || deps['@threedog/tools'] || pkg.name === 'threedog') return d;
    }
    if (dirname(d) === d) return null;
  }
}

/**
 * Resolve the project a command runs in. Returns { mode, root, engineDir, gameDirs(), docRef(p) }:
 *   mode       'monorepo' (this repository) or 'game' (a game that installed threedog from npm)
 *   root       the monorepo root, or the game folder (nearest package.json that depends on threedog)
 *   engineDir  the engine package folder, found with createRequire from root
 *   gameDirs() folders with a main.js: monorepo = engine examples/* + games/*; game mode = root (+ games/* if present)
 *   docRef(p)  how generated game docs cite an engine file: `node_modules/threedog/<p>`, valid in both layouts
 */
export function project(cwd = process.cwd()) {
  const root = MONO ?? gameRootOf(cwd) ?? resolve(cwd);
  let engineDir;
  for (const from of [join(root, 'package.json'), fileURLToPath(import.meta.url)]) {
    try { engineDir = realpathSync(dirname(createRequire(from).resolve('threedog/package.json'))); break; } catch {}
  }
  engineDir ??= join(root, 'node_modules', 'threedog');
  const mode = MONO ? 'monorepo' : 'game';
  const gameDirs = () => (mode === 'monorepo' ? [...subdirs(join(engineDir, 'examples')), ...subdirs(join(root, 'games'))]
    : [root, ...subdirs(join(root, 'games'))]).filter(d => existsSync(join(d, 'main.js')));
  return { mode, root, engineDir, gameDirs, docRef: p => `node_modules/threedog/${p.replace(/^\/+/, '')}` };
}
