// HLOD: far buildings as a few proxy meshes.
// Merges far-away buildings into proxy meshes and shows the originals when near: fewer draw calls.
//   engine.use(level({ url }), hlod());              // default: handles the level automatically (on level:loaded)
//   engine.hlod.add(group, { cell: 64, near: 160 }); // or register manually
// How: split into cells of `cell` meters (default = engine.stream cell size); per cell, meshes sharing a material are baked to world space and merged into one proxy mesh;
// a node named xxx_LOD1 is a simplified xxx and is preferred when merging (it stays hidden itself). Merging runs in engine.jobs, spread over frames, so startup does not hitch.
// Every 0.25 s, switch by distance from the full-detail engine.stream sources: cell center farther than `near` meters from all of them shows the proxy and hides originals; with terrain, uses chunk-ring distance (same measure as terrain LOD).
// Owns far: batching (engine.batching) owns repeated near props; a mesh hlod registers is marked userData.hlod and batching skips it, and a mesh already
// batched (userData.batched) is skipped here, so the two never fight. Skips vegetation (it has its own instancing and LOD); no mesh simplification; proxies are not raycast (rays only hit originals): originals hidden when far get userData.rayVisible,
// so engine.raycast still hits far buildings (see core/Rays.js).
// Skips meshes whose material moves vertices (wind and other shadow: true patches): that code reads object space (height above the
// model origin, phase from the origin), so a world-space proxy would sway far more on high ground and every merged object in lockstep.
// Those meshes stay as they are (always drawn) and keep their own sway.
// After install, engine.hlod: add() returns a handle { cells, ready (boolean: all proxies merged), whenReady (Promise), remove() }; each cell is { key, proxy, originals, center, far }.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { readParams, keysSchema } from '../../core/params.js';
import { movesVertices } from '../../render/patches.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { Hlod, HlodOptions } from '../../types/world' */

const ADD_KEYS = ['cell', 'near', 'castShadow', 'include'];
const LOD_RE = /_LOD1$/;
const noRaycast = () => {};

// merge geometries of one material: keep only attributes all have; if any lacks an index, drop indices from all
function mergeGroup(meshes) {
  const geos = meshes.map(m => m.geometry.clone().applyMatrix4(m.matrixWorld));
  const names = Object.keys(geos[0].attributes).filter(n => geos.every(g => g.attributes[n]));
  const indexed = geos.every(g => g.index);
  const ready = geos.map(g => {
    const h = indexed ? g : g.toNonIndexed();
    for (const n of Object.keys(h.attributes)) if (!names.includes(n)) h.deleteAttribute(n);
    h.morphAttributes = {};
    return h;
  });
  const out = mergeGeometries(ready, false);
  for (const g of new Set([...geos, ...ready])) g.dispose();
  return out;
}

const FULL = { detail: 'full' };
const HLOD_PARAMS = keysSchema(['level', ...ADD_KEYS]);

/**
 * HLOD (merge far buildings into a few meshes) -> engine.hlod
 * @param {HlodOptions} [opts]
 * @returns {ModuleDef<Hlod>}
 * @experimental
 */
