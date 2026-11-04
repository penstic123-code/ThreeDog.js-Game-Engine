// Chunk streaming shared by every chunk table (terrain chunks, vegetation on its own ground): which chunks the engine.stream sources need, which
// are far from all of them, the ring of a chunk and frustum culling. The tables keep only what differs: how a chunk is made (a worker job or
// main-thread placement), what it holds and who is told.
//
// Why one helper: the two tables were near copies, and the copy had drifted (it rebuilt its source list and a key string every frame). Ring,
// keep distance and queue order must mean the same in both, or trees load a ring later than the ground under them.
//
// A table gives: chunks (Map key -> chunk { cx, cz, key, state, sphere, inView }), _want (queued chunks, nearest first), _queue(cx, cz, key)
// (make + register a queued chunk), _dispose(c) (release a chunk's content). Hooks passed here: show(c, visible), level(c, ring) (near-only
// detail per ring), count(c, ring) (instances drawn, for stats).
import * as THREE from 'three';

export class ChunkStream {
  /** @param {any} table @param {{ show: Function, level: Function, count: Function, inArea?: Function }} hooks */
  constructor(table, hooks) {
    this.table = table; this.hooks = hooks;
    /** stream sources in chunk units: { cx, cz, R, simple }, reused objects (set by follow) */ this.centers = [];
    this._for = [NaN, NaN];   // view distance and table version the wanted list was last built for
    this.ver = 0;             // +1 whenever the table is cleared: the next follow() plans again
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4();
    this._d2 = c => { let m = Infinity; for (const s of this.centers) m = Math.min(m, (c.cx - s.cx) ** 2 + (c.cz - s.cz) ** 2); return m; };
    this._byDist = (a, b) => this._d2(a) - this._d2(b);
  }

  /** Ring of a chunk from the nearest source; a 'simple' source counts as the outer ring (far picture, no near detail) */
  ring(c) {
    let r = Infinity;
    for (const s of this.centers) r = Math.min(r, Math.max(Math.abs(c.cx - s.cx), Math.abs(c.cz - s.cz), s.simple ? this.table.viewChunks : 0));
    return r;
  }

  /**
   * Follow the sources: centers are reused and compared field by field, so a quiet frame allocates nothing. When a source changed chunk (or
   * the view distance / table changed) queue the chunks any source needs and release those far from all. Returns whether it planned.
   */
  follow(sources, chunkSize, viewChunks) {
    const C = this.centers, V = viewChunks, T = this.table;
    let changed = C.length !== sources.length || this._for[0] !== V || this._for[1] !== this.ver;
    C.length = sources.length;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i], cx = Math.floor(s.x / chunkSize), cz = Math.floor(s.z / chunkSize), simple = s.detail === 'simple';
      const R = s.radius == null ? V : Math.min(V, Math.max(1, Math.ceil(s.radius / chunkSize))), c = C[i] ??= { cx: NaN, cz: 0, R: 0, simple: false };
      if (c.cx !== cx || c.cz !== cz || c.R !== R || c.simple !== simple) { c.cx = cx; c.cz = cz; c.R = R; c.simple = simple; changed = true; }
    }
    if (!changed) return false;
    this._for[0] = V; this._for[1] = this.ver;
    const fresh = [], inArea = this.hooks.inArea;
    for (const s of C) {
      const R = s.R, lim = R * R + R;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const cx = s.cx + dx, cz = s.cz + dz, key = cx + ',' + cz;
        if (dx * dx + dz * dz <= lim && !T.chunks.has(key) && (!inArea || inArea(cx, cz))) fresh.push(T._queue(cx, cz, key));
      }
    }
    // keep one ring past the load radius so a source pacing on a chunk border does not load / release the same chunks every step
    const kept = c => C.some(s => (c.cx - s.cx) ** 2 + (c.cz - s.cz) ** 2 <= (s.R + 1) * (s.R + 1) + s.R + 1);
    for (const [key, c] of T.chunks) if (!kept(c)) { c.ticket?.remove(); T._dispose(c); T.chunks.delete(key); }
    // queued chunks still wanted plus the new ones, nearest source first
    T._want = T._want.filter(c => c.state === 'queued' && T.chunks.get(c.key) === c).concat(fresh).sort(this._byDist);
    return true;
  }

  /** Drop every chunk (before(c) first for a table's own cleanup); the next follow() places them again around the sources */
  drop(before) {
    const T = this.table;
    for (const c of T.chunks.values()) { c.ticket?.remove(); before?.(c); T._dispose(c); }   // a pending commit ticket is withdrawn with its chunk
    T.chunks.clear(); T._want = []; this.ver++;
  }

  /** LOD + frustum over ready chunks: level(c, ring) each, show(c, visible) when it changes. Returns { visible, instances } (reused object) */
  cull(camera) {
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    const H = this.hooks, out = this._out ??= { visible: 0, instances: 0 };
    out.visible = 0; out.instances = 0;
    for (const c of this.table.chunks.values()) {
      if (c.state !== 'ready') continue;
      const ring = this.ring(c);
      H.level(c, ring);
      const v = ring <= 1 || this._frustum.intersectsSphere(c.sphere);
      if (v !== c.inView) { c.inView = v; H.show(c, v); }
      if (v) { out.visible++; out.instances += H.count(c, ring); }
    }
    return out;
  }
}
