// Lightweight collision: characters are upright cylinders, trees/rocks are circles, houses etc. are rotated rectangles.
// Only keeps walkers from clipping and the camera from being blocked; much faster than a full physics engine, tens of thousands of trees are fine on big maps.
// For falling, pushing crates and other real physics, add Rapier separately; it does not affect this.
// Once installed: engine.collision (real physics is another module, rigid() → engine.rigid).
// Positions are always a single argument (Vector3 / Object3D / [x, y, z] / { x, z }); sizes go in the options object:
//   const h = engine.collision.addBox(house, { halfWidth: 3, halfDepth: 2, rotation: 0.3 });   h.remove();
import { xzOf } from '../../core/math.js';
import { checkOptions, checkOptionsArg } from '../../core/validate.js';
import { CollisionGrid, gridBlocks } from './grid.js';

/** One axis of the slab test: narrows S.t0 / S.t1 to where the ray is inside |o + d t| <= h; false when it misses */
function slab(S, o, d, h) {
  if (Math.abs(d) < 1e-6) return Math.abs(o) <= h;
  let ta = (-h - o) / d, tb = (h - o) / d; if (ta > tb) { const t = ta; ta = tb; tb = t; }
  S.t0 = Math.max(S.t0, ta); S.t1 = Math.min(S.t1, tb);
  return S.t0 <= S.t1;
}

const BOX_KEYS = ['halfWidth', 'halfDepth', 'rotation', 'height', 'y'], CIRCLE_KEYS = ['radius', 'height'];

export class Collision {
  /**
   * maxClimb: max walkable slope (height diff / horizontal distance; default slopeRatio derived from engine.movement.maxSlope); canopyHeight: a camera above this height is not blocked by trees
   * cameraPad: camera margin from obstacles; cameraMin: closest camera distance; walkableWaterMargin: how far above the water surface counts as walkable
   * cameraOcclusion: what camera occlusion tests: 'colliders' circles and boxes (default) | 'meshes' meshes registered as camera blockers (level buildings, col_ meshes, via engine.rays) | 'both'
   */
  constructor(engine, { maxClimb = engine.movement.slopeRatio, canopyHeight = 5, cameraPad = 0.5, cameraMin = 1.5, walkableWaterMargin = 0.2, cameraOcclusion = 'colliders' } = {}) {
    this.engine = engine;
    Object.assign(this, { maxClimb, canopyHeight, cameraPad, cameraMin, walkableWaterMargin, cameraOcclusion });
    this.circles = [];   // manually added circle colliders {x, z, r, h}
    this.boxes = [];     // rectangles {x, z, hw, hd, rot, h}
    this._grid = new CollisionGrid();   // grid index: resolve / camera look only nearby instead of scanning all (circles / boxes change only via addCircle / addBox)
    this.version = 0;   // +1 on every static collider add/remove; the physics module syncs on it
    this._onGroundCircle = (cx, cz, r) => this._pushCircle(this._rPos, cx, cz, r, this._rRad);   // built once: ground.forEachCollider callback
    this._camS = { from: null, to: null, ux: 0, uz: 0, len: 0, pad: 0, want: 0, best: 0, t0: 0, t1: 0 };   // cameraDistance scratch for its callbacks
    this._onCamCircle = (a, b, c) => this._camCircle(a, b, c);
  }
  /** Iterate all manually added static colliders (for the physics module): fn('box' | 'circle', data) */
  forEachStatic(fn) { for (const b of this.boxes) fn('box', b); for (const c of this.circles) fn('circle', c); }

