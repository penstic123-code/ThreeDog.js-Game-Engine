#!/usr/bin/env node
// Minimal WebSocket relay for net() (modules/net): one host and its peers per room; the relay only forwards, the host's browser runs the game.
//   node packages/tools/net-relay.mjs [port]        (default 8787; no dependencies, Node 18+)
//   host:   webSocket('ws://localhost:8787/my-room', { host: true })
//   guests: webSocket('ws://<host machine ip>:8787/my-room')     (same room name)
// What it does: assigns each guest a peer id and a secret key (a guest that reconnects with ?key=... gets the same id, so the same actor
// and bag on the host); tells the host about join / leave; wraps messages as { from, msg } (to the host) and { msg } (to a guest).
// What it does not do: no TLS, no accounts, no limits beyond a message size cap. Put it behind a TLS proxy (wss://) for anything public,
// and remember the room name is the only "password". The host still validates every request (net: 'peer', args, owner, rate).
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const MAX = 1 << 20;   // 1 MB per message: a snapshot of a big world fits; anything larger is likely abuse
const rooms = new Map();   // room -> { host, peers: Map id -> socket, keys: Map key -> id, next }

const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('threedog net relay: connect with WebSocket\n'); });
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const url = new URL(req.url, 'http://x'), name = url.pathname.slice(1) || 'default';
  const room = rooms.get(name) ?? rooms.set(name, { host: null, peers: new Map(), keys: new Map(), next: 0 }).get(name);
  const conn = wrap(socket);
  if (url.searchParams.has('host')) {
    if (room.host) { conn.send({ closed: 'roomTaken' }); return conn.close(); }
    room.host = conn;
    conn.send({ hello: { id: 0 } });
    conn.onMessage = d => { const p = room.peers.get(d?.to); if (p) p.send({ msg: d.msg }); };
    conn.onClose = () => { room.host = null; for (const p of room.peers.values()) { p.send({ closed: 'hostLeft' }); p.close(); } rooms.delete(name); };
    return;
  }
  if (!room.host) { conn.send({ closed: 'noHost' }); return conn.close(); }
  const asked = url.searchParams.get('key');
  const id = room.keys.get(asked) ?? ++room.next, secret = room.keys.has(asked) ? asked : randomBytes(12).toString('hex');
  room.keys.set(secret, id);
  room.peers.get(id)?.close();   // the same key twice: the newer connection wins
  room.peers.set(id, conn);
  conn.send({ hello: { id, key: secret } });
  room.host.send({ join: id });
  conn.onMessage = d => room.host?.send({ from: id, msg: d?.msg });   // the relay stamps `from`; whatever the guest wrote is only `msg`
  conn.onClose = () => { if (room.peers.get(id) !== conn) return; room.peers.delete(id); room.host?.send({ leave: id }); };
});
server.listen(PORT, () => console.log(`threedog net relay on ws://localhost:${PORT}/<room>`));

/** A tiny RFC 6455 connection: text frames, ping / pong, close. Enough for JSON messages between browsers. */
function wrap(socket) {
  let buf = Buffer.alloc(0), parts = [], closed = false;
  const c = {
    onMessage: null, onClose: null,
    send(obj) { if (!closed) socket.write(frame(0x1, Buffer.from(JSON.stringify(obj)))); },
    close() { if (closed) return; closed = true; socket.end(frame(0x8, Buffer.alloc(0))); c.onClose?.(); },
  };
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      if (len > MAX || !masked) return c.close();   // browsers always mask; an unmasked or huge frame is not a browser
      if (buf.length < at + 4 + len) return;
      const mask = buf.subarray(at, at + 4), data = Buffer.from(buf.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(at + 4 + len);
      if (op === 0x8) return c.close();
      if (op === 0x9) { socket.write(frame(0xA, data)); continue; }
      if (op === 0xA) continue;
      parts.push(data);
      if (!fin) continue;
      const text = Buffer.concat(parts).toString('utf8'); parts = [];
      let d; try { d = JSON.parse(text); } catch { continue; }
      c.onMessage?.(d);
    }
  });
  socket.on('close', () => { if (!closed) { closed = true; c.onClose?.(); } });
  socket.on('error', () => socket.destroy());
  return c;
}

function frame(op, data) {
  const n = data.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (n >= 126 && n < 65536) { head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
  else if (n >= 65536) { head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, data]);
}
