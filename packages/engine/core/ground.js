// Ground API (part of Engine, mixed into Engine.prototype): whoever provides ground height is the "terrain" -- a procedural terrain module, a hand-made level, or a flat plane.
// The queries below take (x, z), or a Vector3 / Object3D directly: engine.surface(mesh.position)
import { xzOf } from './math.js';
import { checkOptions } from './validate.js';

// Default ground: an infinite flat plane at y = 0. A terrain or level module replaces it
export const flatGround = {
  height: () => 0, slope: () => 0, type: () => 'default', waterLevel: -Infinity,
};
const WATER_KEYS = ['position', 'radius', 'halfWidth', 'halfDepth', 'level'];

// engine.ground.forEachCollider = the provider's own followed by every added source; absent when there is none
function joinColliders(e) {
  const own = e._groundOwn ?? null, extra = e._groundExtra ?? [];
  const all = own ? [own, ...extra] : extra.slice();
  const g = { ...e.ground };
  if (all.length) g.forEachCollider = (x, z, range, fn) => { for (let i = 0; i < all.length; i++) all[i](x, z, range, fn); };
  else delete g.forEachCollider;
  e.ground = g;
}

export const groundMethods = {
  setGround(g) { this._groundOwn = g.forEachCollider ?? null; this.ground = { ...flatGround, ...g }; joinColliders(this); },
  /**
   * @internal module plumbing: add a source of static circle colliders (x, z, r) to engine.ground.forEachCollider, which collision and path
   * planning read. It survives a later setGround (a level installed after the module), so a module streaming its own colliders
   * (plants scattered over a level model) need not care who provides the ground. Returns { remove() }
   * @param {(x: number, z: number, range: number, fn: (x: number, z: number, r: number) => void) => void} forEach
   */
  addGroundColliders(forEach) {
    const list = (this._groundExtra ||= []);
    list.push(forEach); joinColliders(this);
    return { remove: () => { const i = list.indexOf(forEach); if (i >= 0) { list.splice(i, 1); joinColliders(this); } } };
  },
  /** Ground height. For multi-layer ground (bridges, caves) pass a reference height refY: it picks the highest layer not above refY plus one step; without it, the highest layer. When passing an object, the second argument is refY */
  surface(x, z, refY) {
    if (typeof x === 'object') { refY = z; [x, z] = xzOf(x); }
    return this.ground.height(x, z, refY);
  },
  /** Slope */
  slope(x, z) { if (typeof x === 'object') [x, z] = xzOf(x); return this.ground.slope(x, z); },
  /** Ground type (grass, sand...), used by footsteps and particles */
  groundType(x, z) { if (typeof x === 'object') [x, z] = xzOf(x); return this.ground.type(x, z); },
  /** Put an object on the ground beneath it (y = ground height + offset); returns the object. With multi-layer ground the object's current y is the reference height: things under a bridge stay on the ground, things on it land on the deck */
  snapToGround(obj, offset = 0) { obj.position.y = this.surface(obj.position.x, obj.position.z, obj.position.y) + offset; return obj; },
  /** Water surface height at a point: water bodies (lake, pond, river segment) first, else the global water level; -Infinity if there is no water */
  waterAt(x, z) {
    if (typeof x === 'object') [x, z] = xzOf(x);
    let lv = this.ground.waterLevel;
    const bodies = this.waterBodies;
    for (let i = 0; i < bodies.length; i++) {   // indexed: runs per sample, no iterator
      const b = bodies[i];
      const inside = b.radius != null ? (x - b.x) ** 2 + (z - b.z) ** 2 < b.radius * b.radius
        : Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd;
      if (inside && b.level > lv) lv = b.level;
    }
    return lv;
  },
  /** Add a water body: a circle { position, radius, level } or a rectangle { position, halfWidth, halfDepth, level } (meters). Returns a handle { body, remove() }. The water module draws it */
  addWaterBody(opts) {
    checkOptions('engine.addWaterBody()', opts, WATER_KEYS);
    const [x, z] = xzOf(opts.position);
    const b = opts.radius != null ? { x, z, radius: opts.radius, level: opts.level }
      : { x, z, hw: opts.halfWidth ?? 1, hd: opts.halfDepth ?? 1, level: opts.level };
    this.waterBodies.push(b); this.events.emit('water:add', b);
    const remove = () => {
      if (!this.waterBodies.includes(b)) return;
      this.waterBodies = this.waterBodies.filter(x => x !== b);
      this.events.emit('water:remove', b);
    };
    return { body: b, remove };
  },
};
