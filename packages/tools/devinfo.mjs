// The one place that reads <workspace>/.threedog/dev.json (written by vite/vite-threedog-bridge.js) and decides whether the server in it is alive.
// Before this, connect / diagnose / play / doctor / how / paths each read the file themselves with three different "is it alive" tests.
// No imports from the rest of the tools (paths.mjs itself uses it), so it is safe to import from anywhere.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const devFile = dir => join(dir, '.threedog/dev.json');

/**
 * What the record says about this workspace's dev server:
 *   { state: 'none' }                                   no dev.json
 *   { state: 'unreadable', file }                       the file exists but is not valid JSON (usually being written right now: retry)
 *   { state: 'stale', port, token, pid, file }          the recorded process is gone (a port it had may belong to ANOTHER game's server now)
 *   { state: 'live', port, token, pid, file }           the process exists (or the record has no pid); still not proof the port is the bridge: diagnose.probe asks it
 */
export function devServerInfo(dir) {
  const file = devFile(dir);
  if (!existsSync(file)) return { state: 'none', file };
  let dev;
  try { dev = JSON.parse(readFileSync(file, 'utf8')); } catch { return { state: 'unreadable', file }; }
  if (!dev || !dev.port) return { state: 'unreadable', file };
  return { state: dev.pid && !pidAlive(dev.pid) ? 'stale' : 'live', ...dev, file };
}

/** Is a page attached right now? Asked before a command that only wants to read one: a bridge call would make the dev server open a headless Chromium */
export async function pageAttached(dir) {
  const dev = devServerInfo(dir);
  return dev.state === 'live' && await fetch(`http://localhost:${dev.port}/__threedog/cmd`, { method: 'POST', headers: { 'x-threedog-token': dev.token }, body: '{"op":"ping"}',
    signal: AbortSignal.timeout(1500) }).then(r => r.json()).then(j => j.value?.live || j.value?.headless, () => false);
}

/** Is a process with this pid running (EPERM counts: it exists, it is just not ours) */
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
