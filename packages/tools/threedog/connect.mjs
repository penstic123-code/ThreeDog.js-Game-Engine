import { join, basename } from 'node:path';
import { rel, MODE, ENGINE } from '../paths.mjs';
import { devServerInfo } from '../devinfo.mjs';

export { devServerInfo };

const startHint = dir => `npm run dev${MODE === 'monorepo' && dir !== ENGINE ? ' -- ' + basename(dir) : ''}`;

/** { port, token } of the dev server running for this workspace; throws an English "how to fix" message when none is running */
export function devServer(dir) {
  const info = devServerInfo(dir), ws = rel(dir) || basename(dir);
  if (info.state === 'none') throw new Error(`no dev server is running for ${ws}
Start it in another terminal first: ${startHint(dir)} (then retry)`);
  if (info.state === 'unreadable') throw new Error(`${rel(info.file)} cannot be read (the dev server may be writing it right now)
Retry in a moment; if it stays like this delete the file and run ${startHint(dir)}`);
  // A leftover file from a server that died: its port may now belong to ANOTHER game's server, so never talk to it
  if (info.state === 'stale') throw new Error(`the dev server recorded for ${ws} (pid ${info.pid}) is no longer running (stale .threedog/dev.json)
Start it again: ${startHint(dir)}`);
  return info;
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
    page,
    /** The same driver aimed at another page path (a scenario file's own url) */
    withPage: p => bridgeDriver(dir, { page: p }),
    evaluate: (src, arg) => call({ op: 'eval', src, arg }),
    screenshot: async () => Buffer.from(await call({ op: 'shot' }), 'base64'),
    reload: () => call({ op: 'reload' }),
  };
}

/** Bridge errors as one readable message: Playwright errors carry a "page.evaluate: Error:" prefix and a stack, keep only the first line */
export const errorText = e => /^page\./.test(e.message) ? e.message.split('\n')[0].replace(/^page\.evaluate: (\w*Error: )?/, '') : e.message;
