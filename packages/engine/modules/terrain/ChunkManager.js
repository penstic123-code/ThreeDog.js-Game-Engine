// Chunk streaming: chunks around the engine.stream sources (player, camera focus, teleport destination...) are generated on engine.threads workers,
// uploaded to the GPU when in view, released when far from all sources.
// LOD is split by ring from the nearest source: the chunk a source stands in plus the one ring around it is ring 1, and so on.
// Visuals and gameplay take effect separately: a finished model is uploaded and shown at once; tree collision (forEachCollider, chunkCollision) only takes effect at the tick set by engine.commits (c.solid),
// and is generated on the main thread on the spot if not done by then -- machine speed never changes whether the player bumps into a tree (see core/Commits.js).
import * as THREE from 'three';
import { createTerrain } from './terrainGen.js';
import { chunkHandler } from './chunkJob.js';
import { TerrainEdits } from './terrainEdit.js';
import { terrainMaterial } from '../../render/materials.js';
import { xzOf } from '../../core/math.js';
import { chunkQueries } from './chunkQueries.js';

const COLLIDER_LAG = 30;   // base delay before chunk collision takes effect (fixed steps, 30 = 0.5 s), multiplied by (1 + ring)
const NO_VEG = { baseNames: () => [], nearNames: () => [], list: () => [], get: () => null };

