// Which repository's engine and workspace the tools act on, in layouts that used to fool them.
// Why: in a git worktree without its own node_modules, Node resolution of 'threedog' climbed to the main checkout's node_modules, so check / map /
// test read (and map wrote) the main repository's engine with no error. And with a lower-case drive letter (c:\, as VS Code terminals give) the
// current game was not found and commands silently fell back to the engine examples.
// Everything runs in child processes: project.mjs / paths.mjs resolve once per process from where they live and from cwd.
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, TOOLS } from '../paths.mjs';

export const name = 'project context: a monorepo without node_modules uses its own engine; a lower-case drive letter still finds the game';

const evalIn = (cwd, src) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { cwd, encoding: 'utf8' });
  try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return { err: r.stderr.slice(-400) }; }
};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

export async function run({ check }) {
  // ── an outer folder whose node_modules has a threedog (the main checkout), with a monorepo copy inside that has no node_modules (the worktree) ──
  const outer = realpathSync(mkdtempSync(join(tmpdir(), 'threedog-wt-')));
  try {
    const repo = join(outer, 'wt');
    mkdirSync(join(outer, 'node_modules', 'threedog'), { recursive: true });
    writeFileSync(join(outer, 'node_modules', 'threedog', 'package.json'), JSON.stringify({ name: 'threedog' }));
    mkdirSync(join(repo, 'packages', 'engine'), { recursive: true });
    mkdirSync(join(repo, 'packages', 'tools'), { recursive: true });
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'repo', private: true, workspaces: ['packages/*', 'games/*'] }));
    writeFileSync(join(repo, 'packages', 'engine', 'package.json'), JSON.stringify({ name: 'threedog' }));
    copyFileSync(join(TOOLS, 'project.mjs'), join(repo, 'packages', 'tools', 'project.mjs'));
    const url = pathToFileURL(join(repo, 'packages', 'tools', 'project.mjs')).href;
    const p = evalIn(repo, `const { project } = await import(${JSON.stringify(url)}); const p = project(); console.log(JSON.stringify({ mode: p.mode, engine: p.engineDir }));`);
    check('a monorepo with no node_modules is still monorepo mode', p.mode === 'monorepo', JSON.stringify(p));
    check('its engine is its own packages/engine, not the threedog in a node_modules above it', same(p.engine, join(repo, 'packages', 'engine')), JSON.stringify(p));

    // [guard] a game in a git checkout (here: a worktree, .git is a file) whose threedog comes from a node_modules outside that checkout:
    // doctor and test must refuse (engineMismatch), since builds would run the other copy while check reads this one
    const game = join(outer, 'gamewt');
    mkdirSync(game, { recursive: true });
    writeFileSync(join(game, '.git'), 'gitdir: elsewhere\n');
    writeFileSync(join(game, 'package.json'), JSON.stringify({ name: 'g', private: true, dependencies: { threedog: '*' } }));
    writeFileSync(join(game, 'main.js'), '');
    const pathsUrl = JSON.stringify(pathToFileURL(join(TOOLS, 'paths.mjs')).href);
    const g = evalIn(game, `const p = await import(${pathsUrl}); console.log(JSON.stringify({ mode: p.MODE, m: p.engineMismatch() }));`);
    check('[guard] engine resolved from outside the checkout: engineMismatch names it and says npm install', g.mode === 'game' && /outside this project/.test(g.m ?? '') && /npm install/.test(g.m ?? ''), JSON.stringify(g));
    for (const f of ['doctor.mjs', 'run.mjs']) check(`[guard] ${f} refuses to run on a mismatched engine (calls engineMismatch)`, /engineMismatch\(\)/.test(readFileSync(join(TOOLS, f), 'utf8')));
  } finally { rmSync(outer, { recursive: true, force: true }); }
  const here = evalIn(ROOT, `const p = await import(${JSON.stringify(pathToFileURL(join(TOOLS, 'paths.mjs')).href)}); console.log(JSON.stringify({ m: p.engineMismatch() }));`);
  check('this checkout: the engine the games import is the one the tools read', here.m === null, JSON.stringify(here));

  // ── a lower-case drive letter in cwd (Windows only: elsewhere paths are case-sensitive and there is no drive letter) ──
  if (process.platform === 'win32') {
    const lower = s => s.replace(/^[A-Z]:/, d => d.toLowerCase());
    const paths = JSON.stringify(pathToFileURL(join(TOOLS, 'paths.mjs')).href);
    const r = evalIn(lower(TOOLS), `const p = await import(${paths}); console.log(JSON.stringify({ of: p.workspaceOf(process.cwd()), inside: typeof p.within === 'function' && p.within(process.cwd(), p.ROOT) }));`);
    check('c:\\ cwd: workspaceOf finds the workspace it is in', same(r.of, TOOLS), JSON.stringify(r));
    check('c:\\ cwd: within() (exported for every path comparison) ignores the drive letter case', r.inside === true, JSON.stringify(r));
    // workspaceFor only picks bundle/test workspaces (engine + games): from inside the engine folder it must pick the engine, spelled as workspaces() lists it
    const engine = join(ROOT, 'packages', 'engine');
    const e = evalIn(lower(join(engine, 'core')), `const p = await import(${paths}); const d = p.workspaceFor(undefined, { fallback: null }); console.log(JSON.stringify({ d, listed: p.workspaces().includes(d) }));`);
    check('c:\\ cwd: workspaceFor returns the workspace exactly as workspaces() lists it', e.listed === true, JSON.stringify(e));
  }
}
