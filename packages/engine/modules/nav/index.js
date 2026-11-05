// Navmesh (Recast): generated after a level loads; engine.characters.findPath switches to it automatically (falls back to A* when not installed).
//   engine.use(level({ url }), collision(), characters(), nav({ agentRadius: 0.4 }));
// Once installed, engine.nav offers findPath(from, to) and the native objects navMesh / query / tileCache / crowd / helper.
// version: +1 on every rebuild / unload. Native objects (crowd agents etc.) are destroyed on rebuild; code that cached them must compare version and re-fetch when it changed (NPCs do this).
//
// Where the mesh comes from: the ground API's staticTrimeshes() (the level's walkable mesh).
// Walls and obstacles: boxes/circles in the collision module (level col_ boxes, ones added by game collision.addBox) are all synced into TileCache dynamic obstacles,
// and affected tiles are rebuilt on add/remove, so level walls and later-added obstacles work the same way.
// Levels only for now (ground with staticTrimeshes); procedural terrain keeps using A*. Recast (about 1MB) is downloaded only at init.
// The mesh is built once per level: ground edits (engine.terrain.edit, 'ground:change') do not update it, so paths keep following the ground as it was
// at level load (rebuilding all tiles per edit is too slow to do automatically). A game that reshapes walkable ground at runtime leaves nav out:
// characters.findPath then uses A*, which resamples the edited area (its rasters are dropped on 'ground:change').
import { readParams, keysSchema } from '../../core/base/params.js';
import { xzOf } from '../../core/base/math.js';
import { navSearch } from './navPath.js';
import { warnOnce } from '../../core/base/validate.js';
import { coded } from '../../core/base/errorHints.js';

const NAV_PARAMS = keysSchema(['cellSize', 'agentRadius', 'agentHeight', 'maxClimb', 'maxSlope', 'tileSize', 'crowd', 'debug', 'maxObstacles', 'maxAgents', 'arrive']);