export class ChunkManager {
  constructor(engine, terrainCfg, material = null) {
    this.engine = engine;
    this.T = createTerrain(terrainCfg);          // main-thread copy: height queries for the character and camera
    this.chunks = new Map();
    this.viewChunks = 4;                        // unit: chunks
    this.density = 1;
    this.applyBudgetMs = 3;                       // max ms per frame spent uploading results to the GPU
    this.maxInFlight = 4;
    this.inFlight = 0;
    this.ready = [];
    this._want = [];                              // chunks not yet dispatched (nearest first)
    this._ver = 0;                                // +1 when the chunk table is cleared / deleted from (update uses it to decide whether to rebuild the pending list)
    this._wantFor = [-1, -1];                     // view distance and _ver the pending list was last built for
    this.gen = 0;
    this.stats = { builtThisFrame: 0, applyMs: 0, queued: 0 };
    this.terrainMat = terrainMaterial(typeof material === 'function' ? material(engine) : material, engine);
    this.centers = [];                            // stream sources in chunk units: { cx, cz, R, simple } (set by update)
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();

    // one lane of chunk workers (engine.threads); with threads: false or no Worker the same handler runs on the main thread, and a crashed worker falls back to it
    this.lane = engine.threads.lane({ create: () => new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' }), local: chunkHandler });
    this.lane.broadcast({ type: 'init', terrain: terrainCfg, species: {} }, 'init');
    /** @internal edit records (saved with the save) */ this.edits = new TerrainEdits(engine, this);
  }

  get CHUNK() { return this.T.CHUNK; }
  /** Grid spacing (meters): edits snap to it, and paint colors whole cells of this size. Set by chunkSize / resolution */
  get cellSize() { return this.T.CELL; }
  /**
   * Change the ground: dig, raise, flatten, or paint the ground type. Call it from an op or a fixed step (it is saved gameplay state).
   * Heights snap to grid points and paint to cells (cellSize); the nearest one is taken when the shape is smaller than a cell.
   * engine.surface / slope / groundType, collision, paths and vegetation (what grew there is removed) follow at once; it is saved,
   * and a chunk unloaded and generated again comes back edited. Paint colors come from biomeColors[type] (gray when the game's style has none).
   * @param {import('three').Vector3 | {x:number,z:number} | number[]} position
   * @param {{ radius?: number, shape?: 'circle' | 'square', raise?: number, lower?: number, flatten?: number, paint?: string | null }} opts
   *   radius meters (default half a cell); one of raise / lower (meters) / flatten (target height); paint a type name, null gives back the generated type
   * @returns {{ heights: number, cells: number }} how many grid points and cells changed
   * @example
   * engine.ops.define('farm.till', { args: { at: 'position' },
   *   run(e, a) { e.terrain.edit(a.at, { shape: 'square', radius: e.terrain.cellSize / 2, paint: 'tilled' }); } });
   * engine.terrain.edit(pos, { radius: 3, lower: 1.5 });              // dig a pit
   * engine.terrain.edit(pos, { shape: 'square', radius: 6, flatten: engine.surface(pos) });   // level a foundation
   */
  edit(position, opts) { return this.edits.edit(position, opts); }

  /** @internal vegetation plumbing */
  registerSpecies(name, rule) {
    this.lane.broadcast({ type: 'species', name, rule }, 'species:' + name);
    this.rebuild();
  }
  /** Replace the terrain config in every worker (height map loaded); species is the full rule table */
  reinit(terrainCfg, species) {
    this.T = createTerrain(terrainCfg);
    this.edits.attach();
    this.lane.broadcast({ type: 'init', terrain: terrainCfg, species }, 'init');
    this.rebuild();
  }

  // dispatch the next task as soon as a result returns: a worker need not wait for the next frame to get work (a frame can be very long while loading)
  _send(job) {
    this.inFlight++;
    this.lane.run(job).then(r => { this.inFlight--; this.ready.push(r); this._pump(); });
  }

  /** View distance (in chunks). Also adjusts fog and the camera far plane */
  setViewChunks(n) { this.viewChunks = n; this.engine.setFogFar((n - 0.3) * this.T.CHUNK); }
  /** Vegetation density multiplier (rebuilds all chunks) */
  setDensity(d) { this.density = d; this.rebuild(); }

  rebuild() {
    for (const c of this.chunks.values()) this._dispose(c);
    this.chunks.clear();
    this.ready = [];
    this._want = [];
    this.gen++; this._ver++;
  }

  /** Ring of a chunk from the nearest stream source; a 'simple' source counts as the outer ring (far look, no near detail) */
  _ring(c) {
    let r = Infinity;
    for (const s of this.centers) r = Math.min(r, Math.max(Math.abs(c.cx - s.cx), Math.abs(c.cz - s.cz), s.simple ? this.viewChunks : 0));
    return r;
  }

  /**
   * Build a queued chunk entry and register the tick when its collision takes effect. Registered when the chunk is first needed (decided by stream source positions),
   * not when actually sent to the worker (which depends on how busy the worker is) -- so the effect time depends on gameplay only.
   * Effect delay: ring 1, which the loading screen waits for, takes effect the moment play starts (lag 0); farther rings get more worker time, so on-the-spot generation is rarely needed
   */
  _queue(cx, cz, key) {
    const c = { cx, cz, key, state: 'queued', group: null, veg: {}, colliders: {}, pendingDetail: false, level: -1, sphere: null, solid: false, gen: this.gen };
    this.chunks.set(key, c);
    const ring = this._ring(c);
    c.ticket = this.engine.commits.request({
      lag: !this.engine.ready && ring <= 1 ? 0 : COLLIDER_LAG * (1 + ring),
      apply: () => { c.solid = true; c.colToken = {}; },   // collision counts from this step on (a new token makes the physics module build this chunk's collision)
      fallback: () => this._forceReady(c),
      valid: () => this.chunks.get(c.key) === c && c.gen === this.gen,
    });
    return c;
  }
  /** Dispatch tasks from the queue until maxInFlight are running; while the loading screen is up send all of them (a main-thread frame is long, waiting for replies would idle the worker) */
  _pump() {
    const species = (this.engine.vegetation || NO_VEG).baseNames(), max = this.engine.ready ? Math.max(this.maxInFlight, 2 * this.lane.size) : Infinity;
    while (this.inFlight < max && this._want.length) {
      const c = this._want.shift();
      if (c.state !== 'queued' || this.chunks.get(c.key) !== c) continue;   // already generated on the spot, or released
      c.state = 'pending';
      this._send(this._job(c, true, species));
    }
  }

  /** sources: engine.stream.sources() (every stream source; a source radius caps the view distance) */
  update(sources, camera) {
    const CH = this.T.CHUNK, V = this.viewChunks;
    // centers are reused objects compared field by field: nothing is allocated on a frame where no source changed chunk
    const C = this.centers;
    let changed = C.length !== sources.length || this._wantFor[0] !== V || this._wantFor[1] !== this._ver;
    C.length = sources.length;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i], cx = Math.floor(s.x / CH), cz = Math.floor(s.z / CH), simple = s.detail === 'simple';
      const R = s.radius == null ? V : Math.min(V, Math.max(1, Math.ceil(s.radius / CH))), c = C[i] ??= { cx: NaN, cz: 0, R: 0, simple: false };
      if (c.cx !== cx || c.cz !== cz || c.R !== R || c.simple !== simple) { c.cx = cx; c.cz = cz; c.R = R; c.simple = simple; changed = true; }
    }

    // 1. queue chunks any source needs; release those far from all.
    //    Skip when source chunks, view distance and chunk table are unchanged (don't rebuild lists and key strings every frame)
    if (changed) {
      this._wantFor[0] = V; this._wantFor[1] = this._ver;
      const d2 = c => { let m = Infinity; for (const s of this.centers) m = Math.min(m, (c.cx - s.cx) ** 2 + (c.cz - s.cz) ** 2); return m; };
      const want = new Map();
      for (const s of this.centers) {
        const R = s.R, lim = R * R + R;
        for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
          const cx = s.cx + dx, cz = s.cz + dz, key = cx + ',' + cz;
          if (dx * dx + dz * dz <= lim && !this.chunks.has(key)) want.set(key, { cx, cz, key });
        }
      }
      // re-sort queued chunks (not released) plus new ones by distance to the nearest source: nearest first
      const fresh = [...want.values()].sort((a, b) => d2(a) - d2(b)).map(w => this._queue(w.cx, w.cz, w.key));
      this._want = this._want.filter(c => c.state === 'queued' && this.chunks.get(c.key) === c).concat(fresh).sort((a, b) => d2(a) - d2(b));
      const kept = c => this.centers.some(s => (c.cx - s.cx) ** 2 + (c.cz - s.cz) ** 2 <= (s.R + 1) * (s.R + 1) + s.R + 1);
      for (const [key, c] of this.chunks) if (!kept(c)) { this._dispose(c); this.chunks.delete(key); }
    }
    this._pump();
    this.stats.queued = this._want.length;