  /** Add a circle collider (pillar, statue, campfire): position is the centre, radius (default 0.5), height (default 6). Returns a handle { remove() } */
  addCircle(position, opts = {}) {
    checkOptionsArg('collision.addCircle()', opts, CIRCLE_KEYS); if (typeof opts !== 'object') opts = {};
    const [x, z] = xzOf(position), c = { x, z, r: opts.radius ?? 0.5, h: opts.height ?? 6 };
    this.circles.push(c); this._grid.add(c, false); this.version++;
    return { remove: () => { if (!this.circles.includes(c)) return; this.circles = this.circles.filter(o => o !== c); this._grid.remove(c); this.version++; } };
  }
  /**
   * Add a rectangle collider (house, fence): position is the centre; halfWidth / halfDepth (default 1), rotation about the Y axis (radians),
   * height (default 6), y is the box bottom height (omit to sit on the ground; set it for walls on platforms in levels). Returns a handle { remove() }
   */
  addBox(position, opts = {}) {
    checkOptionsArg('collision.addBox()', opts, BOX_KEYS); if (typeof opts !== 'object') opts = {};
    const [x, z] = xzOf(position), hw = opts.halfWidth ?? 1, hd = opts.halfDepth ?? 1, rot = opts.rotation ?? 0;
    const b = { x, z, hw, hd, rot, h: opts.height ?? 6, y: opts.y, c: Math.cos(rot), s: Math.sin(rot), r: Math.hypot(hw, hd) };
    this.boxes.push(b); this._grid.add(b, true); this.version++;
    return { remove: () => { if (!this.boxes.includes(b)) return; this.boxes = this.boxes.filter(o => o !== b); this._grid.remove(b); this.version++; } };
  }
  /** Add collision from a three.js object's bounding box (common for house models), pad grows it outward (m). Returns a handle { remove() } */
  addObject(obj, { pad = 0 } = {}) {
    obj.updateMatrixWorld(true);
    const THREE = this.engine.THREE, box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    return this.addBox(c, { halfWidth: s.x / 2 + pad, halfDepth: s.z / 2 + pad, height: s.y });
  }

  // The per-frame walkers below pass state through fields instead of building callbacks: resolve() and cameraDistance() run every step / frame.
  // resolve saves and restores its fields, so a nested call (from a ground collider callback) stays safe.
  _pushCircle(pos, a, b, c, radius) {
    const dx = pos.x - a, dz = pos.z - b, d = Math.hypot(dx, dz), min = radius + c;
    if (d < min && d > 1e-5) { pos.x = a + dx / d * min; pos.z = b + dz / d * min; this._rHit = true; }
  }
  _pushBox(pos, bx, radius) {
    const lx0 = pos.x - bx.x, lz0 = pos.z - bx.z;
    const lx = lx0 * bx.c - lz0 * bx.s, lz = lx0 * bx.s + lz0 * bx.c;   // to box-local coordinates
    const qx = Math.max(-bx.hw, Math.min(bx.hw, lx)), qz = Math.max(-bx.hd, Math.min(bx.hd, lz));
    const dx = lx - qx, dz = lz - qz, d = Math.hypot(dx, dz);
    if (d >= radius) return;
    let nx, nz;
    if (d > 1e-5) { nx = dx / d; nz = dz / d; nx = lx + nx * (radius - d); nz = lz + nz * (radius - d); }
    else { // centre is inside the box: push out along the nearest edge
      const px = bx.hw - Math.abs(lx), pz = bx.hd - Math.abs(lz);
      if (px < pz) { nx = Math.sign(lx) * (bx.hw + radius); nz = lz; } else { nx = lx; nz = Math.sign(lz) * (bx.hd + radius); }
    }
    pos.x = bx.x + nx * bx.c + nz * bx.s; pos.z = bx.z - nx * bx.s + nz * bx.c; this._rHit = true;
  }

