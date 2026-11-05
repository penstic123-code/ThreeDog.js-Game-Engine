// Level module: load a hand-built scene (glTF/GLB from Blender, or THREE objects assembled in code) and make it playable:
//   - ground: walkable meshes become ground height (provides engine.surface/slope/groundType; mutually exclusive with the terrain module)
//   - collision: meshes named col_* (or userData.collider) become walls the character cannot cross; col_ meshes themselves are hidden
//   - markers: objects named spawn, spawn_*, npc_*, trigger_*, marker_* (usually Blender empties) have their positions recorded
//
// engine.use(collision(), rigid(), followCamera(), characters(), level({ url: '/models/town.glb' }), triggers());
// engine.events.on('level:loaded', ({ markers }) => {
//   const s = engine.level.spawn;                                   // spawn point { x, y, z }
//   engine.characters.createPlayer({ spawn: { x: s.x, z: s.z } });
//   engine.triggers.fromMarkers({ onEnter: t => console.log('entered', t.tag) });
// });
// engine.start();
//
// Files are optional: level({ scene: a THREE.Group }) is usable immediately on install (spawn point and ground are queryable at once).
//
// Naming conventions in Blender:
//   walkable    name contains ground / floor / road / terrain / stair(s) / ramp, or custom property walkable = true
//              (if none match, all meshes are walkable). Ground type = custom property groundType, else the material name
//   walls/obstacles  col_xxx (hidden collision box, only blocks movement), or custom property collider = true (a visible object that blocks)
//   markers     spawn, spawn_2, npc_shopkeeper, trigger_door, marker_chest -- custom properties go into userData as-is
//   records     custom property template = 'door' (an instance of a content template; its other custom properties fill the template's state) or id = true
//              (the node itself becomes a world record, kind 'levelNode', its custom properties are record fields): id `<level file name>/<node name>`,
//              e.g. town/door_front; saved as a diff like content entries (opened, removed, moved). Untagged meshes stay static scenery
//
// Options:
//   url / scene   pick one: glTF path (or name in the assets manifest) / THREE.Object3D built in code
//   walkable      mesh => true/false, decide which meshes are walkable (default: the naming conventions above)
//   colliders     'named' (default, only col_ and userData.collider) | 'auto' (also treat every non-walkable mesh taller than 0.5 m as a wall) | false
//   cellSize      heightfield cell size in meters, default 0.5. Smaller is more precise but uses more memory
//   sharpEdge     neighboring-point height difference (m) above which it is a step edge, no smoothing, default 0.6
//   outside       ground height outside the level, default 0
//   waterLevel    water surface height, default -Infinity (no water)
//   colliderPad   extra outward padding of collision boxes, default 0
//   colliderHeight minimum collision box height (a too-low col_ box still blocks this high), default 0
//   hideMarkers   hide a marker if it is a mesh (e.g. a placeholder cube), default true
//   addToScene    add the scene to engine.scene, default true
//
// After install, engine.level:
//   root / object scene root node (THREE.Object3D)
//   markers       { name: { name, position, quaternion, scale, userData, object } } (world space; position is a Vector3, object is the original)
//   spawn         spawn position (spawn, else the first spawn_*, else the origin)
//   marker(name) / markersWith(prefix)   get one / get a group (e.g. markersWith('npc_'))
//   ready         whether loading is done (boolean)
//   heightfield   heightfield data (for debugging)
//   staticTrimeshes()  walkable-mesh triangles (world space), for building Rapier static colliders
//   load(path/asset name or THREE object)   switch level (unload current, load new, emit level:loaded when done); returns a Promise
//   unload()      unload (also removes everything registered via track)
// track(handle) register things that belong to the current level and need no keeping (handles with remove(): trigger zones...); auto-removed on level switch /
// unload.
// World data that must keep state (NPCs, pickups, props) is not tracked: records carry zone (= level name), a level switch only tears down models.
//                 triggers.fromMarkers and content (when positions use level markers) are tracked automatically
// Rays: all meshes are registered in engine.rays (builds BVH); col_ meshes and non-walkable meshes (buildings, walls) also occlude the camera (collision's
// cameraOcclusion).
// Save: the current level (path or asset name) goes into the save; on load, switch back first and wait for it before loading the rest (save key level comes
// first, load returns a Promise);
// scenes built in code (scene) cannot be saved, loading does not switch level -- to support cross-level loading, register the builder in the assets manifest
// and use level({ url: name }).
// Event: level:loaded { root, markers, spawn }
// Picture: the level module draws nothing itself, the scene looks entirely like your model, so it does not read the style.
import * as THREE from 'three';
import { readParams, keysSchema } from '../../core/base/params.js';
import { levelNodes } from './nodes.js';
import { worldTrimeshes } from './geometry.js';
import { loadLevel, finishLoad, processScene } from './load.js';
import { warnOnce } from '../../core/base/validate.js';
import { coded } from '../../core/base/errorHints.js';

const STRINGS = {
  'zh-CN': { 'module.level': '关卡', 'level.loadFailed': '关卡加载失败：{url}', 'level.noScene': '关卡模块需要 url 或 scene 参数' },
  en: { 'module.level': 'level', 'level.loadFailed': 'Failed to load level: {url}', 'level.noScene': 'The level module needs a url or scene option' },
};

