// One-shot health check: npm run doctor [--ci] [--json]
// One line per item: ✓ passed / ✗ problem (followed by the fix) / – info only. The browser check runs last: it renders one real engine frame on
// software rendering (what tests use) and on the hardware GPU path (what shot / gallery / perf / stress prefer), a few seconds; the rest takes milliseconds.
// --json prints one verdict object instead of lines: { healthy, items: [{ status, msg, fix? }], render }. Exit code 0 only when healthy.
// --ci only prints and never fails the command (no GPU and the like are normal on CI machines).
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { createConnection } from 'node:net';
import { ROOT, ENGINE, workspaces, rel, cli, engineMismatch } from './paths.mjs';
import { TOOLS } from './project.mjs';
import { devServerInfo } from './devinfo.mjs';

const { opt } = cli(process.argv.slice(2), { workspace: false, flags: ['ci', 'json', 'gpu', 'software'] });
const ci = !!opt.ci, json = !!opt.json;
let bad = 0;
const items = [], verdict = { healthy: false, items, render: {} };
const line = (status, msg, fix) => { items.push(fix ? { status, msg, fix } : { status, msg }); if (!json) console.log(`${{ ok: '✓', problem: '✗', info: '–' }[status]} ${msg}${fix ? `  →${fix}` : ''}`); };
const ok = msg => line('ok', msg);
const info = msg => line('info', msg);
const no = (msg, fix) => { bad++; line('problem', msg, fix); };

// ── Node version: vite 8 needs ≥ 20.19 or ≥ 22.12 ──
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj > 22 || (maj === 22 && min >= 12) || (maj === 20 && min >= 19)) ok(`Node ${process.versions.node}`);
else no(`Node ${process.versions.node} is too old (need ≥ 20.19 or ≥ 22.12)`, 'in PowerShell run winget install OpenJS.NodeJS.LTS, then close and reopen the terminal');

