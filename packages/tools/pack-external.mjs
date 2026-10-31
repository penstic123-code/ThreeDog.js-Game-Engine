// Outside-the-repo install check (release reliability). npm pack the engine and tools packages, install the tarballs into a fresh temp project
// outside this repository (so nothing resolves through workspaces or the monorepo layout), then check what a real user gets:
//   1. package contents: the tarballs carry what is needed (docs, workers, style types) and nothing internal (tests)
//   2. types: a // @ts-check file with a three.js method typo, a wrong vector argument type and an engine option typo gives exactly those
//      three tsc errors; the correct main.js gives none (skipLibCheck off, so the engine's own declarations are checked too)
//   3. vite build + vite preview of a minimal game: page opens, engine.ready, no 4xx/5xx (Workers, wasm, decoders, assets), no console errors
//   4. the threedog CLI works in that project: map (GAMEMAP with package-relative paths), check, test (smoke), dev + one bridge command
// Shipped doc references are checked by rule R18 in the repository (no packages/ paths, every named file exists).
// Run: npm test -- pack-external   (needs network or a warm npm cache for third-party dependencies; takes a few minutes)
//      node packages/tools/pack-external.mjs [--keep]   standalone; --keep leaves the temp project for inspection
import { spawn, spawnSync, execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { ENGINE, TOOLS } from './paths.mjs';
import { waitEngine } from './wait-engine.mjs';
import { npm as npmRun } from './lib/proc.mjs';
import { newGamePage } from './browser.mjs';

const MAIN = `// @ts-check
import { createEngine, openWorld, THREE } from 'threedog';
import lowpoly from 'threedog/styles/lowpoly';

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const engine = createEngine({ canvas, style: lowpoly });
engine.use(openWorld({ seed: 7 }));
engine.characters.createPlayer();
const up = new THREE.Vector3(0, 1, 0).normalize();
engine.camera.lookAt(up);
/** @type {any} */ (window).engine = engine;
await engine.start();
`;
// Line numbers matter: the test expects errors on lines 5, 6 and 7
const BAD = `// @ts-check
import { createEngine, THREE } from 'threedog';
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
const v = new THREE.Vector3();
v.normalise();
v.set('1', 2, 3);
createEngine({ canvas, styel: {} });
`;
const TSCONFIG = { compilerOptions: { target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler',
  allowJs: true, checkJs: true, noEmit: true, skipLibCheck: false,
  types: [] }, include: ['main.js'] };   // types: [] so unrelated global @types pulled in by tool dependencies are not loaded; @types/three still arrives through 'three' imports

// npm and node both run without a shell (lib/proc.mjs)
const npm = (args, cwd) => npmRun(args, { cwd, timeout: 600000 });
const node = (args, cwd) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 600000 });
/** The installed threedog CLI in the temp project; async, so a dev server in another process keeps running */
const cli = (app, ...args) => new Promise(res => execFile(process.execPath, [join(app, 'node_modules/@threedog/tools/bin/threedog.mjs'), ...args],
  { cwd: app, encoding: 'utf8', timeout: 900000 }, (err, out, errOut) => res({ code: err ? err.code ?? 1 : 0, out: (out + errOut).trim() })));
const freePort = () => new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

/** npm pack one package into dest; returns the npm pack --json entry ({ filename, files: [{ path }] }) */
function pack(dir, dest) {
  const r = npm(['pack', '--json', '--pack-destination', dest], dir);
  if (r.status !== 0) throw new Error(`npm pack failed in ${dir}: ${r.stderr.slice(0, 300)}`);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0];
}

/** tsc errors as "file(line,col): error TSxxxx: …" lines */
function tsc(app, project) {
  const r = node([join(app, 'node_modules/typescript/bin/tsc'), '-p', project, '--pretty', 'false'], app);
  return (r.stdout + r.stderr).split(/\r?\n/).filter(l => /error TS\d+/.test(l));
}

