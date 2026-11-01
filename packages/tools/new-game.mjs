// Create a new game in one step: npm run new-game -- name [--example] [--style empty|<path-or-package>]
// Default: the clean template (templates/game): ground, player, follow camera, sky, empty content files, an empty style/ pack, no gameplay.
// --example: overlays templates/example (hp, hunger, rest op, apples, stash, HUD) for people who want to see patterns.
// --style: empty (default, the game's own empty style/ folder) or a style pack by path or package name. --blank is accepted and means the default.
// Copies the template layers to games/<name>/, replacing __NAME__ in files with the name; then updates the lock, generates GAMEMAP, runs check and the smoke test.
// The templates are real files; to change the starting point of new games, edit those directories directly.
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { npm } from './lib/proc.mjs';
import { parseArgs, applyStyleDeps, copyTemplates } from './lib/scaffold.mjs';
import { ROOT, TOOLS, GAMES, rel, workspaces } from './paths.mjs';

// npm swallows flags in npm run new-game name --example (they become npm config and never reach argv): use `npm run new-game -- name --example`; the npm_config_* env vars are read as a fallback (parseArgs)
const opts = parseArgs(process.argv.slice(2), process.env);
const USAGE = 'Usage: npm run new-game -- name [--example] [--style empty|<path-or-package>] (name: lowercase letters, digits and hyphens only, e.g. my-farm; --blank is accepted and means the default)';
if (opts.error) { console.error(opts.error + '\n' + USAGE); process.exit(1); }
const name = opts.name;
if (!name) { console.error(USAGE); process.exit(1); }
if (!/^[a-z0-9-]+$/.test(name)) { console.error(`name "${name}" is not allowed: only lowercase letters, digits and hyphens (a-z 0-9 -)`); process.exit(1); }
const dir = join(GAMES, name);
if (existsSync(dir) || workspaces().some(d => d.endsWith(`/${name}`) || d.endsWith(`\\${name}`))) { console.error(`${rel(dir)} already exists, pick another name`); process.exit(1); }

// Clean template (templates/game) = ground, player, follow camera, sky, empty content, empty style/; --example overlays the old sample (templates/example)
copyTemplates(dir, { ...opts, name });
// package.json dependencies follow the style choice
const pkgPath = join(dir, 'package.json'), pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.dependencies = applyStyleDeps(pkg.dependencies, opts.style);
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
// MCP for Claude Code opened in the game folder: plain node on this repo's tools (npx costs ~2.5 s and needs `cmd /c` on Windows); the path is relative so the repo can move
const mcpBin = relative(dir, join(TOOLS, 'bin', 'threedog.mjs')).replaceAll('\\', '/');
writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { threedog: { command: 'node', args: [mcpBin, 'mcp'] } } }, null, 2) + '\n');
console.log(`✓ created ${rel(dir)} (style: ${opts.style}${opts.example ? ', example sample' : ''})`);

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
