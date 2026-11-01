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

const BIN = join(TOOLS, 'bin/threedog.mjs'), wait = ms => new Promise(r => setTimeout(r, ms));
const playFile = dir => join(dir, '.threedog/play.json');
const tail = (file, n = 6) => { try { return readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).slice(-n).join('\n'); } catch { return ''; } };

/** Start the dev server of this workspace in the background; resolves { child, exited: () => code | null } */
function startServer(dir) {
  mkdirSync(join(dir, '.threedog'), { recursive: true });
  const log = join(dir, '.threedog/dev.log'), fd = openSync(log, 'w');
  const child = spawn(process.execPath, [BIN, 'dev'], { cwd: dir, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
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
  if (p.state === 'missing') return { ok: false, ...await diagnose(dir) };
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
  return { ok: !bad, runtime, data: { port: p.port, loading: lv, errors: { count: errs.length, latest: last ?? null } },
    text: `${head}${last ? ` (latest E${last.id}: ${last.message.split('\n')[0].slice(0, 100)}; threedog errors latest)` : ''}` };
}

function stopServer(dir) {
  const pids = [];
  for (const f of [playFile(dir), join(dir, '.threedog/dev.json')]) try { pids.push(JSON.parse(readFileSync(f, 'utf8')).pid); } catch { /* absent */ }
  const own = (() => { try { return JSON.parse(readFileSync(playFile(dir), 'utf8')).pid; } catch { return null; } })();
  if (!own) return { ok: false, text: '✗ threedog play did not start a server for this workspace.\nNext: close the terminal where you ran npm run dev.' };
  for (const pid of new Set(pids.filter(Boolean))) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  }
  for (const f of [playFile(dir), join(dir, '.threedog/dev.json')]) rmSync(f, { force: true });
  return { ok: true, text: '✓ Dev server stopped (the headless browser it opened closes with it).' };
}
