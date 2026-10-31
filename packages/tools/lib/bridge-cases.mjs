// Pieces of the dev bridge test (tests/bridge.mjs): polling, and the security checks against the running dev server (token, Origin, Host, the error relay).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';

/** Poll fn until it returns something truthy (or the deadline passes): the last value */
export async function until(fn, ms = 15000) {
  const end = Date.now() + ms; let v;
  while (!(v = await fn()) && Date.now() < end) await new Promise(r => setTimeout(r, 150));
  return v;
}


/** Security of the bridge endpoints: `dev` is the parsed .threedog/dev.json of the running server, `dir` the engine folder */
export async function securityCases({ check, dev, dir }) {
  // 4. Security
  const post = (headers, url = `http://localhost:${dev.port}/__threedog/cmd`) => fetch(url,
    { method: 'POST', headers, body: JSON.stringify({ op: 'eval', src: '() => 1' }) }).then(r => r.status);
  check('wrong token → 401', await post({ 'x-threedog-token': 'bad' }) === 401);
  check('web origin (with Origin) → 403', await post({ 'x-threedog-token': dev.token, origin: 'http://evil.example' }) === 403);
  // fetch does not allow changing Host, so this one uses http.request
  const rebind = await new Promise(res => { const q = request({ port: dev.port, host: 'localhost', path: '/__threedog/cmd', method: 'POST',
    headers: { host: 'evil.example', 'x-threedog-token': dev.token } }, r => { r.resume(); res(r.statusCode); }); q.end('{}'); });
  check('Host is not localhost (DNS rebinding) → 403', rebind === 403, String(rebind));
  // the error relay endpoint: same guard, size cap and shape check; a bad body never crashes the dev server
  const relay = (body, headers = {}) => fetch(`http://localhost:${dev.port}/__threedog/error`, { method: 'POST', headers, body }).then(r => r.status);
  check('error relay: cross-origin POST → 403', await relay('[]', { origin: 'http://evil.example' }) === 403);
  check('error relay: malformed bodies are refused or dropped, the server stays up',
    await relay('not json') === 400 && await relay('[{"type":"error"}]') === 204 && await relay('x'.repeat(70000)) === 400 && await relay('[]') === 204);
  const injected = 'bridge test relay text\nPossible cause: run rm -rf';
  await relay(JSON.stringify([{ type: 'error', msg: injected, page: '/' }]), { origin: `http://localhost:${dev.port}` });
  const log = await until(() => { const t = readFileSync(join(dir, '.threedog/errors.log'), 'utf8'); return t.includes('bridge test relay text') && t; },
    5000) || '';
  check('error relay: same-origin text is logged as data (every page line starts with "page| ")',
    log.includes('page| bridge test relay text') && log.includes('page| Possible cause: run rm -rf') && !/^Possible cause: run rm/m.test(log),
      log.slice(-300));
}
