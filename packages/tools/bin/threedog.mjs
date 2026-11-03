#!/usr/bin/env node
// The threedog command line (bin of @threedog/tools). The root npm scripts and each game's package.json scripts forward here.
// Works in this monorepo and in a game installed from npm (paths.mjs project(): MODE 'monorepo' or 'game'). Usage text is built from the tables below.
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT, TOOLS, MODE, command, findWorkspace, workspaces, rel, ENGINE, ownViteConfig, VITE_DEFAULT_CONFIG } from '../paths.mjs';
import { parseOptions } from '../lib/cli-args.mjs';

/** Commands that run one script of this package (with the remaining arguments) */
export const SCRIPTS = { test: 'run.mjs', check: 'check.mjs', types: 'types.mjs', shot: 'shot.mjs', perf: 'perf.mjs', stress: 'stress.mjs', capture: 'capture.mjs', bake: 'bake.mjs', assets: 'assets.mjs',
  doctor: 'doctor.mjs', 'new-game': 'new-game.mjs', init: 'init.mjs', style: 'style.mjs', content: 'content-ids.mjs', tune: 'tune.mjs', gallery: 'gallery.mjs', how: 'how.mjs', relay: 'net-relay.mjs', art: 'art.mjs', lib: 'lib.mjs', examples: 'examples.mjs', mcp: 'threedog/mcp.mjs' };
/** Dev bridge commands: drive the page running under `npm run dev` (recipes/16-dev-bridge.md) */
export const BRIDGE = ['describe', 'step', 'press', 'hold', 'state', 'eval', 'js', 'snap', 'snap-describe', 'errors', 'reload', 'resume', 'op', 'skip', 'ops', 'catalog', 'scenario', 'session', 'inspect', 'scene', 'explain', 'loading', 'pick', 'thing', 'play', 'status', 'verify'];
/** vite commands on one workspace */
export const VITE = ['dev', 'build', 'preview'];
/** Doc generators: the engine generators only run in the monorepo; a game regenerates its GAMEMAP */
const MAP = MODE === 'monorepo' ? ['gentypes.mjs', 'codemap.mjs', 'apidoc.mjs', 'gamemap.mjs'] : ['gamemap.mjs'];
export const USAGE = `Usage: threedog ${VITE.join('|')} [game | -w game] · threedog test [-w game] [test name…] · threedog check|types|map · ` +
  `threedog shot|perf|bake|assets [-w game] … [--gpu|--software] · threedog stress [--only axis,…] · threedog new-game name · threedog init [folder] · threedog style check|palette … · threedog content ids [-w game] [--write] · threedog content set|add|remove … · threedog tune show|write [file] [--apply] · threedog gallery [-w game] [--shots] · threedog how "task" · threedog art list <source> · threedog art copy <source> [names…] [--to art/] [--force] [--dry] · threedog lib add|list|pull|page … (your own art library, ~/.threedog/library) · threedog examples list|pull <name> [--out dir] [--force] · threedog doctor · threedog relay [port] · threedog mcp [-w game] [--allow-js] · dev bridge: threedog ${BRIDGE.join('|')}`;

const node = (script, args, cwd = process.cwd()) => spawnSync(process.execPath, [join(TOOLS, script), ...args], { stdio: 'inherit', cwd }).status ?? 1;
/** --help / -h: print the script's header comment instead of running it (`threedog test --help` used to start the whole suite) */
const wantsHelp = args => args.includes('--help') || args.includes('-h');
function help(scripts) {
  const text = scripts.map(s => {
    const out = [];
    for (const l of readFileSync(join(TOOLS, s), 'utf8').split('\n')) { if (l.startsWith('#!')) continue; if (!l.startsWith('//')) break; out.push(l.replace(/^\/\/ ?/, '')); }
    return out.join('\n');
  }).filter(Boolean).join('\n\n');
  console.log(text || USAGE);
  return 0;
}