    // 2. upload worker results within the time budget; while the loading screen is up, first-screen chunks (the ring around the player) ignore the budget and all upload in one frame
    const t0 = performance.now(), loading = !this.engine.ready, later = [];   // measure: upload budget
    let built = 0;
    for (const r of this.ready) {
      const c = this.chunks.get(r.cx + ',' + r.cz);
      if (!c || r.gen !== this.gen || this._stale(c, r)) continue;
      if (built > 0 && performance.now() - t0 >= this.applyBudgetMs   // measure
        && !(loading && this._ring(c) <= 1)) { later.push(r); continue; }
      if (r.terrain) { if (c.state === 'ready') continue; this._applyTerrain(c, r.terrain); c.ticket?.resolve(true); }
      else if (c.state !== 'ready') continue;
      for (const name in r.veg) this._applyVeg(c, name, r.veg[name]);
      if (!r.terrain) c.pendingDetail = false;
      c.level = -1; built++;
    }
    this.ready = later;
    this.stats.builtThisFrame = built;
    this.stats.applyMs += ((performance.now() - t0) - this.stats.applyMs) * 0.1;   // measure

    // 3. LOD + frustum culling
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    let visible = 0, instances = 0;
    for (const c of this.chunks.values()) {
      if (c.state !== 'ready') continue;
      const ring = this._ring(c);
      this._setLevel(c, ring);
      const v = ring <= 1 || this._frustum.intersectsSphere(c.sphere);
      c.group.visible = v;
      if (v) { visible++; for (const n in c.veg) if (c.veg[n].visible) instances += c.veg[n].count; }
    }
    this.stats.visible = visible; this.stats.loaded = this.chunks.size; this.stats.instances = instances;
    return built;
  }

  /** Due but chunk not ready: if the worker result already arrived, upload it now, else generate on the main thread (same code as the worker, same result) */
  _forceReady(c) {
    if (c.state === 'ready') return true;
    const i = this.ready.findIndex(r => r.terrain && r.cx === c.cx && r.cz === c.cz && r.gen === c.gen && r.ev === this.edits.version(c.key));
    let r = i >= 0 ? this.ready.splice(i, 1)[0] : null;
    if (!r) {
      const veg = this.engine.vegetation || NO_VEG;
      r = { terrain: this.T.buildChunk(c.cx, c.cz), veg: {} };
      for (const name of veg.baseNames()) r.veg[name] = this.T.place(c.cx, c.cz, veg.get(name).rule, this.density);
    }
    this._applyTerrain(c, r.terrain);
    for (const name in r.veg) this._applyVeg(c, name, r.veg[name]);
    c.level = -1;
    return true;
  }

  _job(c, terrain, species) {
    const ev = this.edits.version(c.key), edits = this.edits.forChunk(c.cx, c.cz);
    return { type: 'job', cx: c.cx, cz: c.cz, terrain, species, density: this.density, gen: this.gen, ev, edits };
  }
  // result built before a later edit near this chunk: drop it and ask again (a loaded chunk was already rebuilt by the edit)
  _stale(c, r) {
    if (r.ev === this.edits.version(c.key)) return false;
    if (r.terrain && c.state === 'pending') { c.state = 'queued'; this._want.unshift(c); }
    else if (!r.terrain) { c.pendingDetail = false; c.level = -1; }
    return true;
  }

  _applyTerrain(c, t) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(t.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(t.col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(t.uv, 2));
    const mesh = new THREE.Mesh(g, this.terrainMat);
    mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    c.group = new THREE.Group();
    c.group.userData.budgetTag = 'terrain';
    c.group.position.set(c.cx * this.T.CHUNK, 0, c.cz * this.T.CHUNK);
    c.group.add(mesh); c.terrain = mesh;
    c.group.updateMatrixWorld(true);
    c.sphere = new THREE.Sphere(new THREE.Vector3(t.sphere[0], t.sphere[1], t.sphere[2]), t.sphere[3]);
    c.state = 'ready';
    this.engine.scene.add(c.group);
  }

  _applyVeg(c, name, r) {
    if (r.k && r.k.length) c.colliders[name] = r.k; else delete c.colliders[name];
    (c.collidersAll ||= {})[name] = c.colliders[name];   // original collision circles (before felled trees are filtered), for vegetation single-tree removal
    if (r.n === 0) return;
    const sp = this.engine.vegetation.get(name);
    const im = new THREE.InstancedMesh(sp.geometry, sp.material, r.n);
    im.instanceMatrix.array.set(r.m); im.instanceMatrix.needsUpdate = true;
    im.instanceColor = new THREE.InstancedBufferAttribute(r.c, 3);
    im.frustumCulled = false; im.matrixAutoUpdate = false;
    im.receiveShadow = sp.receiveShadow;
    im.userData.ids = r.ids;   // stable id per instance (used by felled-tree records)
    im.userData.budgetTag = 'vegetation';
    c.group.add(im); im.updateMatrixWorld(true);
    if (c.veg[name]) { c.group.remove(c.veg[name]); c.veg[name].dispose(); }
    c.veg[name] = im;
    this.engine.vegetation?.applyEdits?.(c, name);   // apply world edits: felled trees stay gone after reload
  }

  _setLevel(c, ring) {
    if (c.level === ring) return;
    c.level = ring;
    const veg = this.engine.vegetation || NO_VEG, shadowsOn = this.engine.shadows;
    for (const sp of veg.list()) {
      const im = c.veg[sp.name];
      if (sp.nearOnly) {
        if (ring <= sp.maxRing && !im && !c.pendingDetail) {
          c.pendingDetail = true;
          this._send(this._job(c, false, veg.nearNames()));
        } else if (ring > sp.maxRing + 1 && im) { c.group.remove(im); im.dispose(); delete c.veg[sp.name]; delete c.colliders[sp.name]; if (c.collidersAll) delete c.collidersAll[sp.name]; }
        continue;
      }
      if (!im) continue;
      im.visible = ring <= sp.maxRing;
      im.geometry = sp.lodGeometry && ring > sp.lodRing ? sp.lodGeometry : sp.geometry;
      im.castShadow = shadowsOn && sp.castShadow && ring <= sp.shadowRing;
    }
  }

  /** Stop the chunk workers (called by terrain dispose; in-flight results are discarded) */
  dispose() { this.lane.dispose(); this.ready.length = 0; }
  /** Whether chunks within `rings` rings (default 1) of a position are generated (for the loading screen); solid: also their collision has taken effect */
  isReadyAround(position, { rings = 1, solid = false } = {}) {
    const [x, z] = xzOf(position), CH = this.T.CHUNK, pcx = Math.floor(x / CH), pcz = Math.floor(z / CH);
    for (let dz = -rings; dz <= rings; dz++) for (let dx = -rings; dx <= rings; dx++) {
      const c = this.chunks.get((pcx + dx) + ',' + (pcz + dz));
      if (!c || c.state !== 'ready' || solid && !c.solid) return false;
    }
    return true;
  }

  /** @internal vegetation / settings plumbing */
  refreshLevels() { for (const c of this.chunks.values()) c.level = -1; }

  _dispose(c) {
    if (c.state !== 'ready') return;
    this.engine.scene.remove(c.group);
    c.terrain.geometry.dispose();
    for (const n in c.veg) c.veg[n].dispose();
  }
}
Object.assign(ChunkManager.prototype, chunkQueries);
