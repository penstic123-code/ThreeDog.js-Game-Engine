// The one place that reads <workspace>/.threedog/dev.json (written by vite/vite-threedog-bridge.js) and decides whether the server in it is alive.
// Before this, connect / diagnose / play / doctor / how / paths each read the file themselves with three different "is it alive" tests.
// No imports from the rest of the tools (paths.mjs itself uses it), so it is safe to import from anywhere.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const devFile = dir => join(dir, '.threedog/dev.json');

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
  if (dev.pid) {
    try { process.kill(dev.pid, 0); } catch (e) { if (e.code === 'ESRCH') return { state: 'stale', ...dev, file }; }   // EPERM = alive, owned by someone else
  }
  return { state: 'live', ...dev, file };
}

/** Is a process with this pid running (EPERM counts: it exists, it is just not ours) */
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
