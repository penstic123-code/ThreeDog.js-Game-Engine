// Create a new style pack in one step: npm run new-style name
// Copies packages/tools/templates/style/ (a clean minimal pack, not a copy of lowpoly) to packages/styles/<name>/ replacing __NAME__ with the name,
// links it as the workspace @threedog/style-<name> (packages/styles/* is already a workspace glob), updates the lock, then runs `style check` and `check`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { npm } from './lib/proc.mjs';
import { ROOT, TOOLS, MODE, rel, styleDir, workspaces } from './paths.mjs';

/** Copy recursively, replacing __NAME__ in the files with the name */
function copy(from, to, name) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true }))
    if (e.isDirectory()) copy(join(from, e.name), join(to, e.name), name);
    else writeFileSync(join(to, e.name), readFileSync(join(from, e.name), 'utf8').replaceAll('__NAME__', name));
}

/**
 * Generate packages/styles/<name> and link it as a workspace. Returns the folder. lock: false skips the package-lock update (tests).
 * Throws a message that says how to fix it.
 */
export function createStyle(name, { lock = true } = {}) {
  if (MODE !== 'monorepo') throw new Error('new-style makes a pack inside the threedog repository (packages/styles/<name>); in a game, copy packages/styles/lowpoly or generate one there and import it by path');
  if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error(`name "${name ?? ''}" is not allowed: lowercase letters, digits and hyphens only (a-z 0-9 -), e.g. new-style sand-dune`);
  const dir = styleDir(name);
  if (existsSync(dir) || workspaces().some(d => d.endsWith(`/${name}`) || d.endsWith(`\\${name}`))) throw new Error(`${rel(dir)} already exists, pick another name`);
  copy(join(TOOLS, 'templates', 'style'), dir, name);
  // Workspace link as npm builds it (node_modules/@threedog/style-<name> → folder); a junction needs no administrator rights on Windows
  const link = join(ROOT, 'node_modules', '@threedog', `style-${name}`);
  if (!existsSync(link)) {
    try { mkdirSync(dirname(link), { recursive: true }); symlinkSync(dir, link, 'junction'); }
    catch (err) { console.warn(`! could not create the workspace link (${err.message}), run npm install in the repo root later`); }
  }
  if (lock && npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: ROOT }).status !== 0) console.warn('! lock not updated, run npm install in the repo root later');
  return dir;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const name = process.argv.slice(2).find(a => !a.startsWith('-'));
  let dir;
  try { dir = createStyle(name); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
  console.log(`✓ created ${rel(dir)} (@threedog/style-${name})`);
  const threedog = join(TOOLS, 'bin', 'threedog.mjs');
  for (const [args, label] of [[['style', 'check', name], 'style check'], [['map'], 'generate docs'], [['check'], 'rule checks']]) {
    console.log(`… ${label}`);
    if (spawnSync(process.execPath, [threedog, ...args], { cwd: ROOT, stdio: 'inherit' }).status !== 0) { console.error(`✗ "${label}" failed; the pack is at ${rel(dir)}, fix it following the output above`); process.exit(1); }
  }
  console.log(`\n✓ Done. Use: import style, { assets } from '@threedog/style-${name}'. Next: recipes/35-style-from-reference.md`);
}
