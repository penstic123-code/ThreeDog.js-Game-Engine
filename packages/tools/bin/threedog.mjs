#!/usr/bin/env node
// The threedog command line (bin of @threedog/tools). The root npm scripts and each game's package.json scripts forward here.
// Works in this monorepo and in a game installed from npm (paths.mjs project(): MODE 'monorepo' or 'game'). Usage text is built from the tables below.
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT, TOOLS, MODE, pickWorkspace, findWorkspace, workspaces, rel, ENGINE } from '../paths.mjs';

/** Commands that run one script of this package (with the remaining arguments) */
export const SCRIPTS = { test: 'run.mjs', check: 'check.mjs', types: 'types.mjs', shot: 'shot.mjs', perf: 'perf.mjs', capture: 'capture.mjs', bake: 'bake.mjs', assets: 'assets.mjs',
  doctor: 'doctor.mjs', 'new-game': 'new-game.mjs', 'new-style': 'new-style.mjs', style: 'style.mjs', content: 'content-ids.mjs', relay: 'net-relay.mjs', mcp: 'threedog/mcp.mjs' };
/** Dev bridge commands: drive the page running under `npm run dev` (recipes/16-dev-bridge.md) */
export const BRIDGE = ['describe', 'step', 'press', 'hold', 'state', 'eval', 'js', 'snap', 'snap-describe', 'errors', 'reload', 'resume', 'op', 'ops', 'scenario', 'inspect', 'scene', 'explain', 'loading', 'pick', 'play', 'status', 'verify'];
/** vite commands on one workspace */
export const VITE = ['dev', 'build', 'preview'];
/** Doc generators: the engine generators only run in the monorepo; a game regenerates its GAMEMAP */
const MAP = MODE === 'monorepo' ? ['gentypes.mjs', 'codemap.mjs', 'apidoc.mjs', 'gamemap.mjs'] : ['gamemap.mjs'];
export const USAGE = `Usage: threedog ${VITE.join('|')} [game] · threedog test [-w game] [test name…] · threedog check|types|map · ` +
  `threedog shot|perf|bake|assets [-w game] … · threedog new-game name · threedog new-style name · threedog style check|palette … · threedog content ids [-w game] [--write] · threedog doctor · threedog relay [port] · threedog mcp [-w game] [--allow-js] · dev bridge: threedog ${BRIDGE.join('|')}`;

const node = (script, args, cwd = process.cwd()) => spawnSync(process.execPath, [join(TOOLS, script), ...args], { stdio: 'inherit', cwd }).status ?? 1;

/** Run the CLI with argv (without node and the script path); returns the exit code */
export function main([cmd, ...rest]) {
  if (VITE.includes(cmd)) {
    // The game name can only be the first argument (the 5000 in a later --port 5000 is not a game name); with none, the workspace of the current
    // directory, otherwise the engine package. Drop the extra --: vite treats everything after -- as positional arguments, which would disable --port
    const name = rest[0] && !rest[0].startsWith('-') ? rest[0] : undefined, args = rest.filter(a => a !== name && a !== '--');
    let dir;
    try { dir = name ? findWorkspace(name) : pickWorkspace([], { fallback: workspaces()[0] ?? ENGINE }).dir; } catch (e) { console.error(e.message); return 1; }
    if (!dir) { console.error(`"${name}" not found. Available: ${workspaces().map(rel).join(', ')}`); return 1; }
    let vite;
    // vite's exports do not expose bin/vite.js, so find its package.json and read the bin field
    try { const pkg = createRequire(join(ROOT, 'package.json')).resolve('vite/package.json'); vite = join(dirname(pkg), JSON.parse(readFileSync(pkg, 'utf8')).bin.vite); }
    catch { console.error('vite is not installed: run npm install (it comes with @threedog/tools)'); return 1; }
    console.log(`${cmd}: ${rel(dir) || '.'}`);
    // a game without its own vite config gets the threedog preset (Workers as ES modules, multi-page input, dev bridge), not vite's bare defaults
    const own = ['js', 'mjs', 'ts', 'cjs', 'mts'].some(x => existsSync(join(dir, 'vite.config.' + x))) || args.some(a => a === '--config' || a === '-c' || a.startsWith('--config='));
    const cfg = own ? [] : ['--config', join(TOOLS, 'threedog', 'vite-default.config.mjs')];
    return spawnSync(process.execPath, [vite, ...(cmd === 'dev' ? [] : [cmd]), ...cfg, ...args], { stdio: 'inherit', cwd: dir }).status ?? 1;
  }
  if (cmd === 'map') { for (const s of MAP) { const c = node(s, rest); if (c) return c; } return 0; }
  if (BRIDGE.includes(cmd)) return node('threedog/cli.mjs', [cmd, ...rest]);
  if (SCRIPTS[cmd]) return node(SCRIPTS[cmd], rest);
  console.log(USAGE);
  return cmd ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href || /[\\/]threedog(\.mjs|\.cmd)?$/.test(process.argv[1] || '')) process.exit(main(process.argv.slice(2)));