  /** @internal Push a character of radius `radius` out of obstacles; edits pos.x / pos.z directly. Returns whether a collision happened */
  resolve(pos, radius = this.engine.movement.radius) {
    const sPos = this._rPos, sRad = this._rRad;
    this._rPos = pos; this._rRad = radius; this._rHit = false;
    const g = this.engine.ground;
    for (let iter = 0; iter < 2; iter++) {
      g.forEachCollider?.(pos.x, pos.z, radius + 2, this._onGroundCircle);
      const list = this._grid.query(pos.x, pos.z, radius + 2);
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (it._b) this._pushBox(pos, it, radius); else this._pushCircle(pos, it.x, it.z, it.r, radius);
      }
    }
    const hit = this._rHit;
    this._rPos = sPos; this._rRad = sRad;
    return hit;
  }

  /** Can anyone stand here (for pathfinding): not in water, not too steep, not inside an obstacle. radius is the character radius (m, default engine.movement.radius) */
  walkable(position, { radius = this.engine.movement.radius } = {}) { const [x, z] = xzOf(position); return this.walkableAt(x, z, radius); }
  /** @internal The collider grid (boxes and circles added through this module), read by async pathfinding on the main thread */
  get grid() { return this._grid; }
  /** Same as walkable but takes plain numbers (inner loop of A* pathfinding and spawn search, allocates nothing; like engine.surface(x, z)). radius defaults to engine.movement.radius */
  walkableAt(x, z, radius = this.engine.movement.radius) { return this.groundWalkable(x, z) && !this._groundBlocks(x, z, radius) && !gridBlocks(this._grid, x, z, radius); }
  /** @internal Ground shape half of walkableAt (water, slope): a smooth field, so async pathfinding samples it on a raster; colliders are tested exactly there */
  groundWalkable(x, z) {
    const e = this.engine;
    return !(e.surface(x, z) < e.waterAt(x, z) + this.walkableWaterMargin || e.slope(x, z) > this.maxClimb * 0.8);
  }
  /** Does one of the ground's own colliders (terrain trees) block this spot */
  _groundBlocks(x, z, radius) {
    let blocked = false;
    this.engine.ground.forEachCollider?.(x, z, radius + 1, (cx, cz, r) => { if (!blocked && Math.hypot(x - cx, z - cz) < radius + r) blocked = true; });
    return blocked;
  }

  /** A camera above the canopy is not blocked by trees: is the line of sight at distance tc above it over (x, z) */
  _yAbove(x, z, tc) { const S = this._camS; return S.from.y + (S.to.y - S.from.y) * (tc / S.len) - this.engine.surface(x, z) > this.canopyHeight; }
  _camCircle(a, b, c) {
    const S = this._camS, from = S.from, tc = (a - from.x) * S.ux + (b - from.z) * S.uz;
    if (tc <= 0.3 || tc >= S.len) return;
    const px = from.x + S.ux * tc - a, pz = from.z + S.uz * tc - b, rr = c + S.pad;
    if (px * px + pz * pz > rr * rr) return;
    const t = tc - Math.sqrt(rr * rr - (px * px + pz * pz));   // distance at which the line of sight (character to camera) hits the obstacle
    if (this._yAbove(a, b, tc)) return;
    S.best = Math.min(S.best, S.want * t / S.len);
  }
  /** Rectangle: rotate the line of sight into box-local coordinates and compute where it enters the box (slab intersection) */
  _camBox(bx) {
    const S = this._camS, from = S.from, ox = from.x - bx.x, oz = from.z - bx.z, len = S.len;
    const lx = ox * bx.c - oz * bx.s, lz = ox * bx.s + oz * bx.c, dx = S.ux * bx.c - S.uz * bx.s, dz = S.ux * bx.s + S.uz * bx.c;
    S.t0 = 0; S.t1 = len;
    if (!slab(S, lx, dx, bx.hw + S.pad) || !slab(S, lz, dz, bx.hd + S.pad)) return;
    if (S.t0 <= 0.3) return;
    const yAt = from.y + (S.to.y - from.y) * (S.t0 / len);
    if (yAt > (bx.y ?? this.engine.surface(bx.x, bx.z)) + bx.h) return;   // camera above the wall top
    S.best = Math.min(S.best, S.want * S.t0 / len);
  }

  /** @internal Camera occlusion: if the line from the character's head to the camera passes through a trunk or house, pull the camera closer. Returns the max allowed distance */
  cameraDistance(from, to, want, pad = this.cameraPad) {
    const mode = this.cameraOcclusion;
    let best = want;
    if (mode !== 'colliders') {   // meshes: cast a ray from the head toward the camera, pull closer if it hits a camera-blocking mesh
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len3 = Math.hypot(dx, dy, dz);
      const hit = len3 > 1e-3 && this.engine.raycast(from, { x: dx, y: dy, z: dz }, { far: len3, occluders: true });
      if (hit) best = Math.min(best, want * Math.max(0, hit.distance - pad) / len3);
      if (mode === 'meshes') return Math.max(this.cameraMin, best);
    }
    const sx = to.x - from.x, sz = to.z - from.z, len = Math.hypot(sx, sz);
    if (len < 1e-3) return mode === 'colliders' ? want : Math.max(this.cameraMin, best);
    const S = this._camS;
    S.from = from; S.to = to; S.ux = sx / len; S.uz = sz / len; S.len = len; S.pad = pad; S.want = want; S.best = best;
    this.engine.ground.forEachCollider?.(from.x + sx / 2, from.z + sz / 2, len / 2 + 1, this._onCamCircle);
    const list = this._grid.query(from.x + sx / 2, from.z + sz / 2, len / 2 + 1);
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (it._b) this._camBox(it); else this._camCircle(it.x, it.z, it.r);
    }
    best = S.best;
    S.from = S.to = null;   // do not keep the caller's vectors alive
    return Math.max(this.cameraMin, best);
  }
}

/** Collision module: lightweight character walking collision, covers the whole map. Once installed: engine.collision */
export function collision(opts = {}) {
  return { name: 'collision', label: 'Collision', install(e) { checkOptions('collision()', opts, ['maxClimb', 'canopyHeight', 'cameraPad', 'cameraMin', 'walkableWaterMargin', 'cameraOcclusion']); return new Collision(e, opts); } };
}
