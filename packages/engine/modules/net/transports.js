// Transports for net(): how messages travel between the host and its peers. net() only uses this small shape, so any carrier
// (a Colyseus room, a WebRTC data channel, a game server) plugs in by implementing it:
//   send(msg, to?)   deliver a plain-object message; on the host `to` is a peer id, on a client it goes to the host
//   on(type, fn)     host: 'join' (peerId), 'leave' (peerId), 'message' (msg, from); client: 'open', 'close', 'message' (msg)
//   close()
// Delivery must keep order per link (WebSocket does); messages may be lost (the sync recovers with a full snapshot).
// Peer ids come from the transport, never from what a client says about itself: they are the identity the host's actor ids are built on.
// A reconnecting client presents `key` (a secret the transport handed it on first connect) to get its old peer id back.
// Heartbeat: a link can die without a close (Wi-Fi gone, laptop lid shut, NAT timeout); TCP may take minutes to notice. A client transport with
// heartbeat pings every heartbeat ms and treats 3 intervals without anything received as dead: it emits 'close' itself, so net:close fires and the
// game can reconnect. Pings and pongs never reach the net() code. Reconnecting is the game's call by default (engine.net.reconnect(transport) on
// net:close, the Client's documented path, so the game can show "reconnecting..." or give up); webSocket({ reconnect: true }) retries by itself.
import { Random } from '../../core/Random.js';
import { codedError } from '../../core/errorHints.js';

const MISSED = 3;   // heartbeat intervals without any message before the link counts as dead

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
 * connect({ heartbeat }) turns on the ping / pong check for that client (off by default here so loss and jitter replay the same); a client's cut()
 * kills its link silently in both directions, which only the heartbeat notices (then the client gets 'close' and the host 'leave').
 * @param {{ latency?: number, jitter?: number, loss?: number, seed?: number, manual?: boolean }} [opts] latency / jitter in ms, loss 0..1
 * @returns {{ host(): any, connect(opts?: { key?: string, heartbeat?: number }): any, advance(ms: number): void, readonly now: number, loss: number, latency: number, jitter: number }}
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
  const beating = new Set();   // clients with a heartbeat
  const clock = () => manual ? now : performance.now();   // wall-clock: a simulated wire delays by real time, like a real one
  const W = {
    latency: opts.latency ?? 0, jitter: opts.jitter ?? 0, loss: opts.loss ?? 0,
    get now() { return clock(); },
    /** Deliver everything due within the next ms (manual mode) */
    advance(ms) { now += ms; flush(); for (const c of beating) beat(c); },
    host() {
      const ev = emitter();
      host = { ev, peers: new Map(), closed: false };
      return { send: (msg, to) => { const c = host.peers.get(to); if (c) post(c.link, () => c.ev.emit('message', msg), msg, false, c); }, on: ev.on, close() { host.closed = true; for (const c of host.peers.values()) c.drop(); } };
    },
    connect({ key, heartbeat = 0 } = {}) {
      const ev = emitter();
      const id = keys.get(key) ?? ++nextId, secret = key && keys.has(key) ? key : 'k' + id + '-' + Math.floor(rand() * 1e9);
      keys.set(secret, id);
      const c = { ev, link: { at: 0 }, up: { at: 0 }, open: false, id, cut: false, heartbeat, seen: 0, pinged: 0 };
      c.drop = () => { if (!c.open) return; c.open = false; beating.delete(c); clearInterval(c.timer); host.peers.delete(id); host.ev.emit('leave', id); ev.emit('close'); };
      // the host side answers pings itself (like the relay does), so net() never sees them
      c.ping = () => post(c.up, () => { if (c.open) post(c.link, () => {}, null, false, c); }, null, false, c);
      const t = {
        id, key: secret,
        send(msg) { if (c.open && !host.closed) post(c.up, () => { if (c.open) host.ev.emit('message', msg, id); }, msg, false, c); },
        on: ev.on,
        close: () => c.drop(),
        /** Simulate a dropped connection (both sides notice at once) */
        drop: () => c.drop(),
        /** Simulate a link that dies silently (no close on either side): only the heartbeat notices */
        cut: () => { c.cut = true; },
      };
      // the connection itself opens after one latency, like a handshake
      post(c.link, () => {
        if (!host || host.closed) return; c.open = true; host.peers.set(id, c); c.seen = c.pinged = clock(); ev.emit('open'); host.ev.emit('join', id);
        if (heartbeat > 0) { beating.add(c); if (!manual) c.timer = setInterval(() => beat(c), heartbeat / 2); }   // wall-clock
      }, null, true);
      return t;
    },
  };
  // schedule one delivery: keep per-link order (a later message never overtakes), drop with probability loss; a cut link swallows everything
  function post(link, fn, msg, reliable = false, c = null) {
    if (c?.cut) return;
    if (!reliable && W.loss > 0 && rand() < W.loss) return;
    const copy = msg == null ? null : structuredClone(msg);
    const at = Math.max(clock() + W.latency + rand() * W.jitter, link.at);
    link.at = at;
    queue.push({ at, fn: () => { if (c && link === c.link && !c.cut) c.seen = clock(); fn(copy); } });   // seen: what the client received
    queue.sort((a, b) => a.at - b.at);
    if (!manual && !timer) timer = setTimeout(tick, Math.max(0, at - clock()));   // wall-clock
  }
  // one heartbeat check: dead after MISSED intervals with nothing received, else ping once per interval
  function beat(c) {
    if (!c.open) return;
    const t = clock();
    if (t - c.seen > c.heartbeat * MISSED) return c.drop();
    if (t - c.pinged >= c.heartbeat) { c.pinged = t; c.ping(); }
  }
  function flush() { while (queue.length && queue[0].at <= clock()) queue.shift().fn(); }
  function tick() { timer = null; flush(); if (queue.length) timer = setTimeout(tick, Math.max(0, queue[0].at - clock())); }   // wall-clock
  return W;
}

