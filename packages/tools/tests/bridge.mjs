// Dev bridge test: npm test -- dev bridge
// Starts a real dev server on the engine package (its index page is the world example; a free port) and hits it with the real threedog command
//   line: the headless fallback page and a real browser page, pending commands failing fast on reload, the security checks of the bridge and of the
//   error relay, and that the build output contains no bridge. Expected values are read from describe() first, never hard-coded.
// Waits poll a condition with a deadline; no fixed sleeps.
import { createServer, build } from 'vite';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TOOLS, ROOT, ENGINE } from '../paths.mjs';
import { waitEngine } from '../wait-engine.mjs';
import { until, securityCases } from '../lib/bridge-cases.mjs';

export const name = 'dev bridge: threedog command line drives the dev page';

const CLI = join(TOOLS, 'threedog/cli.mjs');
/** Run one command line, returning { out, code }. Must be async: the dev server lives in this process, so waiting synchronously would deadlock */
const threedog = (...args) => new Promise(res => execFile(process.execPath, [CLI, ...args, '-w', 'engine'],
  { cwd: ROOT, encoding: 'utf8' }, (err, out) => res({ out: out.trim(), code: err ? err.code : 0 })));
export async function run({ check, browser }) {
  const dir = ENGINE;
  // 1. No dev server: tell the user to start it first (skipped when someone is running dev on the engine right now)
  if (!existsSync(join(dir, '.threedog/dev.json'))) {
    const r = spawnSync(process.execPath, [CLI, 'describe', '-w', 'engine'], { cwd: ROOT, encoding: 'utf8' });
    check('without a dev server it says to run npm run dev first', r.status === 1 && r.stdout.includes('npm run dev'), r.stdout);
  }

  const server = await createServer({ root: dir, configFile: join(dir, 'vite.config.js'), server: { port: 0, host: 'localhost' }, logLevel: 'error' });
  await server.listen();
  try {
    const dev = JSON.parse(readFileSync(join(dir, '.threedog/dev.json'), 'utf8'));
    check('after start .threedog/dev.json is written (port + token)', dev.port && dev.token?.length >= 16);

    // 2. Headless fallback page (no real browser connected)
    const d = (await threedog('describe'));
    const startClock = (await threedog('describe', 'time.clock')).out.replace(/"/g, '');
    check('describe: compact plus the state line', d.code === 0 && d.out.includes('Player') && d.out.split('\n').length <= 4 && d.out.length < 600
      && /Headless page paused, tick \d+/.test(d.out), d.out);
    check('describe --full: the full text', (await threedog('describe', '--full')).out.includes('[Game state]'));
    check('describe path: one item', /^\d\d:\d\d$/.test(startClock), startClock);
    const clockOf = async () => (await threedog('eval', 'engine.describe().time.elapsed')).out.replace('✓ ', '');
    const t0 = +await clockOf(), s = (await threedog('step', '2'));
    check('step 2: advances 2 seconds', s.out.startsWith('✓ Stepped 2 s') && Math.abs(+await clockOf() - t0 - 2) < 0.1, s.out);
    await threedog('state', 'cutscene=skip');   // the game's opening camera (5 s) takes Esc as "skip" while it plays
    const p = (await threedog('press', 'menu'));
    check('press menu: the settings window opens', p.out.includes('settings'), p.out);
    (await threedog('press', 'menu'));
    check('press again: it closes', !(await threedog('describe')).out.includes('settings'));
    check('press an unknown action: lists the available actions', (await threedog('press', 'nope')).out.includes('Unknown'));
    const where = async () => JSON.parse((await threedog('describe', 'player.position')).out);
    const before = await where(), h = (await threedog('hold', 'moveForward', '1')), after = await where();
    check('hold: the player position changes', h.out.startsWith('✓ Held moveForward') && Math.hypot(after.x - before.x, after.z - before.z) > 0.3,
      `${h.out} ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    check('state: change time and weather', (await threedog('state', 'time=12:00', 'weather=rain')).out.includes('12:00'));
    check('eval: expression / statements / error', (await threedog('eval', '1 + 1')).out === '✓ 2' && (await threedog('eval',
      'const a = 3; return a * 2')).out === '✓ 6' && (await threedog('eval', 'engine.nope.x')).code === 1);
    check('eval: await works (expression and multi-line statements)', (await threedog('eval',
      'await Promise.resolve(7)')).out === '✓ 7' && (await threedog('eval', 'const a = await Promise.resolve(4); return a + 1')).out === '✓ 5');
    const script = join(tmpdir(), 'threedog-bridge-js-test.js');
    writeFileSync(script, 'const a = 20;\nconst b = await Promise.resolve(1);\nreturn a + b;\n');
    check('js alias / --file: reads a multi-line script from a file', (await threedog('js', '1 + 2')).out === '✓ 3' && (await threedog('js',
      '--file', script)).out === '✓ 21' && (await threedog('eval', '--file', 'nope.js')).out.includes('Script file not found'));
    rmSync(script, { force: true });
    const rawClock = async () => +(await threedog('eval', 'engine.elapsed')).out.replace('✓ ', ''),
      tp0 = await rawClock(); await threedog('press', 'KeyJ', '--for', '0.02'); const tp1 = await rawClock();
    check('press --for 0.02: advances only about 0.04 s (default 0.117 s)', tp1 - tp0 > 0.03 && tp1 - tp0 < 0.06, `${tp0} ${tp1}`);
    // op / ops: run a game op from the command line; values are converted by the op's args shape
    await threedog('js', `engine.ops.define('test.take', { args: { item: 'string', n: 'int?' }, reasons: { notEnough: 'Not enough' },
      can: (e, { item, n = 1 }) => e.inventory.count(item) >= n || 'notEnough', run: (e, { item, n = 1 }) => { e.inventory.remove(item, n); return n; },
      offers: () => [{ item: 'film' }] }); engine.inventory.add('film', 3, { silent: true }); return 1`);
    const o1 = await threedog('op', 'test.take', 'item=film', 'n=2'), o2 = await threedog('op', 'test.take', 'item=film', 'n=999');
    check('op: success shows the value and the bag; n=2 becomes a number', o1.code === 0 && o1.out.startsWith('✓ test.take → 2 · Bag')
      && /film×[0-9]/.test(o1.out), o1.out);
    check('op: failure exits 1 with the reason and its note', o2.code === 1 && o2.out.startsWith('✗ test.take: notEnough (Not enough)'), o2.out);
    const ol = await threedog('ops'), typo = await threedog('op', 'test.tkae');
    check('ops: lists offers checked with can; a wrong op name suggests the right one', ol.out.includes('✓ test.take item=film') && typo.code === 1
      && /did you mean.*test\.take/.test(typo.out), ol.out + ' | ' + typo.out);
    const oh = (await threedog('js', "engine.ops.recent('test.take').map(h => h.source + '/' + h.phase).join()")).out;
    check('[guard] op runs are logged with source bridge, phase between', oh === '✓ "bridge/between,bridge/between"', oh);
    const ex = await threedog('explain', 'op', 'test.take', 'item=film', 'n=999', '--full'), ins = await threedog('inspect');
    const scDir = join(dir, 'tests', 'scenarios'), scFile = join(scDir, 'tmp-bridge.json'), hadDir = existsSync(scDir);
    let sc, vf;
    try {
      mkdirSync(scDir, { recursive: true });
      writeFileSync(scFile, JSON.stringify({ name: 'tmp',
        steps: [{ op: 'test.take', args: { item: 'film', n: 999 }, expect: 'notEnough' }, { expect: { 'ui.dialogue': null } }] }));
      sc = await threedog('scenario', 'tmp-bridge');
      vf = await threedog('verify', 'tmp-bridge');
    } finally { rmSync(hadDir ? scFile : scDir, { recursive: true, force: true }); }
    check('explain op / inspect / scenario: why not with the note, offers with reasons, a scenario file runs on the page',
      ex.code === 1 && /notEnough \(Not enough\)[\s\S]*last attempt/.test(ex.out) && ins.out.includes('test.take item=film') && sc.code === 0
        && /scenario tmp-bridge: 2 checks passed/.test(sc.out), [ex.out, ins.out, sc.out].join(' | '));
    check('verify: PASS, tested and not tested', vf.code === 0 && /verify tmp-bridge: PASS/.test(vf.out) && vf.out.includes('Tested: ops test.take') && vf.out.includes('Not tested:'), vf.out);
    // loading: the same view as describe().loading; a degradable missing file shows as a failure with path and fallback, exit code 1
    await threedog('js', "engine.assets.manifest({ name: 'bridge-test', textures: { bridgeMissing: '/textures/bridge-missing.png' } }); await " +
      "engine.assets.texture('bridgeMissing'); return 1");
    const ld = await threedog('loading'), one = await threedog('loading', 'bridgeMissing');
    check('loading: lists the failed file with its fallback and a hint; loading name shows the source manifest',
      ld.code === 1 && /fell back texture "bridgeMissing" \/textures\/bridge-missing\.png/.test(ld.out) && ld.out.includes('Possible cause')
        && one.out.includes('"manifest": "bridge-test"'), ld.out + ' | ' + one.out.slice(0, 200));
    const bad = await threedog('state', 'pos=1', '-8'), bad2 = await threedog('state', 'pos=1');
    check('state: a PowerShell comma split into an array errors and says to quote',
      bad.code === 1 && bad.out.includes('"pos=1,-8"') && bad2.code === 1 && bad2.out.includes('x,z'), bad.out + bad2.out);
    const pp = await threedog('describe', 'player.position');
    check('describe player.position: gives numeric coordinates', (() => { try { const v = JSON.parse(pp.out); return [v.x,
      v.y, v.z].every(Number.isFinite); } catch { return false; } })(), pp.out);
    const snap = (await threedog('snap', 'bridge-test'));
    const png = join(dir, '.threedog/shots/bridge-test.png');
    check('snap: writes a PNG', snap.code === 0 && existsSync(png) && statSync(png).size > 1000 && readFileSync(png).subarray(1,
      4).toString() === 'PNG', snap.out);
    (await threedog('errors'));   // move the cursor to now first
    (await threedog('eval', "setTimeout(() => { throw new Error('bridge test deliberate error'); }, 0)"));
    const er = await until(async () => { const r = await threedog('errors'); return r.out.includes('deliberate') && r; })
      || { out: '(no error arrived)', code: 0 };
    check('errors: reads the new error, the next read is empty',
      er.code === 1 && er.out.includes('bridge test deliberate error') && (await threedog('errors')).out.includes('No new errors'), er.out);
    (await threedog('eval', "setTimeout(() => { throw new Error('world data must be plain values (number, string): x is a function'); }, 0)"));
    const er2 = await until(async () => { const r = await threedog('errors'); return r.out.includes('plain values') && r; }) || { out: '(no error arrived)' };
    const lt1 = await threedog('errors', 'latest'), lt2 = await threedog('errors', 'latest'), cur = /Cursor E(\d+)/.exec(lt1.out)?.[1];
    const sn0 = await threedog('errors', '--since', String(Math.max(0, +cur - 2))), sn1 = await threedog('errors', '--since', cur ?? '0');
    check('errors latest: repeatable, with id and tick; --since lists only later ones',
      lt1.code === 1 && lt1.out.includes('deliberate') && lt1.out === lt2.out && /E\d+ \d\d:\d\d:\d\d tick \d+/.test(lt1.out) && sn0.out.includes('deliberate')
        && sn1.out.includes('No errors since E' + cur), [lt1.out, sn1.out].join(' | '));
    check('errors: a known error class comes with the likely cause and the doc page',
      er2.out.includes('Possible cause:') && er2.out.includes('Read: recipes/18-world.md'), er2.out);
    const sd = join(dir, 'tests/snapshots/bridge-test.describe.json');
    try {
      const saved = await threedog('snap-describe', 'save', 'bridge-test', '--only', 'player,ui');
      check('snap-describe save: writes the baseline file', saved.code === 0 && existsSync(sd), saved.out);
      check('snap-describe diff: same state matches', (await threedog('snap-describe', 'diff', 'bridge-test', '--only', 'player,ui')).out.startsWith('✓'));
      await threedog('state', 'pos=40,-20');
      const df = await threedog('snap-describe', 'diff', 'bridge-test', '--only', 'player,ui');
      check('snap-describe diff: after the player moved it prints the changed field as text and the update command',
        df.code === 1 && /player\.x: .* -> .*changed/.test(df.out) && df.out.includes('snap-describe save bridge-test'), df.out);
      check('snap-describe: no name gives usage', (await threedog('snap-describe', 'diff')).out.includes('Usage'));
    } finally { rmSync(sd, { force: true }); }
    check('reload: after reloading the scenario is back to its initial state',
      (await threedog('reload')).code === 0 && (await threedog('describe')).out.includes(startClock), startClock);

    // 3. A real browser page (over the HMR WebSocket)
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.goto(`http://localhost:${dev.port}/`);
    await page.waitForFunction(() => window.engine?.stateApplied, null, { timeout: 90000 });
    // commands go to the real page once its hello arrived (the headless page has ?threedog-headless in its URL)
    await until(async () => !(await threedog('eval', 'location.search')).out.includes('threedog-headless'));
    const live = (await threedog('step', '1'));
    check('real page: step pauses first and says to resume', live.out.includes('threedog resume') && await page.evaluate(() => engine.paused), live.out);
    check('real page: the command takes effect on this page', (await page.evaluate(() => engine.describe().time.elapsed)) > 0);
    check('real page: snap can capture (canvas only)', (await threedog('snap',
      'bridge-live')).code === 0 && existsSync(join(dir, '.threedog/shots/bridge-live.png')));
    check('real page: resume restores real time', (await threedog('resume')).code === 0 && !(await page.evaluate(() => engine.paused)));
    // a command still running when its page reloads fails at once, not after the 2-minute timeout
    const tr = Date.now(), hang = threedog('eval', 'window.__hang = true; return new Promise(() => {})');
    await until(() => page.evaluate(() => window.__hang));
    await page.reload();
    const hung = await hang;
    check('real page: a pending command fails fast when the page reloads', hung.code === 1 && /reloaded or closed/.test(hung.out) && Date.now() - tr < 30000, `${hung.out} (${Date.now() - tr} ms)`);
    await page.close();

    await securityCases({ check, dev, dir });
  } finally {
    await server.close();
  }
  check('after the dev server closes dev.json is removed', !existsSync(join(dir, '.threedog/dev.json')));

  // The engine wait timeout must give the reason: no window.engine attached / attached but not ready
  const bare = await browser.newPage();
  await bare.setContent('<html><body></body></html>');
  const why1 = await waitEngine(bare, { grace: 300, timeout: 600, errors: ['deliberate error'] }).then(() => '', e => e.message);
  check('engine wait timeout: without window.engine it gives the reason, the fix and the latest errors',
    why1.includes('missing') && why1.includes('window.engine = engine') && why1.includes('deliberate error'), why1);
  await bare.evaluate(() => { window.engine = { ready: false }; });
  const why2 = await waitEngine(bare, { grace: 300, timeout: 600 }).then(() => '', e => e.message);
  check('engine wait timeout: attached but not ready says ready=false', why2.includes('engine.ready=false') && why2.includes('engine.start()'), why2);
  await bare.close();

  // 5. No bridge in the build output
  const out = mkdtempSync(join(tmpdir(), 'threedog-bridge-'));
  try {
    await build({ root: dir, configFile: join(dir, 'vite.config.js'), build: { outDir: out, emptyOutDir: true }, logLevel: 'error' });
    const files = readdirSync(out, { recursive: true, withFileTypes: true }).filter(f => f.isFile() && /\.(js|html)$/.test(f.name));
    const hit = files.filter(f => /threedog-bridge|__threedog\/cmd|threedog:hello/.test(readFileSync(join(f.parentPath, f.name), 'utf8')));
    check('the build output contains no bridge code', files.length > 0 && hit.length === 0, hit.map(f => f.name).join(', '));
  } finally { rmSync(out, { recursive: true, force: true }); }
}
