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

// Windows paths are case-insensitive: the cwd drive letter case may differ from realpath (VS Code terminals give c:\), so every path comparison
// in the tools goes through these two; a plain === / startsWith made a lower-case cwd miss its game and silently fall back to the engine
export const norm = p => process.platform === 'win32' ? p.toLowerCase() : p;
/** Whether path p is dir or lies under it (case-insensitive on Windows) */
export const within = (p, dir) => norm(p) === norm(dir) || norm(p).startsWith(norm(dir) + sep);
/** Whether a folder is one of this monorepo's own workspaces (the root, packages/*, games/*), so commands there run in monorepo mode */
const monorepoOwns = d => d === MONO || within(d, join(MONO, 'packages')) || within(d, join(MONO, 'games'));

/**
 * Resolve the project a command runs in. Returns { mode, root, engineDir, gameDirs(), docRef(p) }:
 *   mode       'monorepo' (cwd in this repository's root, packages/* or games/*) or 'game' (any other game folder: installed from npm,
 *              or a game anywhere else, even nested inside this repository or another repo's npm workspaces)
 *   root       the monorepo root, or the game folder (nearest package.json at or above cwd that depends on threedog)
 *   engineDir  the engine package folder: monorepo = its own packages/engine; game mode = found with createRequire from root
 *   gameDirs() folders with a main.js: monorepo = engine examples/* + games/*; game mode = root (+ games/* if present)
 *   docRef(p)  how generated game docs cite an engine file: `node_modules/threedog/<p>`, valid in both layouts
 */
export function project(cwd = process.cwd()) {
  // Why look for the nearest game root to cwd first: running a command from the monorepo's tools used to always count as the monorepo, so a game elsewhere in the repo (e.g. .demo/x) or outside it
  // npm run dev / check acted on the outer one ("dev: packages/engine") and the game's own checks never ran. The monorepo's own workspaces (root, packages/*, games/*) are still the monorepo
  const game = gameRootOf(cwd);
  const root = MONO && (!game || monorepoOwns(game)) ? MONO : game ?? resolve(cwd);
  // Monorepo: the engine is this repository's own packages/engine, taken directly. Node resolution would climb out of a git worktree that has no
  // node_modules of its own and land on the main checkout's node_modules/threedog, so check / test / map silently read and wrote the other copy
  let engineDir = MONO && norm(root) === norm(MONO) ? join(MONO, 'packages', 'engine') : undefined;
  if (!engineDir) for (const from of [join(root, 'package.json'), fileURLToPath(import.meta.url)]) {
    try { engineDir = realpathSync(dirname(createRequire(from).resolve('threedog/package.json'))); break; } catch {}
  }
  engineDir ??= join(root, 'node_modules', 'threedog');
  const mode = MONO && norm(root) === norm(MONO) ? 'monorepo' : 'game';
  const gameDirs = () => (mode === 'monorepo' ? [...subdirs(join(engineDir, 'examples')), ...subdirs(join(root, 'games'))]
    : [root, ...subdirs(join(root, 'games'))]).filter(d => existsSync(join(d, 'main.js')));
  return { mode, root, engineDir, gameDirs, docRef: p => `node_modules/threedog/${p.replace(/^\/+/, '')}` };
}
