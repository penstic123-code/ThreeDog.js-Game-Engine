#!/usr/bin/env node
// Maintainer script: give a git worktree a working node_modules without running the main checkout's code.
//   node packages/tools/worktree-link.mjs link     junction every main-repo item, this worktree's own packages stay local
//   node packages/tools/worktree-link.mjs unlink   remove those junctions (never their targets)
//   node packages/tools/worktree-link.mjs check    print where each workspace package resolves; exit 1 if it leaves the worktree
// Never run npm install in a linked worktree: it writes through the junctions into the main checkout's node_modules.
// Run it from inside the worktree. Which names are local is read from the worktree's packages/*, so a package
// that was removed or added on a branch needs no change here.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Build caches are per checkout: sharing them would let one branch's bundles serve another's.
const SKIP = new Set(['.vite', '.vite-temp', '.cache']);

const lstat = (p) => fs.lstatSync(p, { throwIfNoEntry: false });

/** Name -> folder of every package in the worktree's packages/. */
function localPackages(worktree) {
  const root = path.join(worktree, 'packages');
  const out = new Map();
  for (const dir of fs.readdirSync(root)) {
    const file = path.join(root, dir, 'package.json');
    if (fs.existsSync(file)) out.set(JSON.parse(fs.readFileSync(file, 'utf8')).name, path.join(root, dir));
  }
  return out;
}

function junction(target, at) {
  if (lstat(at)) return false; // already linked by an earlier run
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.symlinkSync(target, at, 'junction');
  return true;
}

/** Link `worktree/node_modules` to `main/node_modules`, item by item. Returns the number of new links. */
export function link(worktree, main) {
  const local = localPackages(worktree);
  const from = path.join(main, 'node_modules');
  const to = path.join(worktree, 'node_modules');
  let made = 0;
  const each = (name) => {
    const target = path.join(from, name);
    // A dangling link is a leftover of a removed package: statSync follows it and finds nothing.
    if (local.has(name) || !fs.statSync(target, { throwIfNoEntry: false })?.isDirectory()) return;
    if (junction(target, path.join(to, name))) made++;
  };
  for (const item of fs.readdirSync(from)) {
    if (SKIP.has(item)) continue;
    if (item.startsWith('@')) for (const sub of fs.readdirSync(path.join(from, item))) each(`${item}/${sub}`);
    else each(item);
  }
  for (const [name, dir] of local) if (junction(dir, path.join(to, name))) made++;
  return made;
}

/** Remove the links only: anything that is not a link is left alone and reported. Returns those leftovers. */
export function unlink(worktree) {
  const kept = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir)) {
      const p = path.join(dir, item);
      const s = lstat(p);
      if (s.isSymbolicLink()) fs.unlinkSync(p); // removes the junction itself, the target stays
      else if (s.isDirectory() && item.startsWith('@')) walk(p);
      else kept.push(p);
    }
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  };
  const root = path.join(worktree, 'node_modules');
  if (lstat(root)) walk(root);
  return kept;
}

/** Where each local package resolves from the worktree: [{ name, file, ok }]. */
export function check(worktree) {
  const require = createRequire(path.join(worktree, 'package.json'));
  const real = fs.realpathSync(worktree);
  return [...localPackages(worktree).keys()].map((name) => {
    const file = require.resolve(`${name}/package.json`);
    return { name, file, ok: file.startsWith(real + path.sep) };
  });
}

function main() {
  const git = (arg) => path.resolve(execFileSync('git', ['rev-parse', arg], { encoding: 'utf8' }).trim());
  const worktree = git('--show-toplevel');
  const common = git('--git-common-dir');
  // In the main checkout node_modules is real: "unlink" there would break it, and "link" has nothing to do.
  if (common === git('--absolute-git-dir')) {
    console.error('✗ this is the main checkout, not a worktree; nothing done');
    process.exit(1);
  }
  const command = process.argv[2];
  if (command === 'link') {
    console.log(`linked ${link(worktree, path.dirname(common))} items`);
    console.log('warning: never run npm install here: it writes through the junctions into the main checkout\'s node_modules');
  }
  if (command === 'unlink') {
    const kept = unlink(worktree);
    console.log(kept.length ? `links removed; not links, left in place:\n  ${kept.join('\n  ')}` : 'links removed');
  }
  if (command === 'link' || command === 'check') {
    const rows = check(worktree);
    for (const r of rows) console.log(`${r.ok ? '✓' : '✗'} ${r.name} -> ${r.file}`);
    if (rows.some((r) => !r.ok)) process.exit(1);
  }
  if (!['link', 'unlink', 'check'].includes(command)) {
    console.error('usage: node packages/tools/worktree-link.mjs link|unlink|check');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