export function hlod(opts = {}) {
  readParams('hlod', HLOD_PARAMS, opts);
  const { level: autoLevel = true, ...defaults } = opts;
  let e = null, timer = 0, levelHandle = null;
  const handles = new Set();

  /** Far from every full-detail stream source (a 'simple' source keeps the proxy): chunk-ring difference with terrain, else horizontal distance (meters); a source radius caps near */
  function isFar(c, near) {
    const CH = e.terrain?.CHUNK;
    for (const f of e.stream.sources(FULL)) {
      const n = f.reach(near);
      if (CH ? Math.max(Math.abs(Math.floor(c.center.x / CH) - Math.floor(f.x / CH)), Math.abs(Math.floor(c.center.z / CH) - Math.floor(f.z / CH))) <= Math.ceil(n / CH)
        : Math.hypot(c.center.x - f.x, c.center.z - f.z) <= n) return false;
    }
    return true;
  }
  function setFar(c, far) {
    if (c.far === far) return;
    c.far = far;
    for (const p of c.proxy) p.visible = far;
    for (const m of c.originals) { m.visible = !far; if (far) m.userData.rayVisible = true; else delete m.userData.rayVisible; }
  }

  const api = {
    cells: [],
    /** Register objects (root or array) and merge them per cell into proxies; returns handle { cells, ready, whenReady, remove() } */
    add(target, o = {}) {
      readParams('hlod.add()', keysSchema(ADD_KEYS), o);
      const { cell = e.stream.cellSize, near = 160, castShadow = false, include = null } = { ...defaults, ...o };
      const roots = [].concat(target);
      for (const r of roots) r.updateMatrixWorld(true);
      // simplified node xxx_LOD1: record it, hide it
      const lods = new Map();
      for (const r of roots) r.traverse(n => { if (LOD_RE.test(n.name)) lods.set(n.name.replace(LOD_RE, ''), { node: n, visible: n.visible, used: false }); });
      // originals: visible plain meshes (skip LOD1 subtrees, skinned, instanced, multi-material)
      const originals = [];
      const walk = n => {
        if (!n.visible || LOD_RE.test(n.name)) return;
        if (n.isMesh && !n.isInstancedMesh && !n.isSkinnedMesh && !n.userData.batched && !Array.isArray(n.material) && n.geometry && (!include || include(n))) originals.push(n);
        for (const c of n.children) walk(c);
      };
      roots.forEach(walk);
      for (let i = originals.length; i--;) if (movesVertices(originals[i].material)) originals.splice(i, 1);   // swaying meshes keep their own transform (see header)
      for (const m of originals) m.userData.hlod = true;   // engine.batching leaves hlod's meshes alone (marked after the filter: swaying meshes stay batchable)
      for (const l of lods.values()) l.node.visible = false;
      // split into cells by bounding-box center; where a LOD1 exists, its meshes join the merge instead (each LOD1 used once)
      const cells = new Map(), box = new THREE.Box3(), v = new THREE.Vector3();
      const lodOf = m => { for (let p = m; p; p = p.parent) { const l = lods.get(p.name); if (l) return l; if (roots.includes(p)) break; } return null; };
      for (const m of originals) {
        box.setFromObject(m).getCenter(v);
        const key = Math.floor(v.x / cell) + ',' + Math.floor(v.z / cell);
        const c = cells.get(key) || cells.set(key, { key, proxy: [], originals: [], sources: [], center: new THREE.Vector3(), far: false }).get(key);
        c.originals.push(m); c.center.add(v);
        const l = lodOf(m);
        if (!l) c.sources.push(m);
        else if (!l.used) { l.used = true; l.node.traverse(n => { if (n.isMesh && !Array.isArray(n.material)) c.sources.push(n); }); }
      }
      const group = new THREE.Group();
      group.name = 'hlod'; group.userData.budgetTag = 'hlod'; group.matrixAutoUpdate = false;
      e.add(group, { owner: 'engine:hlod' });
      const list = [...cells.values()];
      for (const c of list) c.center.divideScalar(c.originals.length);
      const h = {
        cells: list, near, ready: false,
        // one step per cell: merge by material into a proxy (spread over frames, at most engine.jobs.budgetMs ms per frame)
        whenReady: e.jobs.add(function* () {
          for (const c of list) {
            if (h.removed) return;
            const byMat = new Map();
            for (const m of c.sources) (byMat.get(m.material) || byMat.set(m.material, []).get(m.material)).push(m);
            for (const [mat, ms] of byMat) {
              const p = new THREE.Mesh(mergeGroup(ms), mat);
              p.name = 'hlod_' + c.key; p.castShadow = castShadow; p.receiveShadow = true;
              p.matrixAutoUpdate = false; p.visible = false; p.raycast = noRaycast;
              group.add(p); c.proxy.push(p);
            }
            delete c.sources;
            api.cells.push(c);
            yield;
          }
          h.ready = true;
          return h;
        }),
        /** Unregister: restore originals, release proxies */
        remove() {
          h.removed = true; handles.delete(h);
          for (const c of list) { setFar(c, false); for (const p of c.proxy) p.geometry.dispose(); for (const m of c.originals) delete m.userData.hlod; }
          api.cells = api.cells.filter(c => !list.includes(c));
          for (const l of lods.values()) l.node.visible = l.visible;
          e.detach(group);   // proxies share the originals' materials and are never ray-registered: geometries were disposed above
        },
      };
      handles.add(h);
      timer = Infinity;   // switch by distance on the next frame
      return h;
    },
    /** @internal Switch by the current stream sources right now (normally runs automatically every 0.25 s) */
    update() {
      for (const h of handles) for (const c of h.cells) if (c.proxy.length) setFar(c, isFar(c, h.near));
    },
  };

  const addLevel = root => { levelHandle?.remove(); levelHandle = root ? api.add(root) : null; };
  return {
    name: 'hlod', params: HLOD_PARAMS, options: opts, label: 'HLOD', optional: ['terrain', 'level'], presentation: true,
    install(engine) {
      e = engine;
      if (autoLevel) {
        e.events.on('level:loaded', ({ root }) => addLevel(root));
        if (e.level?.ready && e.level.root) addLevel(e.level.root);   // install hlod only after the level is ready
      }
      return api;
    },
    frame(dt) { if ((timer += dt) >= 0.25) { timer = 0; api.update(); } },
    describe() { return { cells: api.cells.length, far: api.cells.filter(c => c.far).length }; },
  };
}
