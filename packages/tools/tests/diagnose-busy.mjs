// A dev server that is alive but slow to answer the bridge ping must not be reported as "No dev server is running" (threedog/diagnose.mjs).
// Why: a play-test saw `threedog describe` say "no dev server" while one was running. Not reproduced with a healthy server (the bridge opens its own
// headless page); the one path that can print it for a live server is a ping that times out, which looked the same as a dead port.
// Fixture: a plain http server that accepts the ping and never answers, plus a dev.json naming this process as its pid.
// Run: threedog test "busy dev server"
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diagnose } from '../threedog/diagnose.mjs';
import { execute } from '../threedog/dispatch.mjs';

export const name = 'busy dev server: a live pid whose port does not answer the ping is reported as busy, not as "No dev server is running"';

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'td-busy-'));
  const srv = createServer(() => { /* never answers */ });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    mkdirSync(join(dir, '.threedog'));
    writeFileSync(join(dir, '.threedog', 'dev.json'), JSON.stringify({ port: srv.address().port, token: 't', pid: process.pid }));
    const d = await diagnose(dir);
    check('names the live server and says wait, not "No dev server is running"', d?.kind === 'busy' && /is running/.test(d.text) && !/No dev server is running/.test(d.text) && /retry/.test(d.text), d?.text);
    // a record whose process is gone: the words of connect.mjs differ from "no dev server", the code must not
    writeFileSync(join(dir, '.threedog', 'dev.json'), JSON.stringify({ port: 1, token: 't', pid: 2 ** 22 + 1 }));
    const stale = await execute(dir, 'describe');
    check('a stale record answers no-server, not command-error', stale.code === 'no-server', JSON.stringify(stale));
  } finally { srv.closeAllConnections?.(); srv.close(); rmSync(dir, { recursive: true, force: true }); }
}
