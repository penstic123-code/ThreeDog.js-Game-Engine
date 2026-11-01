// Create a new game in one step: npm run new-game name [--blank]
// --blank: the minimal blank template (templates/blank: just flat ground + player + camera, no inventory / content); without it, the open-world template (templates/game).
// Copies packages/tools/templates/game/ to games/<name>/, replacing __NAME__ in files with the name; then updates the lock, generates GAMEMAP, runs check and the smoke test.
// The templates are real files; to change the starting point of new games, edit that directory directly.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { npm } from './lib/proc.mjs';
import { ROOT, TOOLS, GAMES, rel, workspaces } from './paths.mjs';

// npm swallows the --blank in npm run new-game name --blank (it becomes npm config and never reaches argv), so the env var npm_config_blank is also accepted
const blank = process.argv.includes('--blank') || process.env.npm_config_blank === 'true';
const name = process.argv.slice(2).find(a => !a.startsWith('-'));
if (!name) { console.error('Usage: npm run new-game name [--blank] (lowercase letters, digits and hyphens only, e.g. my-farm; --blank is the minimal blank template)'); process.exit(1); }
if (!/^[a-z0-9-]+$/.test(name)) { console.error(`name "${name}" is not allowed: only lowercase letters, digits and hyphens (a-z 0-9 -)`); process.exit(1); }
const dir = join(GAMES, name);
if (existsSync(dir) || workspaces().some(d => d.endsWith(`/${name}`) || d.endsWith(`\\${name}`))) { console.error(`${rel(dir)} already exists, pick another name`); process.exit(1); }

/** Copy recursively, replacing __NAME__ in text files with the name (empty files and .gitkeep are copied too) */
function copy(from, to, skip = []) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    if (e.isDirectory()) copy(join(from, e.name), join(to, e.name));
    else writeFileSync(join(to, e.name), readFileSync(join(from, e.name), 'utf8').replaceAll('__NAME__', name));
  }
}
copy(join(TOOLS, 'templates', 'game'), dir, blank ? ['content'] : []);
if (blank) copy(join(TOOLS, 'templates', 'blank'), dir);   // overwrites main.js
console.log(`✓ created ${rel(dir)}${blank ? ' (blank template)' : ''}`);

// Workspace link (node_modules/@threedog/<name> → the game directory), which is how npm builds it too; a junction needs no administrator rights on Windows, and non-ASCII paths are fine.
// This way the game can be found by -w name without running npm install (which reinstalls and is slow)
const link = join(ROOT, 'node_modules', '@threedog', name);
if (!existsSync(link)) {
  try { mkdirSync(dirname(link), { recursive: true }); symlinkSync(dir, link, 'junction'); }
  catch (err) { console.warn(`! could not create the workspace link (${err.message}), run npm install in the repo root later`); }
}

const threedog = join(TOOLS, 'bin', 'threedog.mjs');
const run = (cmd, args, label) => {
  console.log(`… ${label}`);
  const r = cmd === 'npm' ? npm(args, { cwd: ROOT, stdio: 'inherit' }) : spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  return r.status === 0;
};
// Only update the workspace entries in package-lock.json (node_modules untouched); a network failure is not fatal, run npm install by hand later
if (!run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], 'update package-lock.json')) console.warn('! lock not updated, run npm install in the repo root later');
const steps = [[['map'], 'generate GAMEMAP.md'], [['check'], 'rule checks'], [['test', '-w', name], 'smoke test (starts, no console errors)']];
for (const [args, label] of steps) {
  if (!run(process.execPath, [threedog, ...args], label)) {
    console.error(`✗ "${label}" failed (see the errors printed just above, e.g. type errors or rule violations). The game files ARE generated at ${rel(dir)}. Next: fix the first error shown, then re-run \`npx threedog ${args.join(' ')}\`; or delete the directory (and restore package-lock.json) if you do not want it`);
    process.exit(1);
  }
}
console.log(`\n✓ Done. Play: npm run dev -- ${name}  write gameplay ideas in ${rel(dir)}/DESIGN.md`);
