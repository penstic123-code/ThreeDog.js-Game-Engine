// Why the bridge cannot be used: exactly one of four causes, each with the single most likely next step (no generic checklist).
//   no-server   nothing is listening (no dev.json, or the process in it is gone)           -> threedog play
//   starting    the server answers but the page has no ready engine yet and logged nothing -> wait, then threedog status
//   page-error  the page's script failed (errors in .threedog/errors.log) or start() blocked -> threedog errors latest
//   no-bridge   a dev server answers, but it has no dev bridge (its vite config lacks the plugin) -> use gameConfig
import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { allErrors, isError } from './errorlog.mjs';
import { rel } from '../paths.mjs';

const get = async (url, init, ms = 1500) => { try { return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) }); } catch { return null; } };

/** 'none' | 'ok' | 'missing', and the port when something answered */
export async function probe(dir) {
  const file = join(dir, '.threedog/dev.json');
  let port;
  try { port = JSON.parse(readFileSync(file, 'utf8')).port; } catch { /* no dev.json */ }
  if (port) {
    // a wrong token on purpose: the bridge answers 401 JSON, a server without it answers its page (404 / html)
    const res = await get(`http://localhost:${port}/__threedog/cmd`, { method: 'POST', headers: { 'x-threedog-token': 'probe' }, body: '{}' });
    if (!res) return { state: 'none', port };
    return { state: res.status === 401 || res.status === 200 ? 'ok' : 'missing', port };
  }
  // no dev.json: a vite server started by hand (npm run dev with another config) may still be running on a default port
  // (one that has the bridge belongs to another workspace, so it does not count here)
  const hits = await Promise.all([5173, 5174, 5175, 5176].map(async p => {
    if (!(await get(`http://localhost:${p}/@vite/client`, {}, 600))?.ok) return 0;
    return (await get(`http://localhost:${p}/__threedog/cmd`, { method: 'POST', headers: { 'x-threedog-token': 'probe' }, body: '{}' }, 600))?.status === 401 ? 0 : p;
  }));
  const found = hits.find(Boolean);
  return found ? { state: 'missing', port: found } : { state: 'none' };
}

/** { kind, text } for a failure, or null when the cause is none of the four (the caller keeps its own message) */
export async function diagnose(dir, err) {
  const msg = String(err?.message ?? err ?? ''), ws = rel(dir) || basename(dir), p = await probe(dir);
  if (p.state === 'none') return { kind: 'no-server', text: `✗ No dev server is running for ${ws}.\nNext: threedog play (starts it and waits for the bridge), or npm run dev in another terminal.` };
  if (p.state === 'missing') return { kind: 'no-bridge', text: `✗ A dev server answers on port ${p.port} but it has no dev bridge.\n`
    + 'Next: make the workspace vite.config.js use gameConfig() from @threedog/tools/vite (it installs the bridge), then restart the server.' };
  if (!/engine|start\(\)|window\.engine|did not respond|timed out|blocked/i.test(msg)) return null;
  const errs = allErrors(dir).filter(isError), last = errs.at(-1);
  if (errs.length || /blocked/.test(msg)) return { kind: 'page-error', text: `✗ The page's script failed before the engine was ready${last ? `: ${last.message.split('\n')[0].slice(0, 140)}` : ' (startup is blocked)'}.\n`
    + `Next: threedog ${last ? 'errors latest' : 'loading'} ${last ? '(shows the cause and the doc page)' : '(shows the failed asset)'}.` };
  return { kind: 'starting', text: `✗ The dev server is up but the page has no ready engine yet and logged no error.\n`
    + 'Next: wait a few seconds and run threedog status (the first start compiles the game and generates the world). If it stays like this, main.js may never set window.engine = engine.' };
}

