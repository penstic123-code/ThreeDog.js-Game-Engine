// Ground API (part of Engine, mixed into Engine.prototype): whoever provides ground height is the "terrain" -- a procedural terrain module, a hand-made level, or a flat plane.
// The queries below take (x, z), or a Vector3 / Object3D directly: engine.surface(mesh.position)
import { xzOf } from '../base/math.js';
import { warnOnce, fmt, DEV } from '../base/validate.js';
import { readParams, keysSchema } from '../base/params.js';
import { coded, codedError } from '../base/errorHints.js';

// Default ground: an infinite flat plane at y = 0. A terrain or level module replaces it
export const flatGround = {
  height: () => 0, slope: () => 0, type: () => 'default', waterLevel: -Infinity,
  // is there ground at (x, z): false only off the outline of terrain({ shape }), where height is -Infinity
  has: () => true,
  // height below which something has fallen out of the world (terrain:void); only an outline sets a finite one
  voidY: () => -Infinity,
};
const OVER_HOLDER = "engine.setGround: module {holder} holds the ground and this call covers it until the next provider. A module gives the ground with provides: ['ground'] and ctx.ground.provide";
const NO_GROUND = '{who}: there is no ground at ({x}, {z}) (outside terrain({ shape })){left}; check engine.ground.has(x, z) first';
const noGround = (who, x, z, left = '') => fmt(NO_GROUND, { who, x: x.toFixed(1), z: z.toFixed(1), left });

/**
 * Ground height for a place-it-here entry (spawn, props, pickups, npcs, placeAt). Beyond terrain({ shape }) surface() is -Infinity, and that must never
 * reach a position (a save turns it into null / NaN and the object vanishes): a warning with the fix (once per caller), and `fallback` is used. @internal
 */
export function placeY(e, who, x, z, refY, fallback = 0) {
  const y = e.surface(x, z, refY);
  if (y !== -Infinity) return y;
  warnOnce(coded('ground-missing', noGround(who, x, z)), `ground-missing:${who}`);   // a warning: the fallback is safe, and a prop at the island's edge is legal game code
  return fallback;
}
/** Ground height for a visual-only reader (hud anchor, grid tiles, camera start, shot path): off the island use `fallback`, never throw. @internal */
export function surfaceOr(e, x, z, refY, fallback = 0) {
  const y = e.surface(x, z, refY);
  return y === -Infinity ? fallback : y;
}
/** Below this height something has left the world, on any ground: the rule 'fall' is asked about a body here, and a dev build tells of a player here */
export const FALL_Y = -200;
const WATER_KEYS = ['position', 'radius', 'halfWidth', 'halfDepth', 'level', 'query', 'bounds', 'mesh', 'volume'];

// engine.ground.forEachCollider = the provider's own followed by every added source; absent when there is none
function joinColliders(e) {
  const own = e._groundOwn ?? null, extra = e._groundExtra ?? [];
  const all = own ? [own, ...extra] : extra.slice();
  const g = { ...e.ground };
  if (all.length) g.forEachCollider = (x, z, range, fn) => { for (let i = 0; i < all.length; i++) all[i](x, z, range, fn); };
  else delete g.forEachCollider;
  e.ground = g;
}

function writeGround(e, g) { e._groundOwn = g.forEachCollider ?? null; e.ground = { ...flatGround, ...g }; joinColliders(e); }

