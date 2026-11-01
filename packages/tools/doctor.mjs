// One-shot health check: npm run doctor [--ci]
// One line per item: ✓ passed / ✗ problem (followed by the fix) / – info only. The browser WebGL check runs last; everything else finishes in a few milliseconds.
// --ci only prints and never fails the command (no GPU and the like are normal on CI machines).
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { createConnection } from 'node:net';
import { ROOT, ENGINE, workspaces, rel } from './paths.mjs';
import { TOOLS } from './project.mjs';
import { devServerInfo } from './devinfo.mjs';

const ci = process.argv.includes('--ci');
let bad = 0;
const ok = msg => console.log(`✓ ${msg}`);
const info = msg => console.log(`– ${msg}`);
const no = (msg, fix) => { bad++; console.log(`✗ ${msg}  →${fix}`); };

// ── Node version: vite 8 needs ≥ 20.19 or ≥ 22.12 ──
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19)) ok(`Node ${process.versions.node}`);
else no(`Node ${process.versions.node} is too old (need ≥ 20.19 or ≥ 22.12)`, 'in PowerShell run winget install OpenJS.NodeJS.LTS, then close and reopen the terminal');

// ── Dependencies: node_modules, workspace links, lock ──
const nm = join(ROOT, 'node_modules');
if (!existsSync(join(nm, 'three'))) no('node_modules is not installed or incomplete', 'run npm install in the repo root');
else {
  ok('node_modules installed');
  const names = workspaces().map(d => d.split(/[\\/]/).pop());
  const unlinked = names.filter(n => !existsSync(join(nm, '@threedog', n)));
  if (unlinked.length) no(`workspaces not linked: ${unlinked.join(', ')}`, 'run npm install in the repo root (once after creating a new game)');
  else ok(`all workspaces linked (${names.length})`);
}
const lockFile = join(ROOT, 'package-lock.json');
if (!existsSync(lockFile)) no('no package-lock.json', 'run npm install in the repo root');
else {
  const lock = readFileSync(lockFile, 'utf8');
  const missing = workspaces().map(rel).filter(r => !lock.includes(`"${r}"`));
  if (missing.length) no(`missing from the lock: ${missing.join(', ')}`, 'run npm install --package-lock-only to update the lock');
  else ok('package-lock.json matches the workspaces');
}

// ── Which physical copy each context really uses (read-only; nothing is started) ──
// Why: a worktree, vendor/ or a stale node_modules copy can make dev, check and build load different engines or three.js, and the symptoms look like game bugs.
// Contexts: run / build = vite resolves from the game folder (the vite config sets no alias, so plain Node resolution picks the engine: the workspace link or node_modules);
// check = this tools package and ENGINE from paths.mjs. A copy is identified by real path + version + package.json mtime.
const probe = (from, name) => {
  try {
    // some packages hide package.json behind "exports": then resolve the package itself and walk up to its package.json
    const req = createRequire(join(from, 'package.json'));
    let file;
    try { file = req.resolve(`${name}/package.json`); } catch {
      for (let d = dirname(realpathSync(req.resolve(name))); !file && d !== dirname(d); d = dirname(d)) if (existsSync(join(d, 'package.json')) && JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).name === name) file = join(d, 'package.json');
    }
    const real = realpathSync(file), j = JSON.parse(readFileSync(real, 'utf8'));
    return { dir: rel(join(real, '..')) || '.', real: join(real, '..'), tag: `${j.version ?? '?'} @ ${statSync(real).mtime.toISOString().slice(0, 16)}` };
  } catch { return null; }
};
const ctxs = [['check', TOOLS], ...workspaces().filter(d => existsSync(join(d, 'vite.config.js'))).map(d => [`run/build ${rel(d)}`, d])];
const seen = new Map();
for (const [pkg, label] of [['threedog', 'engine'], ['@threedog/tools', 'tools'], ['three', 'three']]) {
  for (const [ctx, from] of ctxs) {
    const r = probe(from, pkg);
    if (r) seen.set(label, [...(seen.get(label) ?? []), { ctx, real: r.real, dir: r.dir, tag: r.tag }]);
    else info(`${label} (${ctx}): not resolvable`);
  }
}
seen.set('engine', [...(seen.get('engine') ?? []), { ctx: 'check (paths.mjs ENGINE)', real: realpathSync(ENGINE), dir: rel(ENGINE) }]);
for (const [label, list] of seen) {
  // one line per distinct copy, listing the contexts that use it (keeps the output short when everything agrees)
  for (const real of new Set(list.map(x => x.real))) { const g = list.filter(x => x.real === real); info(`${label}: ${g[0].dir}  v${g[0].tag ?? '(ENGINE constant)'}  used by ${g.length > 3 ? `${g.length} contexts` : g.map(x => x.ctx).join(', ')}`); }
  const copies = [...new Set(list.map(x => x.real.toLowerCase()))];
  if (copies.length > 1) no(`MISMATCH ${label}: ${copies.length} different physical copies in use (${list.map(x => `${x.ctx} -> ${x.dir}`).join('; ')})`, 'reinstall from the repo root (npm install) so every context resolves one copy; remove vendor/ or stray node_modules copies');
}

