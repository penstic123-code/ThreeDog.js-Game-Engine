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
// Look: the level module draws nothing itself, the scene looks entirely like your model, so it does not read the style pack.
import * as THREE from 'three';
import { buildHeightfield } from './heightfield.js';
import { toast } from '../../ui/UI.js';
import { checkOptions } from '../../core/validate.js';
import { MARKER_RE, levelNodes } from './nodes.js';
import { worldTrimeshes, colliderBoxes } from './geometry.js';

const STRINGS = {
  'zh-CN': { 'level.loadFailed': '关卡加载失败：{url}', 'level.noScene': '关卡模块需要 url 或 scene 参数' },
  en: { 'level.loadFailed': 'Failed to load level: {url}', 'level.noScene': 'The level module needs a url or scene option' },
};

const WALK_RE = /ground|floor|road|terrain|stairs?|ramp/i;
const COL_RE = /^col_/i;

// a name or userData on the node itself or any ancestor counts (in glTF meshes often hang under a same-named empty)
function chainHas(o, root, test) {
  for (let p = o; p; p = p.parent) { if (test(p)) return true; if (p === root) break; }
  return false;
}
function chainValue(o, root, key) {
  for (let p = o; p; p = p.parent) { if (p.userData?.[key] != null) return p.userData[key]; if (p === root) break; }
  return undefined;
}

