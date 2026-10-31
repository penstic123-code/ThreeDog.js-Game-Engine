// NPC-vs-NPC avoidance (near NPCs, every fixed step, called from goTo): nearby NPCs push each other apart to at least the sum of their radii; the player is an
// obstacle (NPCs yield, the player is never pushed).
// Why it is written this way: a continuous run and a save-then-load of the same scenario must give bit-identical positions:
// 1. Each NPC pushes only itself and reads neighbours' positions as of the start of this step (stamped), so a neighbour that already moved this step does not
// matter and order is irrelevant;
// 2. Neighbour pushes are rounded before summing (neighbour iteration order changes after load; float addition order would differ in the last bit, integer
// addition does not);
//  3. No randomness, no state kept in data (start is a per-step scratch value, cleared on load).
// Push is capped (strength m/s * dt), stronger with more overlap, then constrained by engine.collision (if installed) so NPCs are not pushed into walls.
// With nav({ crowd: true }) the Recast agents decide and this adds nothing. Only near NPCs with a model; far NPCs are simulated from data without per-NPC
// avoidance (too costly).
import { checkOptions } from '../../core/validate.js';

const KEYS = ['on', 'radius', 'strength'];
// push direction is rotated ~25° to the right: two NPCs meeting head-on each swerve to their own right instead of deadlocking in a line
const COS = 0.906, SIN = 0.423;
const Q = 1048576;   // rounding scale before summing (2^20)

const cellKey = (x, z) => (x + 1048576) * 2097152 + z + 1048576;

/**
 * Push from one neighbour (offset (dx, dz) from me, distance d, wanted separation min), rounded and added to acc; exactly overlapping picks the direction by
 * tie (±1)
 */
function shove(acc, dx, dz, d, min, tie) {
  // more overlap pushes harder, a light touch pushes gently: smooth
  const w = Math.min(1, (min - d) / (0.5 * min)), ux = d > 1e-6 ? dx / d : tie, uz = d > 1e-6 ? dz / d : 0;
  acc.x += Math.round((ux * COS - uz * SIN) * w * Q); acc.z += Math.round((ux * SIN + uz * COS) * w * Q);
}

/** @internal @internal Mounted on engine.npcs: engine.npcs.avoid = false | { radius, strength } */
export class NpcAvoid {
  constructor(engine) {
    this.engine = engine;
    this.on = true;         // switch (default on)
    this.radius = null;     // avoid radius per NPC (m); null = engine.movement.radius
    this.strength = 3;      // max push speed (m/s)
    this._acc = { x: 0, z: 0 };
    /** @internal ids of NPCs that have a model now (NPCManager keeps it): only they take part, so far NPCs cost nothing per step */ this.built = new Set();
    this._ids = [];
    this._start = new Map();   // id → { k: simulation step count, x, z }: position at the start of this step
    // fine grid index for this step (cell size = min distance of two NPCs, query 3x3 cells): the world grid is 32 m per cell, so hundreds of NPCs in one or two
    // cells would make per-pair distance checks too costly
    this._gridN = -1; this._head = new Map(); this._next = new Int32Array(64); this._items = []; this._gx = new Float64Array(64); this._gz = new Float64Array(64);
    engine.events.on('world:remove', ({ id }) => this._start.delete(id));
    // after load the simulation step count returns to the saved value, so the old grid is stale
    engine.events.on('world:load', () => { this._start.clear(); this._gridN = -1; });
  }

  /**
   * Change settings: set(false) off, set(true) on, set({ radius, strength }) tune (pass only what changes; passing it means on). Read current values from on /
   * radius / strength.
   * @example engine.npcs.avoid.set({ radius: 0.6, strength: 2 });   // a bit sparser, pushed more slowly
   * @param {boolean | { on?: boolean, radius?: number | null, strength?: number }} opts radius per-NPC avoid radius (m, null = engine.movement.radius),
   * strength max push speed (m/s, default 3)
   * @returns {this}
   */
  set(opts) {
    this._gridN = -1;
    if (typeof opts === 'boolean') { this.on = opts; return this; }
    checkOptions('engine.npcs.avoid.set()', opts, KEYS);
    this.on = opts.on ?? true;
    if (opts.radius !== undefined) this.radius = opts.radius;
    if (opts.strength !== undefined) this.strength = opts.strength;
    return this;
  }

