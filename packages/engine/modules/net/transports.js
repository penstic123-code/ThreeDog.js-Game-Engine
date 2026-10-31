// Transports for net(): how messages travel between the host and its peers. net() only uses this small shape, so any carrier
// (a Colyseus room, a WebRTC data channel, a game server) plugs in by implementing it:
//   send(msg, to?)   deliver a plain-object message; on the host `to` is a peer id, on a client it goes to the host
//   on(type, fn)     host: 'join' (peerId), 'leave' (peerId), 'message' (msg, from); client: 'open', 'close', 'message' (msg)
//   close()
// Delivery must keep order per link (WebSocket does); messages may be lost (the sync recovers with a full snapshot).
// Peer ids come from the transport, never from what a client says about itself: they are the identity the host's actor ids are built on.
// A reconnecting client presents `key` (a secret the transport handed it on first connect) to get its old peer id back.
import { Random } from '../../core/Random.js';

/** @internal tiny event emitter shared by the transports */
function emitter() {
  const subs = {};
  return {
    on(type, fn) { (subs[type] ||= []).push(fn); return { remove: () => { subs[type] = subs[type].filter(f => f !== fn); } }; },
    emit(type, ...a) { for (const fn of subs[type] || []) fn(...a); },
  };
}

/**
 * An in-process network for tests and offline demos: one host and any number of clients in the same page, with optional latency, jitter and loss.
 * Messages are deep-copied on send (no shared objects, like a real wire). Order per link is kept, as on a WebSocket.
 * manual: true delivers only when you call advance(ms) (deterministic tests); otherwise messages land after real time.
 * @param {{ latency?: number, jitter?: number, loss?: number, seed?: number, manual?: boolean }} [opts] latency / jitter in ms, loss 0..1
 * @returns {{ host(): any, connect(opts?: { key?: string }): any, advance(ms: number): void, readonly now: number, loss: number, latency: number, jitter: number }}
 * @example
 * const wire = fakeNetwork({ latency: 80, jitter: 30, loss: 0.05, manual: true });
 * host.use(net({ role: 'host', transport: wire.host() }));
 * guest.use(net({ role: 'client', transport: wire.connect() }));
 * wire.advance(100);   // deliver what is due in the next 100 ms
 * @experimental
 */
export function fakeNetwork(opts = {}) {
  const { seed = 1, manual = false } = opts;
  const r = new Random(seed), rand = () => r.next(), queue = [], keys = new Map();   // seeded: loss and jitter repeat between test runs
  let now = 0, host = null, nextId = 0, timer = null;
  const clock = () => manual ? now : performance.now();   // wall-clock: a simulated wire delays by real time, like a real one
  const W = {
    latency: opts.latency ?? 0, jitter: opts.jitter ?? 0, loss: opts.loss ?? 0,
    get now() { return clock(); },
    /** Deliver everything due within the next ms (manual mode) */
    advance(ms) { now += ms; flush(); },
    host() {
      const ev = emitter();
      host = { ev, peers: new Map(), closed: false };
      return { send: (msg, to) => { const c = host.peers.get(to); if (c) post(c.link, () => c.ev.emit('message', msg), msg); }, on: ev.on, close() { host.closed = true; for (const c of host.peers.values()) c.drop(); } };
    },
    connect({ key } = {}) {
      const ev = emitter();
      const id = keys.get(key) ?? ++nextId, secret = key && keys.has(key) ? key : 'k' + id + '-' + Math.floor(rand() * 1e9);
      keys.set(secret, id);
      const c = { ev, link: { at: 0 }, up: { at: 0 }, open: false, id };
      c.drop = () => { if (!c.open) return; c.open = false; host.peers.delete(id); host.ev.emit('leave', id); ev.emit('close'); };
      const t = {
        id, key: secret,
        send(msg) { if (c.open && !host.closed) post(c.up, () => { if (c.open) host.ev.emit('message', msg, id); }, msg); },
        on: ev.on,
        close: () => c.drop(),
        /** Simulate a dropped connection (both sides notice at once) */
        drop: () => c.drop(),
      };
      // the connection itself opens after one latency, like a handshake
      post(c.link, () => { if (!host || host.closed) return; c.open = true; host.peers.set(id, c); ev.emit('open'); host.ev.emit('join', id); }, null, true);
      return t;
    },
  };
  // schedule one delivery: keep per-link order (a later message never overtakes), drop with probability loss
  function post(link, fn, msg, reliable = false) {
    if (!reliable && W.loss > 0 && rand() < W.loss) return;
    const copy = msg == null ? null : structuredClone(msg);
    const at = Math.max(clock() + W.latency + rand() * W.jitter, link.at);
    link.at = at;
    queue.push({ at, fn: () => fn(copy) });
    queue.sort((a, b) => a.at - b.at);
    if (!manual && !timer) timer = setTimeout(tick, Math.max(0, at - clock()));   // wall-clock
  }
  function flush() { while (queue.length && queue[0].at <= clock()) queue.shift().fn(); }
  function tick() { timer = null; flush(); if (queue.length) timer = setTimeout(tick, Math.max(0, queue[0].at - clock())); }   // wall-clock
  return W;
}

/**
 * WebSocket transport: talks to the relay in packages/tools/net-relay.mjs (`node packages/tools/net-relay.mjs 8787`).
 * The host joins a room with host: true; clients join the same room. The relay assigns peer ids and remembers each client's key for reconnects.
 * Messages are JSON. For a dedicated server or Colyseus, write another transport with the same send / on / close shape instead.
 * @param {string} url e.g. 'ws://localhost:8787/my-room'
 * @param {{ host?: boolean, key?: string }} [opts] key: reuse a previous peer id after a reconnect (read transport.key after 'open')
 * @returns {{ send(msg: any, to?: number): void, on(type: string, fn: Function): { remove(): void }, close(): void, key: string | null, id: number | null }}
 * @example
 * engine.use(net({ role: 'host', transport: webSocket('ws://localhost:8787/farm', { host: true }) }));
 * // on a friend's machine
 * const t = webSocket('ws://192.168.1.5:8787/farm', { key: localStorage.netKey });
 * t.on('open', () => { localStorage.netKey = t.key; });
 * engine.use(net({ role: 'client', transport: t }));
 * @experimental
 */
export function webSocket(url, { host = false, key } = {}) {
  const ev = emitter(), q = new URL(url);
  if (host) q.searchParams.set('host', '1');
  if (key) q.searchParams.set('key', key);
  const ws = new WebSocket(q.href);
  const t = {
    key: key ?? null, id: null,
    send(msg, to) { if (ws.readyState === 1) ws.send(JSON.stringify(host ? { to, msg } : { msg })); },
    on: ev.on,
    close() { ws.close(); },
  };
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.hello) { t.id = d.hello.id; t.key = d.hello.key ?? null; if (!host) ev.emit('open'); }
    else if (d.join != null) ev.emit('join', d.join);
    else if (d.leave != null) ev.emit('leave', d.leave);
    else if (d.closed) ws.close();
    else ev.emit('message', d.msg, d.from);
  };
  ws.onclose = () => ev.emit('close');
  return t;
}
