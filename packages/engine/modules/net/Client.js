// Client side of net(): a read-only mirror of the host. It never changes shared state itself:
//   - ops.run of a net: 'peer' op checks can locally (instant feedback, e.g. grey out "buy" without gold), sends { name, args, seq } and returns
//     { ok: true, pending: true, seq }; other ops are refused here ('notAllowed') except net: 'local' ones, which run on this machine
//     (ops they call are routed the same way, so a local "quick buy" button still asks the host to buy).
//   - snapshots / diffs from the host are queued and applied in the next fixed step (inside ops.allow, the only window the client guard opens).
//   - the own avatar is driven locally and its position sent to the host every few steps; other avatars glide between updates (plain interpolation;
//     prediction / rollback is a later step).
//   - world.simulate does not run here: the host simulates and the result arrives as diffs (two simulations would fight).
import { applyPart, idMap } from './sync.js';
import { failure } from '../../core/opsFail.js';

const STEP = 1 / 60;
const ASK_EVERY = 30;   // steps between snapshot requests while out of step

/** @internal */
export class NetClient {
  constructor(e, t, o) {
    this.e = e; this.o = o;
    this.actor = null;        // this client's actor id on the host (e.g. 'guest-1'); here it is called 'player'
    this.n = -1; this.synced = false; this.since = 0;
    this.inbox = []; this.pending = new Map(); this.seq = 0;
    this.glides = new Map(); this.every = o.syncEvery; this.lastPos = '';
    this.map = idMap(null);
    this.stats = { in: 0, out: 0, diffs: 0, snapshots: 0, gaps: 0 };
    this.connected = false;
    this.routed = e.ops.route((d, args, opts) => this.route(d, args, opts));   // ops go to the host
    this.noSim = e.world?.pauseSimulation();   // the host simulates; see the top of the file
    this.connect(t);
  }

  /** (Re)attach a transport, e.g. after a dropped connection: the host answers with a full snapshot */
  connect(t) {
    for (const s of this.subs || []) s.remove();
    this.t?.close?.();
    this.t = t; this.connected = false; this.synced = false; this.n = -1; this.inbox.length = 0;
    this.subs = [
      t.on('open', () => { this.connected = true; this.since = this.e.time.tick; this.e.events.emit('net:open', {}); }),
      t.on('close', () => { this.connected = false; this.synced = false; this.e.events.emit('net:close', {}); }),
      t.on('message', m => { if (m && typeof m === 'object') { this.stats.in++; this.inbox.push(m); } }),
    ];
  }
  send(msg) { this.stats.out++; this.t.send(msg); }

  route(d, args, opts) {
    if (d.net === 'local') return null;
    if (d.net !== 'peer') return failure('notAllowed');
    if (!this.synced) return failure('offline');
    const c = this.e.ops.can(d.name, args, opts);
    if (!c.ok) return c;
    const seq = ++this.seq, out = {};
    for (const k in args) out[k] = typeof args[k] === 'string' ? this.map.toHost(args[k]) : args[k];   // 'player' here means this client's actor there
    this.pending.set(seq, d.name);
    this.send({ t: 'op', seq, name: d.name, args: out });
    return { ok: true, pending: true, seq };
  }

  fixed() {
    const e = this.e;
    if (this.inbox.length) {
      const box = this.inbox.splice(0);
      e.ops.allow(() => { for (const m of box) this.handle(m); });
    }
    if (this.synced && e.time.tick % this.o.posEvery === 0) this.sendPosition();
  }
  handle(m) {
    const e = this.e;
    if (m.t === 's') {
      this.actor = m.you; this.map = idMap(m.you); this.every = m.every ?? this.every;
      this.glides.clear();
      this.apply(m.parts, true);
      this.n = m.n; this.synced = true; this.stats.snapshots++;
      e.events.emit('net:sync', { tick: m.tick, full: true });
    } else if (m.t === 'd') {
      if (!this.synced || m.n <= this.n) return;
      if (m.n !== this.n + 1) return this.gap();
      this.apply(m.parts, false);
      this.n = m.n; this.stats.diffs++;
      e.events.emit('net:sync', { tick: m.tick, full: false });
    } else if (m.t === 'k') {
      if (this.synced && m.n > this.n) this.gap();
    } else if (m.t === 'r') {
      this.pending.delete(m.seq);
      e.events.emit('net:result', { seq: m.seq, name: m.name, ok: m.ok, code: m.code, value: m.value, tick: m.tick });
    }
  }
  /** a diff was lost: stop applying diffs and ask for a snapshot (frame asks again if that is lost too) */
  gap() {
    this.synced = false; this.stats.gaps++;
    this.since = this.e.time.tick;
    this.send({ t: 'resync' });
  }
  apply(parts, full) {
    const o = this.o, opts = {
      toLocal: this.map.toLocal, actorFields: o.actorFields, avatarFields: o.avatarFields,
      smooth: rec => o.interpolate.includes(rec.kind),
      glide: (id, to) => this.glides.set(id, { from: { ...this.e.world.get(id).position }, to: { ...to }, t: 0, dur: this.every * STEP }),
    };
    for (const key in parts) {
      if (key !== 'world' && key !== 'vars' && key !== 'containers' && !this.e.saves.providers.has(key)) continue;
      if (key === 'world' && !this.e.world) continue;
      if (key === 'containers' && !this.e.inventory) continue;
      applyPart(this.e, key, parts[key], full, opts);
      if (key === 'world') for (const hostId in full ? parts[key] : parts[key].set ?? {}) this.hold(this.map.toLocal(hostId));
    }
  }
  /**
   * A character the host drives (an NPC, another player's avatar): net holds its control slot for good (core/control.js, layer 'net'), so a
   * local walkTo / cutscene / script on it is a control-net error instead of a move the next diff silently undoes. Own avatar: ours, never held.
   */
  hold(id) {
    const rec = this.e.world.get(id);
    if (!rec || id === 'player' || !(rec.kind === 'npc' || this.o.interpolate.includes(rec.kind)) || this.o.control.has(id, 'net')) return;
    this.o.control.take(id, { owner: 'net', layer: 'net' });
  }
  sendPosition() {
    const rec = this.e.world?.get('player');
    if (!rec) return;
    const p = rec.position, f = {};
    for (const k of this.o.avatarFields) if (k in rec) f[k] = rec[k];
    const key = `${p.x},${p.y},${p.z},${JSON.stringify(f)}`;
    if (key === this.lastPos && this.e.time.tick % 60) return;   // unchanged: resend once a second anyway, in case the last one was lost
    this.lastPos = key;
    this.send({ t: 'p', p: [p.x, p.y, p.z], f });
  }

  frame(dt) {
    // out of step (snapshot or the request for it lost, or the first one never came): ask again
    if (!this.synced && this.connected && this.e.time.tick - this.since >= ASK_EVERY) { this.since = this.e.time.tick; this.send({ t: 'resync' }); }
    if (!this.glides.size) return;
    const W = this.e.world;
    for (const [id, g] of this.glides) {
      if (!W.get(id)) { this.glides.delete(id); continue; }
      g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      W.move(id, { x: g.from.x + (g.to.x - g.from.x) * k, y: g.from.y + (g.to.y - g.from.y) * k, z: g.from.z + (g.to.z - g.from.z) * k });
      if (k >= 1) this.glides.delete(id);
    }
  }
  dispose() {
    for (const s of this.subs) s.remove();
    this.t.close?.();
    this.routed.remove(); this.noSim?.remove();
  }
}
