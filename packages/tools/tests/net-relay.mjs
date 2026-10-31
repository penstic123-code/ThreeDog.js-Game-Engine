// Net relay test: npm test -- net relay
// Starts packages/tools/net-relay.mjs on a spare port and talks to it through the engine's webSocket() transport (Node's built-in WebSocket client):
// join / leave reach the host, the relay stamps `from` itself (a guest cannot claim another id), big messages survive framing, a key gets the old id back.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TOOLS, ENGINE } from '../paths.mjs';

export const name = 'net relay: WebSocket relay forwards between host and guests';
const wait = ms => new Promise(r => setTimeout(r, ms));
const PORT = 8799;

export async function run({ check }) {
  if (typeof WebSocket === 'undefined') { check('Node has a built-in WebSocket client (Node 22+)', false, process.version); return; }
  const relay = spawn(process.execPath, [join(TOOLS, 'net-relay.mjs'), String(PORT)], { stdio: 'pipe' });
  try {
    await new Promise((res, rej) => { relay.stdout.once('data', res); relay.once('exit', rej); });
    const { webSocket } = await import(pathToFileURL(join(ENGINE, 'modules/net/transports.js')).href);
    const url = `ws://localhost:${PORT}/test-room`, log = [];
    const H = webSocket(url, { host: true });
    H.on('join', id => { log.push('join ' + id); H.send({ big: 'x'.repeat(70000) }, id); });
    H.on('leave', id => log.push('leave ' + id));
    H.on('message', (m, from) => log.push(`from ${from}: ${m.name}`));
    await wait(200);
    const C = webSocket(url);
    let big = 0;
    C.on('open', () => C.send({ t: 'op', name: 'chest.take', from: 99 }));
    C.on('message', m => { big = m.big?.length ?? big; });
    await wait(400);
    const key = C.key, id = C.id;
    C.close(); await wait(300);
    const C2 = webSocket(url, { key });
    await wait(400);
    check('host hears join and the guest message, stamped by the relay', log.includes('join 1') && log.includes('from 1: chest.take'), log.join(' | '));
    check('a 70 KB message arrives whole (extended frame length)', big === 70000, big);
    check('host hears leave', log.includes('leave 1'), log.join(' | '));
    check('reconnect with the key gets the same peer id', id === 1 && C2.id === 1 && log.filter(x => x === 'join 1').length === 2, `${id} ${C2.id}`);
    H.close(); C2.close();
    await wait(100);
  } finally { relay.kill(); }
}
