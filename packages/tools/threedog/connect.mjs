// Dev bridge client side, shared by the command line (cli.mjs) and the MCP server (mcp.mjs).
// Finds the running dev server through <workspace>/.threedog/dev.json { port, token } (written by vite-threedog-bridge.js) and builds the
//   driver commands.mjs needs. Only talks to the bridge as a local client: no listener of its own.
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { rel, MODE, ENGINE } from '../paths.mjs';
import { runScenario, scenarioFiles, readScenario } from '../scenario.mjs';

/** { port, token } of the dev server running for this workspace; throws an English "how to fix" message when none is running */
export function devServer(dir) {
  const file = join(dir, '.threedog/dev.json');
  if (!existsSync(file)) throw new Error(`no dev server is running for ${rel(dir) || basename(dir)}\nStart it in another terminal first: npm run dev${MODE === 'monorepo' && dir !== ENGINE ? ' -- ' + basename(dir) : ''} (then retry)`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Driver for commands.mjs run(): { evaluate, screenshot, reload } forwarded to POST /__threedog/cmd.
 * dev.json is read again on every call, so a restarted dev server (new port / token) is picked up without restarting the caller.
 */
export function bridgeDriver(dir, { page } = {}) {
  const call = async body => {
    const { port, token } = devServer(dir);
    let res;
    try { res = await fetch(`http://localhost:${port}/__threedog/cmd`, { method: 'POST', headers: { 'x-threedog-token': token }, body: JSON.stringify({ ...body, page }) }); }
    catch { throw new Error(`cannot reach the dev server (port ${port})\nIt may have been closed: run npm run dev again and retry`); }
    const r = await res.json();
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  return {
    evaluate: (src, arg) => call({ op: 'eval', src, arg }),
    screenshot: async () => Buffer.from(await call({ op: 'shot' }), 'base64'),
    reload: () => call({ op: 'reload' }),
  };
}

/** Bridge errors as one readable message: Playwright errors carry a "page.evaluate: Error:" prefix and a stack, keep only the first line */
export const errorText = e => /^page\./.test(e.message) ? e.message.split('\n')[0].replace(/^page\.evaluate: (\w*Error: )?/, '') : e.message;

/** threedog scenario name: run tests/scenarios/<name>.json on the running page; { ok, text } with failed checks only (at most 3 lines) */
export async function scenario(driver, dir, name) {
  const files = scenarioFiles(dir), stem = x => basename(x, '.json'), f = files.find(x => stem(x) === name);
  if (!f) throw new Error(`Usage: threedog scenario name (a file in tests/scenarios/). Have: ${files.map(stem).join(', ') || 'none'}`);
  const res = [];
  await runScenario(driver, readScenario(f), { check: (label, ok, detail) => res.push({ label, ok, detail }), file: name, snapDir: join(dir, 'tests', 'snapshots') });
  const bad = res.filter(r => !r.ok);
  return { ok: !bad.length, text: bad.length ? bad.slice(0, 3).map(r => `✗ ${r.label} → ${r.detail}`).join('\n') : `✓ scenario ${name}: ${res.length} checks passed` };
}
