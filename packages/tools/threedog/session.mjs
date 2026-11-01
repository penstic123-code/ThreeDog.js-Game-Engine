// Optional persistent session: `threedog session` keeps ONE small node process alive per workspace so later bridge commands skip node-side module
// loading and the cold first request (measured: ~0.3 s of a ~0.6 s command). It is only a cache: every command works identically without it.
//   .threedog/session.json { port, token, pid }   written by the session, deleted when it exits (idle timeout, `session stop`, signal)
// The session listens on 127.0.0.1 only, with a random token (same model as the dev bridge). Requests run one at a time, in arrival order,
// because step / press are order-dependent. Each request carries the caller's cwd (relative --file paths resolve against it).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = dir => join(dir, '.threedog/session.json');
const DEFAULT_MINUTES = 10;
const CALL_MS = 600000;   // a long verify may run minutes: a shorter client wait would give up on a command that is still running, and the retry would run it twice
const MAX_BODY = 1 << 20;
const sameToken = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** { port, token, pid } of the live session of this workspace, or null (a file left by a dead process is deleted here) */
export function readSession(dir) {
  if (!existsSync(file(dir))) return null;
  let s;
  try { s = JSON.parse(readFileSync(file(dir), 'utf8')); process.kill(s.pid, 0); return s; }
  catch (e) {
    if (s && e.code === 'EPERM') return s;   // alive, owned by another user: still a session
    // a file that does not parse may be mid-write: only a stale one is removed; a dead pid in a complete file is removed at once
    if (!s) { try { if (Date.now() - statSync(file(dir)).mtimeMs < 5000) return null; } catch { return null; } }
    try { rmSync(file(dir), { force: true }); } catch { /* another caller removed it */ }
    return null;
  }
}

/** Run one command through the session: its execute() result, or null when there is no (reachable) session so the caller runs it directly */
export async function viaSession(dir, cmd, args, page) {
  const s = readSession(dir);
  if (!s) return null;
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${s.port}/run`, { method: 'POST', headers: { 'x-threedog-token': s.token }, signal: AbortSignal.timeout(CALL_MS),
      body: JSON.stringify({ cmd, args, page, cwd: process.cwd() }) });
  } catch (e) {
    // a timeout means the command ran (and is stuck): re-running it directly could repeat a step, so say so instead of falling back
    if (e.name === 'TimeoutError') return { ok: false, code: 'command-error', summary: 'session timeout', runtime: null, data: null, text: `✗ the session did not answer for ${CALL_MS / 1000} s (threedog session stop, then retry)` };
    // only a refused connection proves the command never started; a reset in the middle may have run it already, so say that instead of running it again
    if ((e.cause?.code ?? e.code) === 'ECONNREFUSED') return null;
    return { ok: false, code: 'command-error', summary: 'session connection lost', runtime: null, data: null, text: `✗ the session connection broke while the command ran (${e.cause?.code ?? e.message}); it may have run: check with threedog status, then retry` };
  }
  return res.ok ? res.json() : null;
}

/** The long-lived side (run as `node session.mjs --serve <dir> <minutes>`): serves until idle for `minutes` */
async function serve(dir, minutes) {
  const { execute } = await import('./dispatch.mjs');
  const token = randomBytes(16).toString('hex');
  let last = Date.now(), chain = Promise.resolve(), busy = 0;   // busy: commands accepted and not finished (never exit under one)
  // the dev server that threedog play started belongs to this working run: it goes down with the session (play.json exists only for servers play started)
  const bye = async () => { try { if (existsSync(join(dir, '.threedog/play.json'))) await (await import('./play.mjs')).stopServer(dir); } catch { /* best effort */ } try { if (JSON.parse(readFileSync(file(dir), 'utf8')).token === token) rmSync(file(dir), { force: true }); } catch { /* already gone */ } process.exit(0); };
  const server = http.createServer((req, res) => {
    if (!sameToken(req.headers['x-threedog-token'], token)) { res.writeHead(403).end(); return; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > MAX_BODY) { res.writeHead(413).end(); req.destroy(); } });
    req.on('end', () => {
      last = Date.now();
      if (req.url === '/stop') { res.end('bye'); setTimeout(bye, 20); return; }
      busy++;
      chain = chain.then(async () => {
        let out;
        try {
          const { cmd, args, page, cwd } = JSON.parse(body);
          try { process.chdir(cwd); } catch { /* caller's directory is gone: keep ours */ }
          out = await execute(dir, cmd, args, { page });
        } catch (e) { out = { ok: false, code: 'command-error', summary: e.message, runtime: null, data: null, text: '✗ ' + e.message }; }
        last = Date.now(); busy--;
        res.end(JSON.stringify(out));
      });
    });
  });
  server.listen(0, '127.0.0.1', () => {
    mkdirSync(join(dir, '.threedog'), { recursive: true });
    const tmp = file(dir) + '.tmp';   // written whole, then renamed: a reader never sees half a file
    writeFileSync(tmp, JSON.stringify({ port: server.address().port, token, pid: process.pid, minutes }));
    renameSync(tmp, file(dir));
  });
  setInterval(() => { if (!busy && Date.now() - last > minutes * 60000) bye(); }, 5000);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, bye);
}

/** threedog session [start] [--minutes N] | stop | status → { ok, text } */
export async function sessionCommand(dir, args) {
  const sub = args[0] && !args[0].startsWith('-') ? args[0] : 'start';
  const mi = args.indexOf('--minutes'), minutes = mi >= 0 ? +args[mi + 1] : DEFAULT_MINUTES;
  if (!['start', 'stop', 'status'].includes(sub)) return { ok: false, text: '✗ Usage: threedog session [start] [--minutes N] | session stop | session status' };
  if (!(minutes > 0)) return { ok: false, text: '✗ --minutes needs a positive number' };
  const s = readSession(dir);
  if (sub === 'status') return { ok: true, text: s ? `✓ session running (pid ${s.pid}, idle exit after ${s.minutes} min)` : '✓ no session (commands run directly)' };
  if (sub === 'stop') {
    if (!s) return { ok: true, text: '✓ no session running' };
    try { await fetch(`http://127.0.0.1:${s.port}/stop`, { method: 'POST', headers: { 'x-threedog-token': s.token } }); }
    catch { try { process.kill(s.pid); } catch { /* already gone */ } }
    rmSync(file(dir), { force: true });
    return { ok: true, text: '✓ session stopped' };
  }
  if (s) return { ok: true, text: `✓ session already running (pid ${s.pid}, idle exit after ${s.minutes} min)` };
  spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve', dir, String(minutes)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 100)); const n = readSession(dir); if (n) return { ok: true, text: `✓ session started (pid ${n.pid}); exits after ${minutes} idle min; threedog session stop ends it` }; }
  return { ok: false, text: '✗ the session did not start within 5 s (commands still run directly)' };
}

if (process.argv[2] === '--serve' && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) serve(process.argv[3], +process.argv[4] || DEFAULT_MINUTES);