export function nav(opts = {}) {
  readParams('nav', NAV_PARAMS, opts);
  // maxObstacles / maxAgents: Recast's fixed capacities (a city of 3000 wall pieces needs more than a village; a crowd scene more than 128 agents).
  // arrive: meters past the character's radius a path may end short of its goal and still count as arrived (a ledge-strict platformer wants less)
  const { cellSize = 0.3, tileSize = 32, crowd = false, debug = false, maxObstacles = 1024, maxAgents = 128, arrive = 0.6 } = opts;
  // agent size defaults come from engine.movement (filled at install); opts values override them
  let agentRadius, agentHeight, maxClimb, maxSlope;
  let e = null, lib = null, gen = null, pending = false, wasm = null;   // wasm: the recast import + init begun at install
  let obstacles = null;   // engine.collision.mirror: collision-module collider -> its Recast obstacles (big boxes are cut into several pieces)

  const api = {
    ready: false, agent: null, navMesh: null, query: null, tileCache: null, crowd: null, helper: null,
    /** +1 on rebuild / unload: code that cached native objects such as crowd agents must re-create them when it changes */
    version: 0,
    /**
     * Path [{ x, z }...] (meters) from `from` to `to`; null if not ready or unreachable.
     * Pass { detailed: true } to get { status: 'ok' | 'noPath' | 'notReady', path } instead: tells "navmesh not generated yet" from "generated but unreachable"
     */
    findPath(from, to, o = {}) {
      const res = search(from, to, o);
      return o.detailed ? res : res.path;
    },
    /** @internal +1 whenever the walkable mesh changes (rebuild, unload, obstacle sync): async pathfinding re-sends the mesh to its workers and redoes answers computed on an older one */
    revision: 0,
    /** @internal the current mesh as bytes, imported by the pathfinding worker */
    exportMesh() { return lib.exportNavMesh(api.navMesh); },
    /** @internal how far (m) a path may end short of its goal and still count as arriving, for a character of this radius */
    reach(radius) { return (radius ?? agentRadius) + arrive; },
    /** Unload the navmesh (frees native objects); afterwards characters.findPath falls back to A* */
    dispose() {
      api.ready = false; api.version++; api.revision++;
      if (api.helper) e.remove(api.helper);   // the debug mesh is built by us: remove it completely
      api.crowd?.destroy(); api.tileCache?.destroy(); api.navMesh?.destroy(); api.query?.destroy();
      Object.assign(api, { navMesh: null, query: null, tileCache: null, crowd: null, helper: null });
      obstacles?.clear();
    },
  };

  function search(from, to, o) {
    if (!api.ready) return { status: 'notReady', path: null };
    const [sx, sz] = xzOf(from), [gx, gz] = xzOf(to);
    return navSearch(api.query, { x: sx, y: e.surface(sx, sz), z: sz }, { x: gx, y: e.surface(gx, gz), z: gz }, api.reach(o.radius));
  }

  /** Walkable triangle mesh of the ground (world coordinates), merged into one */
  function geometry() {
    const G = e.ground;
    const list = G.staticTrimeshes?.() || [];
    let n = 0, m = 0;
    for (const t of list) { n += t.positions.length; m += t.indices.length; }
    const positions = new Float32Array(n), indices = new Uint32Array(m);
    let pn = 0, im = 0;
    for (const t of list) { positions.set(t.positions, pn); for (let i = 0; i < t.indices.length; i++) indices[im + i] = t.indices[i] + pn / 3; pn += t.positions.length; im += t.indices.length; }
    return { positions, indices };
  }

  async function build() {
    pending = false;
    if (api.ready) api.dispose();
    const { positions, indices } = geometry();
    if (!indices.length) return;
    const ch = cellSize / 2;
    const r = gen.generateTileCache(positions, indices, {
      cs: cellSize, ch, tileSize, expectedLayersPerTile: 4, maxObstacles,
      walkableSlopeAngle: maxSlope, walkableHeight: Math.ceil(agentHeight / ch), walkableClimb: Math.ceil(maxClimb / ch), walkableRadius: Math.ceil(agentRadius / cellSize),
    });
    if (!r.success) { warnOnce(coded('nav-build', 'nav: ' + r.error)); return; }
    api.tileCache = r.tileCache; api.navMesh = r.navMesh;
    api.query = new lib.NavMeshQuery(r.navMesh);
    if (crowd) api.crowd = new lib.Crowd(r.navMesh, { maxAgents, maxAgentRadius: agentRadius * 2 });
    api.ready = true; api.version++; api.revision++;
    syncObstacles();
    if (debug) {
      const three = await import('@recast-navigation/three');
      api.helper = new three.NavMeshHelper(r.navMesh);
      api.helper.position.y = 0.05; e.add(api.helper, { owner: 'engine:nav' });
    }
  }

  // collision-module colliders -> TileCache obstacles (engine.collision.mirror diffs add / remove, shared with rigid), then rebuild affected tiles
  function obstacle(type, o) {
    const tc = api.tileCache, list = [];
    const y = (o.y ?? e.surface(o.x, o.z)) - maxClimb, h = (o.h ?? 6) + maxClimb;   // extend a bit downward: Recast ignores a bottom face lying exactly on the ground
    if (type === 'box') {
      // one obstacle affects at most 8 tiles: cut big boxes into pieces no larger than half a tile (along the box's own orientation)
      const hw = o.hw + agentRadius, hd = o.hd + agentRadius, piece = tileSize * cellSize / 2;   // add the agent radius so agents don't hug walls
      const nx = Math.ceil(hw * 2 / piece), nz = Math.ceil(hd * 2 / piece), c = Math.cos(o.rot), sn = Math.sin(o.rot);
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const lx = -hw + (i + 0.5) * hw * 2 / nx, lz = -hd + (j + 0.5) * hd * 2 / nz;
        const res = tc.addBoxObstacle({ x: o.x + lx * c + lz * sn, y: y + h / 2, z: o.z - lx * sn + lz * c }, { x: hw / nx, y: h / 2, z: hd / nz }, -o.rot);   // Detour's rotation direction is opposite to three's
        if (res.success) list.push(res.obstacle);
      }
    } else {
      const res = tc.addCylinderObstacle({ x: o.x, y, z: o.z }, o.r + agentRadius, h);
      if (res.success) list.push(res.obstacle);
    }
    queued += list.length;
    if (queued >= BATCH) flush();
    return list;
  }
  function syncObstacles() {
    if (!api.ready || !e.collision) return;
    obstacles ??= e.collision.mirror({ add: obstacle, remove: list => { for (const ob of list) { api.tileCache.removeObstacle(ob); if (++queued >= BATCH) flush(); } } });
    if (!obstacles.sync()) return;
    flush();
    api.revision++;
    api.helper?.update();
  }
  // obstacle requests are processed once a batch has built up, until all tiles are rebuilt
  const BATCH = 48;
  let queued = 0;
  function flush() { queued = 0; for (let i = 0; i < 256 && !api.tileCache.update(api.navMesh).upToDate; i++); }

  return {
    name: 'nav', type: 'world', provides: ['nav'], optional: { collision: 'walls and obstacles are not cut out of the navmesh', level: 'no walkable mesh to build from, so paths stay on A*' }, params: NAV_PARAMS, options: opts, label: 'Navmesh',
    install(engine, ctx) {
      e = engine;
      e.i18n.add({ 'zh-CN': { 'module.nav': '导航网格' }, en: { 'module.nav': 'navmesh' } });
      const mv = e.movement;
      ({ agentRadius = mv.radius, agentHeight = mv.height, maxClimb = mv.stepHeight, maxSlope = mv.maxSlope } = opts);
      api.agent = { radius: agentRadius, height: agentHeight, maxClimb, maxSlope };
      ctx.track(e.events.on('level:loaded', () => { if (lib) build(); else pending = true; }));
      pending = !!e.level?.ready;   // installed after the level loaded: that event is gone, init builds the mesh
      // fetch and compile the WASM from install on, so it loads while the page builds the world instead of inside start()'s module inits
      wasm = Promise.all([import('@recast-navigation/core'), import('@recast-navigation/generators')]).then(async ([l, g]) => { await l.init(); return [l, g]; });
      wasm.catch(() => {});   // a failure is reported by init (which awaits the same promise), not as an unhandled rejection here
      return api;
    },
    async init() {
      [lib, gen] = await wasm;
      if (pending) await build();
    },
    isReady() { return !!lib && !pending; },
    fixed(dt) {
      syncObstacles();
      api.crowd?.update(dt);
    },
    describe() { return { ready: api.ready, version: api.version, obstacles: obstacles?.size ?? 0 }; },
    // engine.dispose(): the Recast navMesh / query / tileCache / crowd live in the WASM heap, not in JS, so the garbage collector never frees
    // them; an editor or test that makes engines over and over would grow that heap every time
    dispose() { api.dispose(); },
  };
}
