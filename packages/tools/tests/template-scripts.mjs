// Every `npm run <name>` the shipped docs give (engine docs, README, the template's own docs) is a script of a new game's package.json.
// Why: the docs are read inside a standalone game (node_modules/threedog/docs); a name the template lacks (shot, once) makes npm answer
// "Missing script" and the reader guesses. Offline, reads files only. new-game is the repository's command (a standalone game uses threedog init).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE, TOOLS } from '../paths.mjs';

export const name = 'template scripts: every npm run <name> in the shipped docs is a script of the new-game template';

const REPO_ONLY = new Set(['new-game']);

function mdFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') mdFiles(p, out); }
    else if (/\.(md|txt)$/.test(e)) out.push(p);
  }
  return out;
}

export async function run({ check }) {
  const scripts = JSON.parse(readFileSync(join(TOOLS, 'templates', 'game', 'package.json'), 'utf8')).scripts ?? {};
  const files = [...mdFiles(join(ENGINE, 'docs')), join(ENGINE, 'README.md'), join(ENGINE, 'llms.txt'), ...mdFiles(join(TOOLS, 'templates'))].filter(existsSync);
  const missing = new Map();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\bnpm run ([a-z][a-z-]*)/g)) {
    const n = m[1];
    if (n === 'xxx' || REPO_ONLY.has(n) || n in scripts) continue;
    if (!missing.has(n)) missing.set(n, f.slice(Math.max(f.lastIndexOf('docs'), 0)));
  }
  check('the docs scan found files and npm run names', files.length > 10);
  check('every npm run <name> in the docs has a template script', missing.size === 0, [...missing].map(([n, f]) => `${n} (${f})`).join(', '));
}
