// Net relay test: npm test -- net relay
// Starts packages/tools/net-relay.mjs on a spare port and talks to it through the engine's webSocket() transport (Node's built-in WebSocket client):
// join / leave reach the host, the relay stamps `from` itself (a guest cannot claim another id), big messages survive framing, a key gets the old id back,
// and the abuse limits hold: no room entries left by guests or closed rooms, the size cap counts a whole fragmented message.
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
    // a reconnecting guest whose host closes the room stops: the relay says closed, and retrying an empty room would go on forever
    const C3 = webSocket(url, { reconnect: true });
    let closes = 0;
    C3.on('close', () => closes++);
    await wait(300);
    H.close(); C2.close();
    await wait(1800);   // retries would come at 0.5 s and 1.5 s
    check('a reconnect: true guest stops after the host closed the room (one close, no retries)', closes === 1, `closes ${closes}`);
    C3.close();
    await wait(100);
    // guests knocking on names nobody hosts must not leave rooms behind (memory that grows with every random name)
    for (let i = 0; i < 5; i++) webSocket(`ws://localhost:${PORT}/nobody-${i}`);
    await wait(400);
    const status = await (await fetch(`http://localhost:${PORT}/`)).text();
    check('guests on empty rooms and a closed room leave no room entries', /\(0 room\(s\) open\)/.test(status), status);
    check('one message split into many frames is capped as a whole (relay closes the socket)', await fragmentFlood(PORT), 'socket stayed open');
  } finally { relay.kill(); }
}

/** Raw client: handshake, then 1.5 MB of continuation frames of 64 KB each (every frame under the 1 MB cap); resolves true when the relay hangs up */
async function fragmentFlood(port) {
  const { connect } = await import('node:net');
  return new Promise(res => {
    const s = connect(port, '127.0.0.1');
    const t = setTimeout(() => { s.destroy(); res(false); }, 3000);
    s.on('close', () => { clearTimeout(t); res(true); });
    s.on('error', () => {});
    s.once('data', () => {
      const chunk = Buffer.alloc(65536, 0x20);
      for (let i = 0; i < 24 && !s.destroyed; i++) {
        const head = Buffer.from([i ? 0x00 : 0x01, 0x80 | 127, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);   // FIN 0, text/continuation, masked, 64-bit length
        head.writeBigUInt64BE(BigInt(chunk.length), 2);   // mask key stays 0, so the payload is sent as is
        s.write(Buffer.concat([head, chunk]));
      }
    });
    s.write(`GET /flood?host HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  });
}