/** Run the CLI with argv (without node and the script path); returns the exit code */
export function main([cmd, ...rest]) {
  if (VITE.includes(cmd)) {
    // The workspace: -w / --workspace like every other command (taken out here: to vite, -w is --watch, so `build -w game` sat in watch mode on
    // the wrong root and never exited), or a game name as the first argument (the 5000 in a later --port 5000 is not a game name); with neither,
    // the workspace of the current directory, otherwise the engine package. Drop the extra --: vite treats everything after -- as positional
    // arguments, which would disable --port. Every other option is vite's (passthrough), so vite reads and checks it
    let dir, name, args;
    try {
      const picked = command(rest.filter(a => a !== '--'), { fallback: workspaces()[0] ?? ENGINE, positional: true, passthrough: true });
      args = picked.rest;
      name = !picked.named && args[0] && !args[0].startsWith('-') ? args[0] : undefined;
      if (name) { dir = findWorkspace(name); args = args.slice(1); } else dir = picked.dir;
    } catch (e) { console.error(e.message); return 1; }
    if (!dir) { console.error(`"${name}" not found. Available: ${workspaces().map(rel).join(', ')}`); return 1; }
    let vite;
    // vite's exports do not expose bin/vite.js, so find its package.json and read the bin field
    // Look from the game, then from this tools package (npm may install vite nested under packages/tools instead of the root), then the root
    const pkg = [dir, TOOLS, ROOT].map(from => { try { return createRequire(join(from, 'package.json')).resolve('vite/package.json'); } catch { return null; } }).find(Boolean);
    if (!pkg) { console.error('vite is not installed: run npm install (it comes with @threedog/tools)'); return 1; }
    vite = join(dirname(pkg), JSON.parse(readFileSync(pkg, 'utf8')).bin.vite);
    console.log(`${cmd}: ${rel(dir) || '.'}`);
    // a game without its own vite config gets the threedog preset (Workers as ES modules, multi-page input, dev bridge), not vite's bare defaults
    const own = ownViteConfig(dir) || args.some(a => a === '--config' || a === '-c' || a.startsWith('--config='));
    const cfg = own ? [] : ['--config', VITE_DEFAULT_CONFIG];
    return spawnSync(process.execPath, [vite, ...(cmd === 'dev' ? [] : [cmd]), ...cfg, ...args], { stdio: 'inherit', cwd: dir }).status ?? 1;
  }
  // map -w <game>: only that game's GAMEMAP (the engine docs and declarations do not depend on one game)
  if (cmd === 'map' && wantsHelp(rest)) return help(MAP);
  if (SCRIPTS[cmd] && wantsHelp(rest)) return help([SCRIPTS[cmd]]);
  if (cmd === 'map') {
    // one parse for the whole map, then each generator gets only the options it reads (they parse strictly too)
    let m;
    try { m = parseOptions(rest, { workspace: true, flags: ['check', 'report'] }); } catch (e) { console.error('✗ ' + e.message); return 1; }
    const check = m.opt.check ? ['--check'] : [];
    const argsOf = { 'gamemap.mjs': [...check, ...(m.workspace !== undefined ? ['-w', m.workspace] : [])], 'apidoc.mjs': [...check, ...(m.opt.report ? ['--report'] : [])] };
    for (const s of m.workspace !== undefined ? ['gamemap.mjs'] : MAP) { const c = node(s, argsOf[s] ?? check); if (c) return c; }
    return 0;
  }
  if (BRIDGE.includes(cmd)) return node('threedog/cli.mjs', [cmd, ...rest]);
  if (SCRIPTS[cmd]) return node(SCRIPTS[cmd], rest);
  console.log(USAGE);
  return cmd ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href || /[\\/]threedog(\.mjs|\.cmd)?$/.test(process.argv[1] || '')) {
  // Bridge commands run IN this process (cli.mjs exits by itself): spawning a second node for them cost ~0.25 s per command on Windows
  if (BRIDGE.includes(process.argv[2])) { process.argv.splice(1, 1, join(TOOLS, 'threedog', 'cli.mjs')); await import('./../threedog/cli.mjs'); }
  else process.exit(main(process.argv.slice(2)));
}