export const groundMethods = {
  // the game's own door: it wins over a module's ground until the next provider. A module writes through ctx.ground.provide, which holds the 'ground' slot
  setGround(g) {
    const holder = this.stacks?.has('ground') ? this.stacks.get('ground').value() : null;
    if (DEV && holder && this._curModule?.name !== holder) warnOnce(coded('shared-taken', fmt(OVER_HOLDER, { holder })));
    this._groundBy = null;
    writeGround(this, g);
  },
  /** @internal ctx.ground.provide: the handle hands back the flat ground, unless the game wrote its own since */
  _provideGround(g) {
    const by = this._groundBy = {};
    writeGround(this, g);
    return { remove: () => { if (this._groundBy === by) { this._groundBy = null; writeGround(this, {}); } } };
  },
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
  /** Slope; refY picks the layer on multi-layer ground, as in surface() */
  slope(x, z, refY) { if (typeof x === 'object') { refY = z; [x, z] = xzOf(x); } return this.ground.slope(x, z, refY); },
  /** Ground type (grass, sand...), used by footsteps and particles; refY picks the layer as in surface() */
  groundType(x, z, refY) { if (typeof x === 'object') { refY = z; [x, z] = xzOf(x); } return this.ground.type(x, z, refY); },
  /** Put an object on the ground beneath it (y = ground height + offset); returns the object. With multi-layer ground the object's current y is the reference height: things under a bridge stay on the ground, things on it land on the deck */
  snapToGround(obj, offset = 0) {
    const p = obj.position, y = this.surface(p.x, p.z, p.y);
    if (y === -Infinity) {   // never write an infinite y: the object would vanish and poison bounds and physics
      warnOnce(coded('ground-missing', noGround('engine.snapToGround()', p.x, p.z, ', so the object was left where it is')), 'ground-missing:snapToGround');
      return obj;
    }
    p.y = y + offset; return obj;
  },
  /** Water surface height at a point: the highest of the global water level and the water bodies (lake, pond, river segment) there; -Infinity if there is no water. refY (a height at the point) matters only to bodies with their own query (a second floor's pool) */
  waterAt(x, z, refY) {
    if (typeof x === 'object') { refY = z; [x, z] = xzOf(x); }
    let lv = this.ground.water ? this.ground.water(x, z, refY) : this.ground.waterLevel;
    const bodies = this.waterBodies;
    for (let i = 0; i < bodies.length; i++) {   // indexed: runs per sample, no iterator
      const b = bodies[i];
      let v;
      if (b.query) {   // the game's own water: a query, bounds only skip the call
        const bb = b.bounds;
        if (bb && (x < bb.min.x || x > bb.max.x || z < bb.min.z || z > bb.max.z || (refY != null && (refY < bb.min.y || refY > bb.max.y)))) continue;
        v = b.query(x, z, refY); if (v == null) continue;
      } else {
        const inside = b.radius != null ? (x - b.x) ** 2 + (z - b.z) ** 2 < b.radius * b.radius
          : Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd;
        if (!inside) continue;
        v = b.level;
      }
      if (v > lv) lv = v;
    }
    return lv;
  },
  /** Add a water body: a circle { position, radius, level } or a rectangle { position, halfWidth, halfDepth, level } (meters); the water module draws it.
   *  Your own water (a river, a pool on a floor): { query(x, z, y) -> level | null, bounds?: Box3-like { min, max }, mesh? } or { volume: { contains({x,y,z}), bounds }, level }; the engine draws nothing for these, you add the mesh. Returns { body, remove() } */
  addWaterBody(opts) {
    readParams('engine.addWaterBody()', keysSchema(WATER_KEYS), opts);
    let b;
    if (opts.query || opts.volume) {
      const v = opts.volume, level = opts.level;
      if (!opts.query && !(v && typeof v.contains === 'function' && Number.isFinite(level))) throw codedError('module-params', 'engine.addWaterBody(): { volume } needs volume.contains(point) and a numeric level');
      if (opts.query && typeof opts.query !== 'function') throw codedError('module-params', 'engine.addWaterBody({ query }): query must be (x, z, y) => level | null');
      b = { query: opts.query ?? ((x, z, y) => v.contains({ x, y: y ?? level, z }) ? level : null), bounds: opts.bounds ?? v?.bounds ?? null, mesh: opts.mesh ?? null, level: level ?? null };
    } else {
    const [x, z] = xzOf(opts.position);
    b = opts.radius != null ? { x, z, radius: opts.radius, level: opts.level }
      : { x, z, hw: opts.halfWidth ?? 1, hd: opts.halfDepth ?? 1, level: opts.level };
    }
    this.waterBodies.push(b); this.events.emit('water:add', b);
    const remove = () => {
      if (!this.waterBodies.includes(b)) return;
      this.waterBodies = this.waterBodies.filter(x => x !== b);
      this.events.emit('water:remove', b);
    };
    return { body: b, remove };
  },
};