// ── .threedog is writable (cache, error log and dev bridge info live there) ──
const threedogDir = join(ROOT, '.threedog');
try { mkdirSync(threedogDir, { recursive: true }); writeFileSync(join(threedogDir, '.doctor'), ''); rmSync(join(threedogDir, '.doctor')); ok('.threedog is writable'); }
catch (e) { no(`.threedog is not writable (${e.code})`, 'check the repo directory permissions; in PowerShell run icacls . /grant "$env:USERNAME:(OI)(CI)F" /T'); }

// ── Port 5173 and the dev server recorded by the dev bridge (.threedog/dev.json is written by the bridge; skipped if absent) ──
const portBusy = port => new Promise(res => {
  const s = createConnection({ port, host: '127.0.0.1' });
  s.setTimeout(500);
  s.on('connect', () => { s.destroy(); res(true); }).on('error', () => res(false)).on('timeout', () => { s.destroy(); res(false); });
});
if (await portBusy(5173)) info('port 5173 is in use; npm run dev will pick the next port automatically; if it is a dev server left running last time, in PowerShell run netstat -ano | findstr :5173, take the PID in the last column, then taskkill /PID <that number> /F');
else ok('port 5173 is free');
// The dev bridge writes .threedog/dev.json { port, token } in every workspace running dev and deletes it when the server stops; a leftover means the last run did not shut down cleanly
for (const ws of workspaces()) {
  const info = devServerInfo(ws);
  if (info.state === 'none') continue;
  const where = rel(info.file);
  if (info.state === 'unreadable') { no(`${where} cannot be read`, `delete it (PowerShell: Remove-Item "${where}"), then run npm run dev again`); continue; }
  const url = `http://127.0.0.1:${info.port}`;
  const alive = info.state === 'live' && await fetch(url, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (alive) ok(`dev server running: ${url} (${rel(ws)})`);
  else no(`the dev server recorded in ${where} is gone (${url})`, `a record left by an unclean shutdown: delete it (PowerShell: Remove-Item "${where}") or run npm run dev again`);
}

// ── Browser (slowest, last): Playwright chromium, headless WebGL2, renderer, GPU timer extension ──
const { chromium } = await import('playwright');
const { launchBrowser } = await import('./browser.mjs');
if (!existsSync(chromium.executablePath())) no('Playwright chromium is not installed', 'run npx playwright install chromium');
else {
  ok('Playwright chromium installed');
  const browser = await launchBrowser();   // same arguments as npm test
  try {
    const gl = await (await browser.newPage()).evaluate(() => {
      const g = document.createElement('canvas').getContext('webgl2');
      if (!g) return null;
      const dbg = g.getExtension('WEBGL_debug_renderer_info');
      return { renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', timer: !!g.getExtension('EXT_disjoint_timer_query_webgl2') };
    });
    if (!gl) no('cannot create WebGL2 in the headless browser', 'update the graphics driver; if that fails, reinstall the browser: npx playwright install chromium --force');
    else {
      ok(`headless WebGL2 available, renderer: ${gl.renderer}`);
      if (gl.timer) ok('EXT_disjoint_timer_query_webgl2 supported (GPU time can be measured)');
      else info('EXT_disjoint_timer_query_webgl2 not supported (common with software rendering): GPU time cannot be measured, frame time only shows the CPU side; running games and tests is unaffected');
    }
  } finally { await browser.close(); }
}

console.log(bad ? `\n${bad} problems, follow the fixes after "→"` : '\nAll passed');
process.exit(bad && !ci ? 1 : 0);