// ── Dependencies: node_modules, workspace links, lock ──
const nm = join(ROOT, 'node_modules');
if (!existsSync(join(nm, 'three'))) no('node_modules is not installed or incomplete', 'run npm install in the repo root');
else {
  ok('node_modules installed');
  // linked under the package.json name, as npm does it (a game "my-game" → node_modules/my-game; engine packages → node_modules/@threedog/...)
  const names = workspaces().map(d => { try { return JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')).name; } catch { return null; } }).filter(Boolean);
  const unlinked = names.filter(n => !existsSync(join(nm, n)));
  if (unlinked.length) no(`workspaces not linked: ${unlinked.join(', ')}`, 'run npm install in the repo root (once after creating a new game)');
  else ok(`all workspaces linked (${names.length})`);
}
// The engine the games import must lie in this project: a git worktree without its own node_modules resolves the main checkout's copy, so
// builds and tests would run other code than check reads (paths.mjs engineMismatch)
const mismatch = engineMismatch();
if (mismatch) no(mismatch, `npm install in ${ROOT}`);
else ok(`engine resolves inside this project (${rel(ENGINE) || '.'})`);
const lockFile = join(ROOT, 'package-lock.json');
if (!existsSync(lockFile)) no('no package-lock.json', 'run npm install in the repo root');
else {
  const lock = readFileSync(lockFile, 'utf8');
  const missing = workspaces().map(rel).filter(r => !lock.includes(`"${r}"`));
  // new-game leaves the lock alone (the game runs through the link): only npm ci needs the entry, and the next npm install writes it
  if (missing.length) info(`not in package-lock.json yet: ${missing.join(', ')} (fine for dev / check / test; run npm install in the repo root before npm ci)`);
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
const ctxs = [['check', TOOLS], ...workspaces().map(d => [`run/build ${rel(d)}`, d])];
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

// ── Browser (slowest, last): one real engine frame per render path ──
// Why a real frame, not just getContext('webgl2'): a context can exist while the engine still cannot draw (shader compile, a blocklisted driver
// path, an ANGLE backend that silently falls back), and the shot / test failure that follows looks like a game bug.
const { chromium } = await import('playwright');
const { CHROMIUM_ARGS, SOFTWARE_RENDERER, forcedRender } = await import('./browser.mjs');
{   // one real engine frame per render path
  const page = join(ROOT, '.threedog', 'doctor-page');
  mkdirSync(page, { recursive: true });
  writeFileSync(join(page, 'index.html'), '<!doctype html><meta charset="utf-8"><canvas id="view" width="64" height="64"></canvas><script type="module" src="/main.js"></script>');
  writeFileSync(join(page, 'main.js'), `import * as THREE from 'three';
import { createEngine } from 'threedog';
try {
  const canvas = document.getElementById('view');
  const engine = createEngine({ canvas, headless: true, ui: { loading: false }, pixelRatio: 1, adaptiveResolution: false, saveKey: 'doctor' });
  await engine.start();
  engine.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshBasicMaterial({ color: 0xff0000 })));
  engine.camera.position.set(0, 0, 5); engine.camera.lookAt(0, 0, 0);
  const gl = engine.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info'), px = new Uint8Array(4), t0 = performance.now();
  engine.step(1 / 60, { render: true, describe: false });
  gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  window.doctor = { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
    drawn: px[0] > 120 && px[0] > 1.6 * px[1] && px[0] > 1.6 * px[2], pixel: [...px], frameMs: Math.round((performance.now() - t0) * 10) / 10 };
} catch (e) { window.doctor = { error: String(e?.message ?? e) }; }
`);
  const { createServer } = await import('vite');
  const server = await createServer({ root: page, configFile: false, logLevel: 'silent', cacheDir: join(page, '.vite'), server: { port: 0, host: '127.0.0.1', strictPort: false } });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${server.httpServer.address().port}/`;
  // Each path launched with its own CHROMIUM_ARGS entry directly (no fallback), so the report says what each path really gets
  const frame = async kind => {
    let b;
    try {
      b = await chromium.launch({ args: CHROMIUM_ARGS[kind] });
      const p = await b.newPage();
      await p.goto(url, { timeout: 60000 });
      await p.waitForFunction(() => window.doctor, null, { timeout: 60000 });
      return await p.evaluate(() => window.doctor);
    } catch (e) { return { error: String(e?.message ?? e).split('\n')[0] }; }
    finally { await b?.close().catch(() => {}); }
  };
  try {
    // the launch itself is the install check: executablePath() names the full chromium, while headless launches use the headless shell
    const sw = verdict.render.software = await frame('software');
    if (/Executable doesn't exist|npx playwright install/.test(sw.error ?? '')) no('Playwright chromium is not installed', 'run npx playwright install chromium');
    else if (sw.error) no(`the engine cannot render a frame with software rendering (tests use it): ${sw.error}`, 'update the graphics driver; if that fails, reinstall the browser: npx playwright install chromium --force');
    else if (!sw.drawn) no(`software rendering ran but the frame came out wrong (center pixel ${sw.pixel}, renderer ${sw.renderer})`, 'reinstall the browser: npx playwright install chromium --force');
    else ok(`engine frame rendered with software rendering (${sw.renderer}, ${sw.frameMs} ms): tests run on this, the same pixels on every machine`);
    const gpu = verdict.render.gpu = await frame('gpu');
    const hw = verdict.render.hardwareGpu = !gpu.error && gpu.drawn && !SOFTWARE_RENDERER.test(gpu.renderer);
    if (hw) ok(`a hardware GPU is available to headless (${gpu.renderer}, ${gpu.frameMs} ms): shot, gallery --shots, perf and stress use it; tests use it too, except those that read pixels (they stay on software)`);
    else info(`no hardware GPU reachable headless (${gpu.error ?? (gpu.drawn ? gpu.renderer : `frame came out wrong on ${gpu.renderer}`)}): shot / gallery / perf / stress fall back to software rendering (slower, GPU ms not real). ` +
      'Normal on CI and remote machines; on a desktop update the graphics driver' + (process.platform === 'linux' ? ' and install the Mesa Vulkan driver (mesa-vulkan-drivers)' : ''));
    const best = hw ? gpu : sw;
    if (best.timer) ok(`GPU timer (EXT_disjoint_timer_query_webgl2) on the ${hw ? 'GPU' : 'software'} path: stress and perf report GPU ms`);
    else info(`GPU timer (EXT_disjoint_timer_query_webgl2) not available on the ${hw ? 'GPU' : 'software'} path: stress reports frame time only; games and tests are unaffected`);
    const forced = forcedRender();
    if (forced) info(`THREEDOG_RENDER / a flag forces ${forced} rendering for every browser the tools launch${forced === 'gpu' ? ' (tests included: pixel comparisons may then differ)' : ''}`);
  } finally { await server.close(); rmSync(page, { recursive: true, force: true }); }
}

verdict.healthy = bad === 0;
if (json) console.log(JSON.stringify(verdict, null, 1));
else console.log(bad ? `\n${bad} problems, follow the fixes after "→"` : '\nAll passed');
process.exit(bad && !ci ? 1 : 0);
