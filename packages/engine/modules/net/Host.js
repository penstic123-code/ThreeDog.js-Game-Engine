// Host side of net(): the host owns the state. Peers only send requests; the host decides who they are, what they may do and how often.
// Order of checks for a peer request { name, args, seq } (why each one lives here and not in every op's can):
//   rate limit -> op exists -> op says net: 'peer' (default deny) -> args match the op's shape (always, not only in dev: peers are untrusted)
//   -> owner (op.owner(args) names a world record whose owner must be this peer's actor) -> ops.run with source 'net' and the actor
//      taken from the connection, never from the message.
// Replies (op results) go out after the next state diff, so a client sees the new state before it hears "done".
import { checkArgs } from '../../core/opsCheck.js';
import { partKeys, diffParts, snapshotParts } from './sync.js';

const STEP = 1 / 60;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const plainScalar = v => v === null || typeof v === 'string' || typeof v === 'boolean' || isNum(v);

/** @internal */
export class NetHost {
  constructor(e, t, o) {
    this.e = e; this.t = t; this.o = o;
    /** peer id -> { id, actor, tokens, results, posTick } */ this.peers = new Map();
    /** [message, from] of ops and positions received since the last fixed step (see receive) */ this.inbox = [];
    this.n = 0;                  // diff counter: a client that sees a gap asks for a snapshot
    this.base = new Map();       // shared baseline (sync.js)
    this.keys = null;
    this.steps = 0; this.lastSent = 0;
    this.stats = { in: 0, out: 0, rejected: 0, diffs: 0, snapshots: 0 };
    this.subs = [t.on('join', id => this.join(id)), t.on('leave', id => this.leave(id)), t.on('message', (m, from) => this.receive(m, from))];
  }
  send(msg, peer) { this.stats.out++; this.t.send(msg, peer.id); }

  join(id) {
    const e = this.e, o = this.o;
    const peer = { id, actor: o.actorFor(id), tokens: o.burst, results: [], posTick: e.time.tick };
    this.peers.set(id, peer);
    e.ops.allow(() => o.join(e, peer));   // setting up the peer's avatar / bag is host bookkeeping, not a gameplay action
    e.events.emit('net:join', { peer: id, actor: peer.actor });
    this.snapshot(peer);
  }
  leave(id) {
    const e = this.e, peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    e.ops.allow(() => this.o.leave(e, peer));
    e.events.emit('net:leave', { peer: id, actor: peer.actor });
  }
  snapshot(peer) {
    this.keys ??= partKeys(this.e, this.o.sync);
    this.stats.snapshots++;
    this.send({ t: 's', n: this.n, tick: this.e.time.tick, you: peer.actor, every: this.o.syncEvery, parts: snapshotParts(this.e, this.keys) }, peer);
  }

  receive(m, from) {
    const peer = this.peers.get(from);
    if (!peer || !m || typeof m !== 'object') return;
    this.stats.in++;
    // ops and positions change gameplay state, so they wait for the next fixed step (game logic only in fixed steps): run here, inside a network
    // callback, they landed between steps at a time set by the network, not by the tick (review 0.4 B). A resync only sends, so it answers now
    if (m.t === 'op' || m.t === 'p') this.inbox.push([m, from]);
    else if (m.t === 'resync') this.snapshot(peer);
  }
  /** @internal start of the fixed step: apply what arrived since the last one, in arrival order (a peer that left meanwhile is skipped) */
  drain() {
    const box = this.inbox; this.inbox = [];
    for (const [m, from] of box) {
      const peer = this.peers.get(from); if (!peer) continue;
      if (m.t === 'op') this.request(peer, m); else this.position(peer, m);
    }
  }

  request(peer, m) {
    const e = this.e, seq = isNum(m.seq) ? m.seq : 0, name = typeof m.name === 'string' ? m.name : '';
    const reply = (ok, code, value) => peer.results.push({ t: 'r', seq, name, ok, code: code ?? null, value: plain(value), tick: e.time.tick });
    const d = e.ops.defs.get(name), args = m.args ?? {};
    const reason = this.gate(peer, d, args);
    if (reason) {
      this.stats.rejected++;
      if (d) e.ops.refused(name, args, { reason, actor: peer.actor });   // keep refusals in the op history too
      reply(false, reason);
      return;
    }
    const r = e.ops.run(name, args, { source: 'net', actor: peer.actor });
    reply(r.ok, r.code, r.value);
  }
  /** returns a reason string when the request is refused at the door */
  gate(peer, d, args) {
    if (peer.tokens < 1) return 'rateLimited';
    peer.tokens--;
    if (!d) return 'unknownOp';
    if (d.net !== 'peer') return 'notAllowed';
    try { checkArgs(this.e, d, args); } catch { return 'badArgs'; }
    if (d.owner) {
      let id; try { id = d.owner(args); } catch { return 'notOwner'; }
      if (this.e.world?.get(id)?.owner !== peer.actor) return 'notOwner';
    }
    return null;
  }

  /** the peer's own movement (client-driven): clamp to maxSpeed so a hacked client cannot teleport */
  position(peer, m) {
    const e = this.e, rec = e.world?.get(peer.actor), p = m.p;
    if (!rec || !Array.isArray(p) || p.length !== 3 || !p.every(isNum)) return;
    const dt = Math.min(0.25, Math.max(STEP, (e.time.tick - peer.posTick) * STEP));   // idle time earns no long jump
    peer.posTick = e.time.tick;
    const c = rec.position, dx = p[0] - c.x, dy = p[1] - c.y, dz = p[2] - c.z, d = Math.hypot(dx, dy, dz), max = this.o.maxSpeed * dt + 0.5;
    const k = d > max ? max / d : 1;
    e.ops.allow(() => {
      e.world.move(peer.actor, { x: c.x + dx * k, y: c.y + dy * k, z: c.z + dz * k });
      const f = m.f && typeof m.f === 'object' ? m.f : {};
      for (const key of this.o.avatarFields) if (key in f && plainScalar(f[key])) rec[key] = f[key];
    });
  }

  fixed(dt) {
    const o = this.o;
    this.drain();
    for (const p of this.peers.values()) p.tokens = Math.min(o.burst, p.tokens + o.rate * dt);
    if (++this.steps % o.syncEvery) return;
    this.keys ??= partKeys(this.e, o.sync);
    const parts = diffParts(this.e, this.keys, this.base);
    if (parts) { this.n++; this.stats.diffs++; this.lastSent = this.steps; for (const p of this.peers.values()) this.send({ t: 'd', n: this.n, tick: this.e.time.tick, parts }, p); }
    else if (this.steps - this.lastSent >= o.keepAlive) { this.lastSent = this.steps; for (const p of this.peers.values()) this.send({ t: 'k', n: this.n }, p); }   // lets a client notice a lost last diff
    for (const p of this.peers.values()) { for (const r of p.results) this.send(r, p); p.results.length = 0; }
  }
  // close the transport as the client does: otherwise a webSocket host stays in the relay room after engine.dispose() (heartbeat still
  // running) and the other players never see the host leave
  dispose() { for (const s of this.subs) s.remove(); this.t.close?.(); }
}

/** op return values travel as plain data; anything else (a three.js object, a function) is dropped */
function plain(v) {
  if (v === undefined) return undefined;
  try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
}