  /** This NPC's simulation step starts: record the start position (called from the near entry in NPC.js, before behaviours change the position) */
  stamp(rec) {
    if (!this.on) return;
    const n = this.engine.world.steps, p = rec.position;
    let s = this._start.get(rec.id);
    if (!s) this._start.set(rec.id, s = { k: n, x: p.x, z: p.z });
    else { s.k = n; s.x = p.x; s.z = p.z; }
  }

  /**
   * On the first avoid of this step, put model-bearing NPCs into the fine grid by their step-start positions (each NPC then queries only the surrounding 3x3
   * cells)
   */
  _build(W, n, min) {
    const head = this._head, items = this._items, ids = this._ids;
    ids.length = 0; for (const id of this.built) ids.push(id);
    ids.sort();   // by id: model build order depends on frames, the push order must not
    items.length = 0;
    for (const id of ids) { const o = W.get(id); if (o && W.view(id)) items.push(o); }
    head.clear(); this._gridN = n;
    if (items.length > this._next.length) { this._next = new Int32Array(items.length * 2); this._gx = new Float64Array(items.length * 2); this._gz = new Float64Array(items.length * 2); }
    for (let i = 0; i < items.length; i++) {
      const o = items[i], s = this._start.get(o.id), q = s && s.k === n ? s : o.position, c = cellKey(Math.floor(q.x / min), Math.floor(q.z / min));
      this._gx[i] = q.x; this._gz[i] = q.z;
      this._next[i] = head.get(c) ?? -1; head.set(c, i);
    }
  }

  /** Push ch (the rec's model) apart; call after ch.move, edits ch.root.position x, z directly */
  push(rec, ch, dt) {
    const e = this.engine, W = e.world;
    if (!this.on || e.nav?.crowd) return;
    const n = W.steps, own = this._start.get(rec.id), r = this.radius ?? e.movement.radius, min = 2 * r;
    if (!own || own.k !== n) return;   // did not enter via NPC.js (goTo called directly): no avoidance
    if (this._gridN !== n) this._build(W, n, min);
    const head = this._head, nx = this._next, items = this._items, gx = this._gx, gz = this._gz, min2 = min * min;
    // accumulate integers: float addition depends on order and neighbour order changes after load; rounded integer addition is exact and order-independent
    const acc = this._acc; acc.x = acc.z = 0;
    const cx = Math.floor(own.x / min), cz = Math.floor(own.z / min);
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
      for (let i = head.get(cellKey(x, z)) ?? -1; i >= 0; i = nx[i]) {
        const o = items[i], dx = own.x - gx[i], dz = own.z - gz[i], d2 = dx * dx + dz * dz;
        if (o === rec || d2 >= min2 || (o.zone != null && rec.zone != null && o.zone !== rec.zone)) continue;
        shove(acc, dx, dz, Math.sqrt(d2), min, rec.id < o.id ? 1 : -1);
      }
    }
    const pl = e.player;
    if (pl?.root) {   // the player is an obstacle: only the NPC yields, the player position belongs to the mover
      const q = pl.root.position, m = r + (pl.radius ?? r), dx = own.x - q.x, dz = own.z - q.z, d = Math.hypot(dx, dz);
      if (d < m) shove(acc, dx, dz, d, m, 1);
    }
    const ax = acc.x / Q, az = acc.z / Q;
    const len = Math.sqrt(ax * ax + az * az);
    if (!len) return;
    const k = this.strength * dt / Math.max(1, len), p = ch.root.position;
    const mx = ax * k, mz = az * k;
    p.x += mx; p.z += mz;
    // skip collision for pushes under half a centimetre (the mover keeps it out of walls next step); in a crowd every NPC is nudged every step, so this saves
    // most collision queries
    if (mx * mx + mz * mz > 2.5e-5) e.collision?.resolve(p, ch.radius);
  }
}