/** Start vite preview and resolve with its base URL once it answers */
async function preview(app, port) {
  const proc = spawn(process.execPath, [join(app, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: app });
  let log = ''; proc.stdout.on('data', d => log += d); proc.stderr.on('data', d => log += d);
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/')).ok) return { proc, base }; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  proc.kill();
  throw new Error('vite preview did not answer: ' + log.slice(-300));
}

export async function packExternal({ check, browser, keep = false }) {
  const tmp = mkdtempSync(join(tmpdir(), 'threedog-ext-'));
  const app = join(tmp, 'app');
  let server;
  try {
    // 1. pack and look at the contents
    const eng = pack(ENGINE, tmp), tools = pack(TOOLS, tmp);
    const engFiles = eng.files.map(f => f.path), toolFiles = tools.files.map(f => f.path);
    const need = ['index.js', 'index.d.ts', 'README.md', 'docs/AI.md', 'styles/lowpoly/index.js', 'styles/lowpoly/index.d.ts', 'core/errorHints.js', 'core/pureWorker.js', 'modules/terrain/chunkWorker.js'];
    check('engine tarball has entry points, types, docs, workers', need.every(f => engFiles.includes(f)), need.filter(f => !engFiles.includes(f)).join(', '));
    check('engine tarball has no tests/ or public/', !engFiles.some(f => /^(tests|public)\//.test(f)), engFiles.filter(f => /^(tests|public)\//.test(f)).slice(0, 3).join(', '));
    check('tools tarball has the CLI and vite preset, no tests/', toolFiles.includes('bin/threedog.mjs') && toolFiles.includes('vite/gameConfig.js') && !toolFiles.some(f => f.startsWith('tests/')));
    check('both tarballs carry LICENSE; the engine carries llms.txt', engFiles.includes('LICENSE') && toolFiles.includes('LICENSE') && engFiles.includes('llms.txt'),
      ['LICENSE', 'llms.txt'].filter(f => !engFiles.includes(f)).concat(toolFiles.includes('LICENSE') ? [] : ['tools LICENSE']).join(', '));

    // 2. a fresh project that installs the tarballs like a user would
    mkdirSync(app);
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'threedog-external-check', private: true, type: 'module',
      scripts: { test: 'threedog test', check: 'threedog check', map: 'threedog map' }, dependencies: { threedog: `file:../${eng.filename}`, three: '~0.187.0' }, devDependencies: { '@threedog/tools': `file:../${tools.filename}` } }, null, 2));
    writeFileSync(join(app, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>external</title></head><body style="margin:0"><canvas id="view"></canvas><script type="module" src="./main.js"></script></body></html>\n');
    writeFileSync(join(app, 'main.js'), MAIN);
    writeFileSync(join(app, 'bad.js'), BAD);
    writeFileSync(join(app, 'vite.config.js'), "import { gameConfig } from '@threedog/tools/vite';\nexport default gameConfig(import.meta.dirname);\n");
    writeFileSync(join(app, 'tsconfig.json'), JSON.stringify(TSCONFIG, null, 2));
    writeFileSync(join(app, 'tsconfig.bad.json'), JSON.stringify({ extends: './tsconfig.json', include: ['bad.js'] }));
    const inst = npm(['install', '--no-audit', '--no-fund', '--loglevel=error'], app);
    check('npm install of the tarballs succeeds', inst.status === 0, (inst.stderr || String(inst.error)).slice(0, 300));
    if (inst.status !== 0) return;
    const deep = existsSync(join(app, 'node_modules/threedog/node_modules/three'));
    check('one copy of three (peer dependency, not nested under threedog)', !deep);

    // 3. types
    const good = tsc(app, 'tsconfig.json');
    check('types: correct main.js has 0 tsc errors', good.length === 0, good.slice(0, 3).join(' | '));
    const bad = tsc(app, 'tsconfig.bad.json');
    const at = n => bad.some(l => l.startsWith(`bad.js(${n},`));
    check('types: three.js method typo (v.normalise) is an error', at(5) && bad.some(l => /normalise/.test(l)), bad.join(' | '));
    check('types: wrong vector argument type (v.set(\'1\', …)) is an error', at(6), bad.join(' | '));
    check('types: engine option typo (styel) is an error', at(7) && bad.some(l => /styel/.test(l)), bad.join(' | '));
    check('types: no other errors', bad.length === 3, bad.join(' | '));

    // 4. the CLI in a game outside the monorepo (paths.mjs game mode)
    writeFileSync(join(app, 'DESIGN.md'), '# external: design\n\n**Pitch**: a test game. Read `node_modules/threedog/docs/AI.md`.\n');
    const map = await cli(app, 'map'), gm = existsSync(join(app, 'GAMEMAP.md')) ? readFileSync(join(app, 'GAMEMAP.md'), 'utf8') : '';
    check('cli: threedog map writes GAMEMAP.md with game-relative and node_modules/threedog/docs paths', map.code === 0 && gm.includes('node_modules/threedog/docs/') && !gm.includes('packages/'), map.out.slice(-300));
    const chk = await cli(app, 'check');
    check('cli: threedog check passes (game checks only)', chk.code === 0 && /GAMEMAP\.md is up to date/.test(chk.out), chk.out.split('\n').filter(l => /✗|error/i.test(l)).slice(0, 4).join(' | ') || chk.out.slice(-300));
    if (browser) {
      // the browser build that matches the playwright version npm just installed (a no-op when it is already there), as a user's first run does
      const pw = node([join(app, 'node_modules/playwright/cli.js'), 'install', 'chromium'], app);
      const t = await cli(app, 'test');
      check('cli: threedog test runs the smoke test and passes', t.code === 0 && /smoke: /.test(t.out) && /0 failed/.test(t.out),
        (pw.status ? `playwright install: ${(pw.stdout + pw.stderr).slice(-200)} | ` : '') + t.out.split('\n').filter(l => /✗|Error|Executable|install|Total/.test(l)).slice(0, 5).join(' | '));
      const z = await cli(app, 'test', 'zzz-no-such-test');
      check('cli: a test filter that matches nothing fails', z.code === 1 && /no test name contains/.test(z.out), z.out.slice(-200));
      // dev server + one bridge command (the bridge opens its own headless page)
      const port = await freePort();
      const dev = spawn(process.execPath, [join(app, 'node_modules/@threedog/tools/bin/threedog.mjs'), 'dev', '--port', String(port), '--strictPort'], { cwd: app });
      let devLog = ''; dev.stdout.on('data', d => devLog += d); dev.stderr.on('data', d => devLog += d);
      try {
        for (let i = 0; i < 120 && !existsSync(join(app, '.threedog/dev.json')); i++) await new Promise(r => setTimeout(r, 250));
        const d = await cli(app, 'describe');
        check('cli: threedog dev starts and threedog describe reads the page', d.code === 0 && /Player/.test(d.out), (d.out || devLog).slice(-300));
      } finally { if (dev.exitCode === null) await new Promise(r => { dev.once('exit', r); dev.kill(); }); }
    }

    // 5. production build + preview in a browser
    const b = node([join(app, 'node_modules/vite/bin/vite.js'), 'build'], app);
    check('vite build succeeds', b.status === 0, (b.stdout + b.stderr).split('\n').filter(l => /error/i.test(l)).slice(0, 3).join(' | '));
    if (b.status !== 0 || !browser) return;
    const { proc, base } = await preview(app, await freePort());
    server = proc;
    const errors = [], badRes = [];
    const page = await newGamePage(browser, { errors });
    page.on('response', r => { if (r.status() >= 400) badRes.push(`${r.status()} ${r.url().replace(base, '')}`); });
    page.on('requestfailed', r => badRes.push(`failed ${r.url().replace(base, '')}`));
    try {
      await page.goto(base + '/');
      await waitEngine(page, { field: 'ready', errors });
      // a few more frames: Worker / physics / navmesh errors often only show up after startup
      await page.evaluate(() => new Promise(r => { let k = 0; const h = window['engine'].onFrame(() => { if (++k >= 5) { h.remove(); r(); } }); }));
      check('preview: page opens, engine.ready is true', true);
    } catch (e) { check('preview: page opens, engine.ready is true', false, String(e).split('\n')[0]); }
    check('preview: no failed resource loads (Workers, wasm, decoders, assets)', badRes.length === 0, badRes.slice(0, 3).join(' | '));
    check('preview: no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await page.close();
  } finally {
    // wait for preview to exit: on Windows its open handles keep the temp folder locked (EBUSY) for a moment
    if (server && server.exitCode === null) await new Promise(r => { server.once('exit', r); server.kill(); });
    if (keep) console.log('temp project kept: ' + app);
    else try { rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
    catch (e) { console.log(`(could not delete temp project ${tmp}: ${e.code}; the OS temp cleanup will)`); }
  }
}

// Standalone: node packages/tools/pack-external.mjs [--keep]
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { launchBrowser } = await import('./browser.mjs');
  const browser = await launchBrowser();
  let fail = 0;
  await packExternal({ browser, keep: process.argv.includes('--keep'),
    check: (label, ok, detail = '') => { if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? '  → ' + detail : ''}`); } });
  await browser.close();
  process.exit(fail ? 1 : 0);
}