/**
 * WebSocket transport: talks to the relay in packages/tools/net-relay.mjs (`node packages/tools/net-relay.mjs 8787`).
 * The host joins a room with host: true; clients join the same room. The relay assigns peer ids and remembers each client's key for reconnects.
 * Messages are JSON. For a dedicated server or Colyseus, write another transport with the same send / on / close shape instead.
 * heartbeat (ms, default 2000, 0 = off): ping the relay that often; 3 intervals with nothing received closes the link and emits 'close'.
 * reconnect (clients only, default false): after a close, open again with the same key, waiting 0.5 s, 1 s, 2 s ... up to 15 s between tries; 'open' fires
 * again on success (net() then asks the host for a full snapshot). Off by default: engine.net.reconnect(webSocket(url, { key })) on net:close is the
 * documented path and leaves the game in charge of retries and messages; t.close() stops a reconnecting transport.
 * @param {string} url e.g. 'ws://localhost:8787/my-room'
 * @param {{ host?: boolean, key?: string, heartbeat?: number, reconnect?: boolean }} [opts] key: reuse a previous peer id after a reconnect (read transport.key after 'open')
 * @returns {{ send(msg: any, to?: number): void, on(type: string, fn: Function): { remove(): void }, close(): void, key: string | null, id: number | null }}
 * @example
 * engine.use(net({ role: 'host', transport: webSocket('ws://localhost:8787/farm', { host: true }) }));
 * // on a friend's machine
 * const t = webSocket('ws://192.168.1.5:8787/farm', { key: localStorage.netKey });
 * t.on('open', () => { localStorage.netKey = t.key; });
 * engine.use(net({ role: 'client', transport: t }));
 * @experimental
 */
export function webSocket(url, { host = false, key, heartbeat = 2000, reconnect = false } = {}) {
  if (host && reconnect) throw codedError('net-option', 'webSocket(url, { host: true, reconnect: true }): only clients reconnect; a host that lost the relay starts a new room');
  const ev = emitter();
  let ws = null, beat = 0, seen = 0, tries = 0, stopped = false, retry = 0;
  const t = {
    key: key ?? null, id: null,
    send(msg, to) { if (ws?.readyState === 1) ws.send(JSON.stringify(host ? { to, msg } : { msg })); },
    on: ev.on,
    close() { stopped = true; clearTimeout(retry); lost(); },
  };
  // the link is gone (closed, refused or silent): one 'close' per link, then maybe a new try
  const lost = () => {
    if (!ws) return;
    clearInterval(beat); const old = ws; ws = null;
    old.onclose = old.onmessage = null; try { old.close(); } catch { /* already closed */ }
    ev.emit('close');
    if (reconnect && !stopped) retry = setTimeout(open, Math.min(15000, 500 * 2 ** tries++));   // wall-clock
  };
  function open() {
    const q = new URL(url);
    if (host) q.searchParams.set('host', '1');
    if (t.key) q.searchParams.set('key', t.key);
    const s = ws = new WebSocket(q.href);
    seen = performance.now();   // wall-clock
    s.onmessage = m => {
      seen = performance.now();   // wall-clock
      const d = JSON.parse(m.data);
      if (d.pong) return;
      if (d.hello) { t.id = d.hello.id; t.key = d.hello.key ?? null; tries = 0; if (!host) ev.emit('open'); }
      else if (d.join != null) ev.emit('join', d.join);
      else if (d.leave != null) ev.emit('leave', d.leave);
      else if (d.closed) { stopped = true; lost(); }   // the host closed the room: it is gone for good, retrying would knock on it forever
      else ev.emit('message', d.msg, d.from);
    };
    s.onclose = lost;
    if (heartbeat > 0) beat = setInterval(() => {   // wall-clock
      if (performance.now() - seen > heartbeat * MISSED) return lost();   // wall-clock
      if (s.readyState === 1) s.send('{"ping":1}');
    }, heartbeat);
  }
  open();
  return t;
}
