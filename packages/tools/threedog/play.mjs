// threedog play | status | play --stop: start the game for the AI and answer "is it up, is it ready" in one call.
//   play     finds the workspace (cwd or -w), starts the dev server if none runs (detached, output in .threedog/dev.log), waits until the dev bridge
//            answers and the engine is ready, then says the page address and whether a headless or a live browser page is connected
//   status   ready / loading / page errors / paused state in two lines; when it cannot answer, which of four causes it is (diagnose.mjs)
//   play --stop   stops the server that play started (a server started by hand is closed in its own terminal)
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../paths.mjs';
import { bridgeDriver } from './connect.mjs';
import { probe, diagnose } from './diagnose.mjs';
import { readRuntime } from './runtime.mjs';
import { allErrors, isError } from './errorlog.mjs';
import { oneLine } from '../lib/oneline.mjs';
import { devServerInfo, pidAlive } from '../devinfo.mjs';

const BIN = join(TOOLS, 'bin/threedog.mjs'), wait = ms => new Promise(r => setTimeout(r, ms));
const playFile = dir => join(dir, '.threedog/play.json');
const tail = (file, n = 6) => { try { return readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).slice(-n).join('\n'); } catch { return ''; } };

/** Start the dev server of this workspace in the background; resolves { child, exited: () => code | null } */
function startServer(dir) {
  mkdirSync(join(dir, '.threedog'), { recursive: true });
  const log = join(dir, '.threedog/dev.log'), fd = openSync(log, 'w');
  const child = spawn(process.execPath, [BIN, 'dev'], { cwd: dir, detached: true, windowsHide: true, stdio: ['ignore', fd, fd],
    env: { ...process.env, THREEDOG_AUTOSTOP_MIN: process.env.THREEDOG_AUTOSTOP_MIN || '30' } });   // a server play started exits by itself after 30 idle min (the bridge reads this)
  closeSync(fd);
  let code = null;
  child.on('exit', c => { code = c ?? 1; });
  child.unref();
  writeFileSync(playFile(dir), JSON.stringify({ pid: child.pid }));
  return { exited: () => code, log };
}

/** Wait until the readiness answer comes; ms is how long to wait for the engine */
async function ready(dir, driver, ms) {
  const { runtime, raw } = await readRuntime(driver, ms);
  return { runtime, raw, up: !!raw?.attached };
}

export async function play(dir, { page, stop, timeout = 90000 } = {}) {
  if (stop) return stopServer(dir);
  let p = await probe(dir), started = false;
  // a default-port server found by scanning may be another project's: it does not stop this workspace from starting its own; one named in dev.json does
  if (p.state === 'missing' && !p.scanned) return { ok: false, ...await diagnose(dir) };
  if (p.busy) return { ok: false, ...await diagnose(dir) };   // alive but slow: a second server on top of it helps nobody
  if (p.scanned) p = { state: 'none' };
  if (p.state === 'none') {
    const srv = startServer(dir);
    started = true;
    const until = Date.now() + timeout;
    while (p.state !== 'ok' && Date.now() < until && srv.exited() === null) { await wait(500); p = await probe(dir); }
    if (p.state !== 'ok') {
      const out = tail(srv.log), code = srv.exited();
      return { ok: false, kind: code === null ? 'starting' : 'no-server', text: code === null
        ? `✗ The dev server was started but is not up after ${Math.round(timeout / 1000)} s (vite is still compiling or waiting).\nNext: wait, then threedog status.`
        : `✗ The dev server exited while starting (code ${code}).\n${out}\nNext: fix what the output above says, then threedog play again.` };
    }
  }
  const driver = bridgeDriver(dir, { page }), r = await ready(dir, driver, timeout);
  if (!r.up) return { ok: false, ...(await diagnose(dir, new Error('timed out waiting for the engine'))) };
  const url = `http://localhost:${p.port}${page ?? '/'}`;
  const how = r.raw.headless ? 'headless page connected (open the address in a browser for a live one)' : 'live browser page connected';
  return { ok: r.runtime.ready, runtime: r.runtime, data: { url, port: p.port, startedHere: started, headless: r.raw.headless },
    text: `${r.runtime.ready ? '✓' : '…'} Game at ${url} · dev server ${started ? 'started now' : 'already running'} · bridge connected · ${how}` };
}

export async function status(dir, { page } = {}) {
  const p = await probe(dir);
  if (p.state !== 'ok') return { ok: false, ...await diagnose(dir) };
  const { runtime, raw } = await readRuntime(bridgeDriver(dir, { page }), 25000);
  if (!raw?.attached) return { ok: false, ...(await diagnose(dir, new Error('timed out waiting for the engine'))) };
  const errs = allErrors(dir).filter(isError), last = errs.at(-1), lv = raw.loading;
  const loading = !lv ? 'no loading info' : lv.blocked ? 'startup BLOCKED by a failed asset' : lv.done ? `loading done${lv.failed ? `, ${lv.failed} asset${lv.failed === 1 ? '' : 's'} fell back` : ''}`
    : `still loading (waiting: ${lv.waiting})`;
  const bad = !runtime.ready || lv?.blocked || errs.length > 0;
  const head = `${bad ? '✗' : '✓'} ${runtime.ready ? 'Ready' : 'Not ready'}: ${loading}, ${errs.length ? `${errs.length} page error${errs.length === 1 ? '' : 's'}` : 'no page errors'}`;
  const rs = raw.run, run = rs ? `
Run state: ${rs.state === 'paused' ? `paused(by ${rs.owners.join(', ')})` : rs.state}` : '';
  return { ok: !bad, runtime, data: { port: p.port, loading: lv, run: rs, errors: { count: errs.length, latest: last ?? null } },
    text: `${head}${last ? ` (latest E${last.id}: ${oneLine(last.message)}; threedog errors latest)` : ''}${run}` };
}

export async function stopServer(dir) {
  const own = (() => { try { return JSON.parse(readFileSync(playFile(dir), 'utf8')).pid; } catch { return null; } })();
  if (!own) {
    // a server started by hand stays up, but the headless browser its bridge opened (e.g. for threedog status) is closed: that one burns CPU
    if ((await probe(dir)).state !== 'ok') return { ok: false, text: '✗ No dev server of this workspace is running, nothing to stop.' };
    const closed = await bridgeDriver(dir).closeHeadless().catch(() => false);
    return { ok: true, text: `✓ ${closed ? 'Closed the headless browser the dev bridge had opened' : 'No headless browser was open'}; `
      + 'the dev server was not started by threedog play, so it keeps running.\nNext: to stop it, close the terminal where you ran npm run dev.' };
  }
  // Kill only a process the dev bridge itself vouches for (it answers with the token in dev.json): a recorded pid alone may have been reused by an unrelated program
  const live = (await probe(dir)).state === 'ok', pids = live ? [own, devServerInfo(dir).pid] : [];
  if (!live) {
    for (const f of [playFile(dir), join(dir, '.threedog/dev.json')]) rmSync(f, { force: true });
    return { ok: true, text: `✓ No dev server of this workspace answers any more (the record was removed${pidAlive(own) ? `; pid ${own} is alive but is not confirmed as the dev server, so it was left alone` : ''}).` };
  }
  for (const pid of new Set(pids.filter(Boolean))) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  }
  for (const f of [playFile(dir), join(dir, '.threedog/dev.json')]) rmSync(f, { force: true });
  return { ok: true, text: '✓ Dev server stopped (the headless browser it opened closes with it).' };
}
