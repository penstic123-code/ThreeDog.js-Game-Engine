// Simulation layer of world: near records every fixed step, far records in id buckets taking turns under a per-step cap. The public API is in World.js
// (simulate / anchor); this is the implementation.
// Time: the dt of both near and far is "accumulated fixed-step seconds" (same ruler as every engine hook's dt, not multiplied by clock.timeScale).
// For one record going near, far, near again, the dts add up to the elapsed time:
//   far dt = seconds accumulated since the last simulation; on the far → near step, far first pays back the owed time, then near runs.
// A kind with only far (crops) does not split near / far and always advances at far's pace; a kind with only near is not simulated while far and its owed time
// is not made up.
// Owed time is saved: it is paid back after loading, so simulate code never tracks time itself.
// Determinism: near / far is split by the gameplay anchor (world.anchor), far work is capped by count with the rest queued first for the next step, and buckets
// follow the step count (saved) —
// so the result depends only on data and step count, not on machine speed, frame rate or whether models are built.
// Far with worker: true goes through simFar.js (batched to engine.threads, written back on a fixed later step through commits).
// Near order: at the start of each step collect records inside the radius, then simulate them sorted by id — order inside a cell depends on insertion order and
// changes after loading;
// when near records affect each other (avoiding each other, fighting over the same thing), sorting by id keeps "kept running" and "saved then loaded"
// bit-identical.

import { DEV, checkOptionsArg } from '../../core/validate.js';
import { FarFlights } from './simFar.js';

/** Near simulation order: by id (independent of insertion order and loading) */
const byId = (a, b) => a.rec.id < b.rec.id ? -1 : 1;
/** Simple hash of id: far simulation uses it to pick a bucket (computed once per record, stored on ent) */
const hashOf = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return h >>> 0; };

/** @internal */
export class Sim {
  /** @param {import('./World.js').World} w */
  constructor(w) {
    this.w = w;
    this.sims = new Map();    // kind → { near, far, farEvery, radius }
    this.ents = new Map();    // id → { rec, h, last, near, queued, dead }: last = time of the last simulation, near = step number of the last near simulation
    this.kinds = new Map();   // kind → { set: Set<ent>, P, buckets }: P is the far period (steps), buckets[step % P] is this step's turn
    this.owed = new Map();    // from a save, content not added yet: id → time of the last simulation (used when added)
    this.backlog = [];        // far simulations left undone by the previous step's cap (FIFO, done first next step)
    this.time = 0;            // accumulated simulation seconds (saved)
    this.n = 0;               // simulation step count (saved: buckets follow it, so after loading the same batch is up as in a live run)
    this.at = { x: 0, z: 0 }; // this step's simulation center (taken from world.anchor at the start of each step)
    this.dt = 0;
    this.list = [];           // records to simulate near this step (reused, not allocated each step)
    this.flights = new FarFlights(this);   // far with worker: true (simFar.js)
    // created once, no closure per step
    this._pick = (rec, d2) => { const s = this.sims.get(rec.kind); if (s && d2 <= s.r2 && this.w._inZone(rec)) this.list.push(this.ents.get(rec.id)); };
  }

  simulate(kind, opts) {
    if (DEV) checkOptionsArg(`world.simulate('${kind}', opts)`, opts, ['near', 'far', 'farEvery', 'radius', 'worker']);
    const s = { ...opts };
    if (s.worker && s.far) this.flights.register(kind, s);
    this.sims.set(kind, s);
    return { remove: () => { if (this.sims.get(kind) === s) this.sims.delete(kind); } };
  }
  /** A new record starts counting time from the moment it is added (owed time from a save carries on) */
  added(rec) {
    const id = rec.id, o = this.owed.get(id);
    if (o !== undefined) this.owed.delete(id);
    const e = { rec, h: hashOf(id), last: o ?? this.time, near: -1, queued: false, dead: false, flight: null };
    this.ents.set(id, e);
    let K = this.kinds.get(rec.kind); if (!K) this.kinds.set(rec.kind, K = { set: new Set(), P: 0, buckets: null });
    K.set.add(e); if (K.P) K.buckets[e.h % K.P].add(e);
  }
  removed(id) {
    const e = this.ents.get(id); if (!e) return;
    this.ents.delete(id); e.dead = true;   // queued entries are skipped when seen dead
    const K = this.kinds.get(e.rec.kind); K.set.delete(e); if (K.P) K.buckets[e.h % K.P].delete(e);
  }
  /** This record was simulated near in the latest step (the presentation layer uses it to keep positionFrom 'view' models) */
  isNear(id) { return this.ents.get(id)?.near === this.n; }

  /** Near radius: the written one, else the presentation radius. Models that move themselves (positionFrom 'view') widen to the teardown distance (1.25×) —
   *  why: the model may still exist within that distance, and one with a model must run near, otherwise far changes to the data get copied back over by world from the model position */
  radius(kind, s) {
    const W = this.w, V = W._v, p = V.presenters.get(kind);
    if (s.radius != null) return typeof s.radius === 'function' ? s.radius() : s.radius;
    if (!p) return W.radius;
    return V.radius(p) * (p.positionFrom === 'view' ? 1.25 : 1);
  }

