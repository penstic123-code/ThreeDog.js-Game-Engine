// Chunk streaming: chunks around the engine.stream sources (player, camera focus, teleport destination...) are generated on engine.threads workers,
// uploaded to the GPU when in view, released when far from all sources.
// LOD is split by ring from the nearest source: the chunk a source stands in plus the one ring around it is ring 1, and so on.
// Visuals and gameplay take effect separately: a finished model is uploaded and shown at once; tree collision (forEachCollider, chunkCollision) only takes
// effect at the tick set by engine.commits (c.solid),
// and is generated on the main thread on the spot if not done by then -- machine speed never changes whether the player bumps into a tree (see
// core/Commits.js).
import * as THREE from 'three';
import { createTerrain } from './terrainGen.js';
import { chunkHandler } from './chunkJob.js';
import { TerrainEdits } from './terrainEdit.js';
import { terrainMaterial } from '../../render/materials.js';
import { chunkRing } from '../../core/streamSources.js';
import { chunkQueries } from './chunkQueries.js';
import { chunkLevels, NO_VEG } from './chunkLevels.js';
import { mountTerrain } from './mountTerrain.js';
import { disposeColorMap } from './terrainTexture.js';

const COLLIDER_LAG = 30;   // base delay before chunk collision takes effect (fixed steps, 30 = 0.5 s), multiplied by (1 + ring)

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
    // +1 when the chunk table is cleared / deleted from (update uses it to decide whether to rebuild the pending list)
    this._ver = 0;
    this._wantFor = [-1, -1];                     // view distance and _ver the pending list was last built for
    this.gen = 0;
    this.stats = { builtThisFrame: 0, applyMs: 0, queued: 0 };
    this.terrainMat = terrainMaterial(typeof material === 'function' ? material(engine) : material, engine);
    this.centers = [];                            // stream sources in chunk units: { cx, cz, R, simple } (set by update)
    this.sideMat = null;                          // shape.side.material: island sides and bottoms
    this.lowest = 0;                              // lowest island point loaded (default voidY)
    this._frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();

    // one lane of chunk workers (engine.threads); with threads: false or no Worker the same handler runs on the main thread, and a crashed worker falls back to
    // it
    this.lane = engine.threads.lane({ create: () => new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' }), local: chunkHandler });
    this.lane.broadcast({ type: 'init', terrain: terrainCfg, species: {} }, 'init');
    /** @internal edit records (saved with the save) */ this.edits = new TerrainEdits(engine, this);
  }

  get CHUNK() { return this.T.CHUNK; }
  /**
   * Below it the player or a moving body fell out of the world (terrain:void): shape.voidY, else 50 m under the lowest island
   * chunk loaded (at most -50); -Infinity without a shape
   * @example engine.events.on('terrain:void', ({ who }) => { if (who === engine.player) engine.player.placeAt(home); });
   */
  get voidY() { return this.T.shape ? this.T.shape.voidY ?? Math.min(0, this.lowest) - 50 : -Infinity; }
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
   * @returns {{ heights: number, cells: number }} how many grid points and cells changed (0 and 0 off a shape outline)
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
    const t0 = performance.now();   // measure
    this.lane.run(job).then(r => { this.inFlight--; this.engine.budget.cost.transit(t0, r); this.ready.push(r); this._pump(); });
  }

  /**
   * View distance (in chunks). Also moves the camera far plane out to it; the fog distance follows only with terrain({ viewFog: true }) (the game's fog is its
   * own)
   */
  setViewChunks(n) {
    this.viewChunks = n;
    const d = (n - 0.3) * this.T.CHUNK, e = this.engine;
    if (this.viewFog) e.setFogFar(d);
    else if (e.camera.far < d + 150) { e.camera.far = d + 150; e.camera.updateProjectionMatrix(); }   // chunks in view must not be clipped
  }
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
  _ring(c) { return chunkRing(c.cx, c.cz, this.centers, this.viewChunks); }

  /**
   * Build a queued chunk entry and register the tick when its collision takes effect. Registered when the chunk is first needed (decided by stream source
   * positions),
   * not when actually sent to the worker (which depends on how busy the worker is) -- so the effect time depends on gameplay only.
   * Effect delay: ring 1, which the loading screen waits for, takes effect the moment play starts (lag 0); farther rings get more worker time, so on-the-spot
   * generation is rarely needed
   */
  _queue(cx, cz, key) {
    const c = { cx, cz, key, state: 'queued', group: null, veg: {}, colliders: {}, pendingDetail: false, detailDone: new Set(), level: -1, sphere: null, solid: false, gen: this.gen };
    this.chunks.set(key, c);
    const ring = this._ring(c);
    c.ticket = this.engine.commits.request({
      lag: !this.engine.ready && ring <= 1 ? 0 : COLLIDER_LAG * (1 + ring),
      // collision counts from this step on (a new token makes the physics module build this chunk's collision)
      apply: () => { c.solid = true; c.colToken = {}; },
      fallback: () => this._forceReady(c),
      valid: () => this.chunks.get(c.key) === c && c.gen === this.gen,
    });
    return c;
  }
  /**
   * Dispatch tasks from the queue until maxInFlight are running; while the loading screen is up send all of them (a main-thread frame is long, waiting for
   * replies would idle the worker)
   */
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

    // 2. upload worker results within the time budget; while the loading screen is up, first-screen chunks (the ring around the player) ignore the budget and
    // all upload in one frame
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
      if (!r.terrain) { c.pendingDetail = false; for (const name in r.veg) c.detailDone.add(name); }
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

  _applyTerrain(c, t) { mountTerrain(this, c, t); }

  // the InstancedMesh of one species in a chunk is built by vegetation (the same code builds its chunks on any other ground)
  _applyVeg(c, name, r) { this.engine.vegetation.mount(c, name, r); }


  /** Stop the chunk workers (called by terrain dispose; in-flight results are discarded) */
  dispose() { this.lane.dispose(); this.ready.length = 0; }
  /** @internal vegetation / settings plumbing */
  refreshLevels() { for (const c of this.chunks.values()) c.level = -1; }

  _dispose(c) {
    if (c.state !== 'ready') return;
    this.engine.scene.remove(c.group);
    c.terrain.geometry.dispose();
    disposeColorMap(c);
    for (const n in c.veg) c.veg[n].dispose();
  }
}
Object.assign(ChunkManager.prototype, chunkQueries, chunkLevels);
