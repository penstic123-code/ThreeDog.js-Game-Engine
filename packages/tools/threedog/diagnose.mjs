// Why the bridge cannot be used: exactly one of four causes, each with the single most likely next step (no generic checklist).
//   no-server   nothing is listening (no dev.json, or the process in it is gone)           -> threedog play
//   starting    the server answers but the page has no ready engine yet and logged nothing -> wait, then threedog status
//   page-error  the page's script failed (errors in .threedog/errors.log) or start() blocked -> threedog errors latest
//   no-bridge   a dev server answers, but it has no dev bridge (its vite config lacks the plugin) -> use gameConfig
import { basename } from 'node:path';
import { devServerInfo } from '../devinfo.mjs';
import { allErrors, isError } from './errorlog.mjs';
import { rel } from '../paths.mjs';

const get = async (url, init, ms = 1500) => { try { return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) }); } catch { return null; } };

/**
 * { state: 'none' | 'ok' | 'missing', port?, foreign?, scanned? }. 'ok' = the server in dev.json answers the bridge with ITS token (a wrong token would also
 * get 401 from a bridge, so a 401 on the real token means the port now belongs to another server: foreign, reported as none so play starts a fresh one).
 * scanned = found by looking at the default vite ports (no dev.json), which may be another project's server.
 */
export async function probe(dir) {
  const info = devServerInfo(dir);
  if (info.state === 'live') {
    const res = await get(`http://localhost:${info.port}/__threedog/cmd`, { method: 'POST', headers: { 'x-threedog-token': info.token ?? '' }, body: '{"op":"ping"}' });
    if (!res) return { state: 'none', port: info.port };
    if (res.status === 200) return { state: 'ok', port: info.port };
    if (res.status === 401) return { state: 'none', port: info.port, foreign: true };
    return { state: 'missing', port: info.port };
  }
  if (info.state !== 'none') return { state: 'none' };   // stale / unreadable record: nothing of ours is running
  // no dev.json: a vite server started by hand (npm run dev with another config) may still be running on a default port
  // (one that has the bridge belongs to another workspace, so it does not count here)
  const hits = await Promise.all([5173, 5174, 5175, 5176].map(async p => {
    if (!(await get(`http://localhost:${p}/@vite/client`, {}, 600))?.ok) return 0;
    return (await get(`http://localhost:${p}/__threedog/cmd`, { method: 'POST', headers: { 'x-threedog-token': 'probe' }, body: '{}' }, 600))?.status === 401 ? 0 : p;
  }));
  const found = hits.find(Boolean);
  return found ? { state: 'missing', port: found, scanned: true } : { state: 'none' };
}

/** { kind, text } for a failure, or null when the cause is none of the four (the caller keeps its own message) */
export async function diagnose(dir, err) {
  const msg = String(err?.message ?? err ?? ''), ws = rel(dir) || basename(dir), p = await probe(dir);
  if (p.state === 'none') return { kind: 'no-server', text: `✗ ${p.foreign ? `The port in .threedog/dev.json (${p.port}) now belongs to another server (the record is out of date)` : `No dev server is running for ${ws}`}.\nNext: threedog play (starts it and waits for the bridge), or npm run dev in another terminal.` };
  if (p.state === 'missing') return { kind: 'no-bridge', text: `✗ A dev server answers on port ${p.port} but it has no dev bridge.\n`
    + 'Next: make the workspace vite.config.js use gameConfig() from @threedog/tools/vite (it installs the bridge), then restart the server.' };
  if (!/engine|start\(\)|window\.engine|did not respond|timed out|blocked/i.test(msg)) return null;
  const errs = allErrors(dir).filter(isError), last = errs.at(-1);
  if (errs.length || /blocked/.test(msg)) return { kind: 'page-error', text: `✗ The page's script failed before the engine was ready${last ? `: ${last.message.split('\n')[0].slice(0, 140)}` : ' (startup is blocked)'}.\n`
    + `Next: threedog ${last ? 'errors latest' : 'loading'} ${last ? '(shows the cause and the doc page)' : '(shows the failed asset)'}.` };
  return { kind: 'starting', text: `✗ The dev server is up but the page has no ready engine yet and logged no error.\n`
    + 'Next: wait a few seconds and run threedog status (the first start compiles the game and generates the world). If it stays like this, main.js may never set window.engine = engine.' };
}