  fixed(dt, anchor) {
    const W = this.w, now = this.time += dt, n = ++this.n;
    this.at.x = anchor.x; this.at.z = anchor.z; this.dt = dt;
    if (!this.sims.size) return;
    let maxR2 = -1;
    // radius may be a function: asked once per kind per step
    for (const [kind, s] of this.sims) { s.r2 = s.near ? this.radius(kind, s) ** 2 : -1; if (s.r2 > maxR2) maxR2 = s.r2; }
    if (maxR2 >= 0) {
      const L = this.list; L.length = 0;
      W._cells.forEach(this.at, Math.sqrt(maxR2), this._pick);
      L.sort(byId);
      for (const e of L) e.near = n;   // mark first: isNear in simulate and skipping far both follow what was picked at the start of this step
      for (const e of L) if (!e.dead) this.nearOne(e);
    }
    // far: first the ones queued by the previous step, then this step's bucket; at most farMaxPerTick per step, the rest queue (dt accumulates, no time lost)
    const max = W.farMaxPerTick, q = this.backlog;
    let done = 0, i = 0;
    for (; i < q.length && done < max; i++) {
      const e = q[i]; e.queued = false;
      const s = !e.dead && this.sims.get(e.rec.kind);
      if (s?.far && !e.flight) done += this.farOne(e, s, now);
    }
    if (i) q.splice(0, i);
    for (const [kind, s] of this.sims) {
      const K = s.far && this.kinds.get(kind); if (!K?.set.size) continue;
      const P = Math.max(1, Math.round((s.farEvery ?? W.farEvery) / dt));
      if (K.P !== P) this.rebucket(K, P);
      for (const e of K.buckets[n % P]) {
        if (e.near === n || e.queued || e.flight) continue;
        if (done >= max) { e.queued = true; q.push(e); continue; }
        done += this.farOne(e, s, now);
      }
    }
    this.flights.flush();
  }
  nearOne(e) {
    const rec = e.rec, s = this.sims.get(rec.kind), now = this.time, dt = this.dt;
    if (!s?.near) return;   // earlier simulation in this step replaced the registration of this kind
    // For records whose model drives the position (positionFrom 'view'): near simulation needs the model, so build it right now instead of next frame —
    // otherwise the steps before the model is built and the first step after loading would differ from a live run (the result would depend on frame boundaries)
    const V = this.w._v, p = V.presenters.get(rec.kind);
    if (p?.positionFrom === 'view' && !V.map.has(rec.id) && (!p.show || p.show(rec))) V.build(rec, p);
    if (e.flight) this.flights.land(e);
    const owed = now - dt - e.last;   // just came in from far: first make up the stretch far has not simulated
    e.last = now;
    if (owed > 1e-9 && s.far) s.far(rec, owed);
    s.near(rec, dt, this.w.view(rec.id));
  }
  farOne(e, s, now) {
    const dt = now - e.last;
    e.last = now;
    if (dt <= 0) return 0;   // added during this step
    if (s.pure) this.flights.add(e, s, dt); else s.far(e.rec, dt);
    return 1;
  }
  /** engine.skip: move simulation time without stepping; on the last segment (done) every record with far catches up what it owes in one far(rec, dt), in id order.
   *  Same rule as a far turn: kinds with only near are not made up. Worker kinds run here synchronously (the skip result must exist when skip returns) */
  skip(dt, done) {
    const now = this.time += dt;
    if (!done) return;
    for (const e of [...this.ents.values()].sort(byId)) {
      const s = !e.dead && this.sims.get(e.rec.kind);
      if (!s?.far) continue;
      if (e.flight) this.flights.land(e);
      const owed = now - e.last;
      e.last = now;
      if (owed <= 0) continue;
      if (s.pure) this.flights.now(e, s, owed); else s.far(e.rec, owed);
    }
  }
  rebucket(K, P) {
    K.P = P; K.buckets = Array.from({ length: P }, () => new Set());
    for (const e of K.set) K.buckets[e.h % P].add(e);
  }

  /** Save: step count, accumulated seconds, and how many seconds each far-simulated record still owes (near ones simulate every step, owe nothing, are not written).
   *  Step count and seconds are saved too: after loading buckets take turns in the same batch and dt has the same float error, so one save advances the same way every time */
  toJSON() {
    const owed = {}, W = this.w, t = this.time;
    // in flight (worker far not landed): the record does not have that stretch yet, so it is still owed
    // only kinds simulated with far owe time: a prop, pickup or near-only kind never makes it up, so it writes nothing (saves stay small)
    for (const [id, e] of this.ents) {
      if (!this.sims.get(e.rec.kind)?.far) continue;
      const last = e.flight ? e.flight.from : e.last;
      if (t - last > 1e-6 && !W._unsaved.has(id)) owed[id] = t - last;
    }
    for (const [id, last] of this.owed) owed[id] = t - last;   // those whose content is not added back yet are written too (used on the next add)
    return { step: this.n, time: t, owed };
  }
  /** Load: work back the last simulation time from "seconds owed"; records are re-added later by loadWorld */
  fromJSON(d) {
    for (const e of this.ents.values()) e.dead = true;   // results still in flight belong to the old records: dropped
    this.ents.clear(); this.kinds.clear(); this.backlog.length = 0;
    this.n = d?.step ?? 0; this.time = d?.time ?? 0;
    this.owed = new Map(Object.entries(d?.owed || {}).map(([id, s]) => [id, this.time - s]));
  }
}