const LEVEL_PARAMS = keysSchema(['url', 'scene', 'walkable', 'colliders', 'cellSize', 'outside', 'waterLevel', 'colliderPad', 'colliderHeight', 'sharpEdge', 'hideMarkers', 'addToScene']);

/** The object behind engine.level; st is the module's state (level() below). load and unload go through api, so a wrapped one (engine.wrap) is the one that runs */
function levelApi(st) {
  const api = {
    root: null, markers: {}, spawn: new THREE.Vector3(), heightfield: null,
    get ready() { return st.done; },
    /** Register things belonging to the current level ({ remove() } handles); auto-removed on level switch / unload; returns the same handle */
    track(h) { if (h) st.removers.push(h); return h; },
    marker: name => api.markers[name] || null,
    markersWith: prefix => Object.values(api.markers).filter(m => m.name.startsWith(prefix)),
    /** @internal Triangles of walkable meshes (world space), [{ positions: Float32Array, indices: Uint32Array }], cached */
    staticTrimeshes() {
      if (st.trimeshCache) return st.trimeshCache;
      st.trimeshCache = worldTrimeshes(st.walkMeshes);
      return st.trimeshCache;
    },
    /** Unload the level: remove from scene, delete colliders, ground reverts to the outside height */
    unload() {
      for (const h of st.removers.splice(0)) h.remove();
      if (api.root && st.o.addToScene) st.e.remove(api.root);   // full removal (geometries and materials shared by assets are not disposed)
      st.walkMeshes.length = 0; st.hf = api.heightfield = null; st.pendingColliders = null; st.trimeshCache = null; api.markers = {}; api.root = null; st.current = null; st.version++; st.loadGen++;
      st.done = true;   // nothing is loading now: a file still on its way is dropped, and no finishLoad would ever come for it (load sets it back)
    },
    /** Switch level: unload the current one, load a new one (glTF path/asset name, or THREE object), emit level:loaded when done */
    async load(urlOrScene) { return loadLevel(st, urlOrScene, false); },
  };
  return api;
}

export function level(opts = {}) {
  readParams('level', LEVEL_PARAMS, opts);
  const { url = null, scene = null, walkable = null, colliders = 'named', cellSize = 0.5, outside = 0, waterLevel = -Infinity,
    colliderPad = 0, colliderHeight = 0, sharpEdge = 0.6, hideMarkers = true, addToScene = true } = opts;
  const st = {
    e: null, hf: null, done: false, version: 0, trimeshCache: null, pendingColliders: null,
    o: { walkable, colliders, cellSize, outside, colliderPad, colliderHeight, sharpEdge, hideMarkers, addToScene },
    loadGen: 0,   // +1 per load / unload: a file that arrives after a newer load or unload started is dropped, not processed on top of it
    current: typeof url === 'string' && !scene ? url : null,   // current level path/asset name (for saving)
    walkMeshes: [], removers: [],
    nodeSet: null,   // level nodes that become world records (nodes.js), created at install
  };
  const api = st.api = levelApi(st);

  return {
    name: 'level', type: 'world', provides: ['level'], params: LEVEL_PARAMS, options: opts, label: 'Level', stage: 'ground', after: ['terrain'], optional: ['world', 'content', 'collision'],
    install(engine) {
      const e = st.e = engine;
      st.nodeSet = levelNodes(e, () => api.root, () => st.current);
      e.i18n.add(STRINGS);
      // ground API: before the heightfield is built, return the outside height
      e.setGround({
        height: (x, z, refY) => st.hf ? st.hf.height(x, z, refY) : outside,
        slope: (x, z) => st.hf ? st.hf.slope(x, z) : 0,
        type: (x, z) => st.hf ? st.hf.type(x, z) : 'default',
        waterLevel,
        staticTrimeshes: () => api.staticTrimeshes(),
        staticVersion: () => st.version,          // +1 on level change; the physics module rebuilds static colliders on it
      });
      if (scene) processScene(st, scene);
      // on load, switch back to the saved level (code-built scenes have no name, record null, no switch)
      // load returns a Promise: the save system waits for the new level (old level's trigger zones are already removed by unload) before reading player
      // position etc.
      e.saves.register('level', { first: true, save: () => st.current, load: d => { if (typeof d === 'string' && d !== st.current) return api.load(d); } });
      return api;
    },
    critical: true,   // the level file is the game's world: a failed load stops start() with the reason
    async init(engine) {
      if (scene) return finishLoad(st);
      if (url) return loadLevel(st, url, true);
      warnOnce(coded('level-node', engine.t('level.noScene')));
      finishLoad(st);
    },
    isReady() { return st.done; },
    // which level is up and what it gave: a wrong path shows as file set but markers 0 / walk 0, a code-built scene as file null
    describe() {
      const s = api.spawn, r = v => Math.round(v * 10) / 10;
      return { file: st.current, ready: st.done, markers: Object.keys(api.markers).length, walkMeshes: st.walkMeshes.length, removers: st.removers.length,
        spawn: { x: r(s.x), y: r(s.y), z: r(s.z) } };
    },
  };
}