export function level(opts = {}) {
  const { url = null, scene = null, walkable = null, colliders = 'named', cellSize = 0.5, outside = 0, waterLevel = -Infinity,
    colliderPad = 0, colliderHeight = 0, sharpEdge = 0.6, hideMarkers = true, addToScene = true } = opts;
  let e = null, hf = null, done = false, version = 0, trimeshCache = null, pendingColliders = null;
  let current = typeof url === 'string' && !scene ? url : null;   // current level path/asset name (for saving)
  const walkMeshes = [], removers = [];
  let nodeSet = null;   // level nodes that become world records (nodes.js), created at install

  const api = {
    root: null, markers: {}, spawn: new THREE.Vector3(), heightfield: null,
    get object() { return api.root; },   // same as root (consistent with player.object, ent.object)
    get ready() { return done; },
    /** Register things belonging to the current level ({ remove() } handles); auto-removed on level switch / unload; returns the same handle */
    track(h) { if (h) removers.push(h); return h; },
    marker: name => api.markers[name] || null,
    markersWith: prefix => Object.values(api.markers).filter(m => m.name.startsWith(prefix)),
    /** @internal Triangles of walkable meshes (world space), [{ positions: Float32Array, indices: Uint32Array }], cached */
    staticTrimeshes() {
      if (trimeshCache) return trimeshCache;
      trimeshCache = worldTrimeshes(walkMeshes);
      return trimeshCache;
    },
    /** Unload the level: remove from scene, delete colliders, ground reverts to the outside height */
    unload() {
      for (const h of removers.splice(0)) h.remove();
      if (api.root && addToScene) e.remove(api.root);   // full removal (geometries and materials shared by assets are not disposed)
      walkMeshes.length = 0; hf = null; trimeshCache = null; api.markers = {}; api.root = null; current = null; version++;
    },
    /** Switch level: unload the current one, load a new one (glTF path/asset name, or THREE object), emit level:loaded when done */
    async load(urlOrScene) {
      api.unload(); done = false;
      e.commits.invalidate();   // background results requested for the old level must not land on the new one
      // world-data zone = level name: other levels' NPCs etc. only lose models, data stays and is rebuilt on return (code-built scenes have no name, record
      // null, no zoning)
      if (e.world) e.world.zone = typeof urlOrScene === 'string' ? urlOrScene : null;
      if (typeof urlOrScene === 'string') {
        current = urlOrScene;
        try { process(await e.assets.model(urlOrScene)); }
        catch (err) { console.error(err); toast(e, e.t('level.loadFailed', { url: urlOrScene }), { kind: 'error' }); }
      } else process(urlOrScene);
      loaded();
    },
  };

  function loaded() {
    addColliders();                    // if the collision module is installed after level, add colliders here
    // nodes tagged template / id become world records (loading is setup, not a gameplay action) before anyone (hlod...) sees level:loaded
    e.ops.allow(nodeSet.place);
    done = true;
    e.assets.trim();                   // old level's models have no copies in use: return GPU memory
    e.events.emit('level:loaded', { root: api.root, markers: api.markers, spawn: api.spawn });
  }

  /** Process a scene: classify meshes, build the heightfield, record markers. Colliders wait for the collision module (may not be installed at install time) */
  function process(root) {
    api.root = root;
    root.userData.budgetTag ??= 'level';
    if (addToScene && !root.parent) e.add(root);
    root.updateMatrixWorld(true);
    nodeSet.take(root);   // record nodes leave the level root first: no ground, collision or ray registration for them, and hlod never bakes them
    const meshes = [], cols = [], markerObjs = [];
    root.traverse(o => {
      if (MARKER_RE.test(o.name)) { markerObjs.push(o); return; }
      if (!o.isMesh) return;
      // placeholder models under a marker
      if (o.parent && chainHas(o.parent, root, p => MARKER_RE.test(p.name))) { if (hideMarkers) o.visible = false; return; }
      if (chainHas(o, root, p => COL_RE.test(p.name))) { cols.push(o); o.visible = false; return; }
      meshes.push(o);
    });
    // walkable meshes
    const isWalk = walkable || (m => chainHas(m, root, p => p.userData?.walkable === true || WALK_RE.test(p.name)));
    let walk = meshes.filter(m => chainValue(m, root, 'walkable') !== false && isWalk(m));
    if (!walkable && !walk.length) walk = meshes.filter(m => chainValue(m, root, 'walkable') !== false);
    walkMeshes.push(...walk);
    const walkSet = new Set(walk);
    for (const m of meshes) {
      if (walkSet.has(m)) continue;
      if (chainValue(m, root, 'collider')) cols.push(m);
      else if (colliders === 'auto') { const b = new THREE.Box3().setFromObject(m); if (b.max.y - b.min.y > 0.5) cols.push(m); }
    }
    // heightfield
    const typeOf = (m, mi) => {
      const t = chainValue(m, root, 'groundType'); if (t != null) return String(t);
      const mat = Array.isArray(m.material) ? m.material[mi] : m.material;
      return mat?.name || 'default';
    };
    const t0 = performance.now();   // measure
    hf = api.heightfield = buildHeightfield(walk, { cellSize, outside, typeOf, sharpEdge, stepUp: e.movement.stepHeight, layerGap: e.movement.height });
    api.buildMs = performance.now() - t0;   // measure: heightfield build time (shown in the debug panel)
    // markers
    const markers = api.markers = {};
    for (const o of markerObjs) {
      const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
      o.matrixWorld.decompose(position, quaternion, scale);
      markers[o.name] = { name: o.name, position, quaternion, scale, userData: { ...o.userData }, object: o };
      if (hideMarkers && o.isMesh) o.visible = false;
    }
    const sp = markers.spawn || Object.values(markers).find(m => /^spawn_/i.test(m.name));
    api.spawn = sp ? sp.position.clone() : new THREE.Vector3(0, hf.height(0, 0), 0);
    pendingColliders = colliders === false ? cols.filter(m => COL_RE.test(m.name) || chainValue(m, root, 'collider')) : cols;
    // rays: all meshes; collision meshes and non-walkable meshes also occlude the camera
    removers.push(e.rays.addStatic(root), e.rays.addStatic([...cols, ...meshes.filter(m => !walkSet.has(m))], { occluder: true }));
    trimeshCache = null; version++;
    addColliders();
  }

  /** Turn collision meshes into rotated boxes in the collision module (best-fit box by the mesh's world orientation) */
  function addColliders() {
    const ph = e.collision;
    if (!ph || !pendingColliders) return;
    for (const b of colliderBoxes(pendingColliders, { colliderHeight, colliderPad })) removers.push(ph.addBox(b.at, b.opts));
    pendingColliders = null;
  }

  return {
    name: 'level', label: 'Level', stage: 'world', after: ['terrain'], optional: ['world', 'content'],
    install(engine) {
      e = engine;
      nodeSet = levelNodes(e, () => api.root, () => current);
      checkOptions('level()', opts, ['url', 'scene', 'walkable', 'colliders', 'cellSize', 'outside', 'waterLevel', 'colliderPad', 'colliderHeight', 'sharpEdge', 'hideMarkers', 'addToScene']);
      e.i18n.add(STRINGS);
      // ground API: before the heightfield is built, return the outside height
      e.setGround({
        height: (x, z, refY) => hf ? hf.height(x, z, refY) : outside,
        slope: (x, z) => hf ? hf.slope(x, z) : 0,
        type: (x, z) => hf ? hf.type(x, z) : 'default',
        waterLevel,
        staticTrimeshes: () => api.staticTrimeshes(),
        staticVersion: () => version,          // +1 on level change; the physics module rebuilds static colliders on it
      });
      if (scene) process(scene);
      // on load, switch back to the saved level (code-built scenes have no name, record null, no switch)
      // load returns a Promise: the save system waits for the new level (old level's trigger zones are already removed by unload) before reading player
      // position etc.
      e.saves.register('level', { first: true, save: () => current, load: d => { if (typeof d === 'string' && d !== current) return api.load(d); } });
      return api;
    },
    critical: true,   // the level file is the game's world: a failed load stops start() with the reason
    async init(engine) {
      if (scene) return loaded();
      if (url) return api.load(url);
      console.warn(engine.t('level.noScene'));
      loaded();
    },
    isReady() { return done; },
  };
}
