// Loading a level: st is the module's state (index.js), and the steps run in this order: loadLevel -> processScene -> finishLoad.
import * as THREE from 'three';
import { buildHeightfield } from './heightfield.js';
import { colliderBoxes } from './geometry.js';
import { sortNodes, groundTypeOf, readMarkers, chainHas, chainValue, COL_RE } from './meshes.js';
import { toast } from '../../ui/UI.js';
import { reportError } from '../../core/base/errors.js';

/** hard: the first load from init() (the module is critical, so a missing level file must stop start() instead of opening an empty world);
 *  a switch while playing or a save load stays soft (reported + toast) so the running game is not torn down by one bad path */
export async function loadLevel(st, urlOrScene, hard) {
  const { e, api } = st;
  api.unload(); st.done = false;
  e.commits.invalidate();   // background results requested for the old level must not land on the new one
  // world-data zone = level name: other levels' NPCs etc. only lose models, data stays and is rebuilt on return (code-built scenes have no name, record
  // null, no zoning)
  if (e.world) e.world.zone = typeof urlOrScene === 'string' ? urlOrScene : null;
  if (typeof urlOrScene === 'string') {
    st.current = urlOrScene;   // set before processScene(): level nodes read it as their zone
    const gen = st.loadGen;
    try {
      const scene = await e.assets.model(urlOrScene);
      // a newer load / unload started while this file loaded (two doors in a row, a save loaded mid-switch): that one owns the level now;
      // processing this one too would put both levels in the scene under the newer level's name
      if (gen !== st.loadGen || e.disposed) { e.remove(scene); return; }   // e.remove releases the copy (assets.trim can free the file)
      processScene(st, scene);
    } catch (err) {
      if (gen !== st.loadGen || e.disposed) return;   // superseded: the newer load reports its own outcome
      st.current = null;   // the save must not name a level that never loaded
      if (hard) throw err;
      reportError(e, err, `level.load('${urlOrScene}')`, { soft: true }); toast(e, e.t('level.loadFailed', { url: urlOrScene }), { kind: 'error' });
    }
  } else processScene(st, urlOrScene);
  finishLoad(st);
}

export function finishLoad(st) {
  const { e, api } = st;
  addColliders(st);                  // if the collision module is installed after level, add colliders here
  // nodes tagged template / id become world records (loading is setup, not a gameplay action) before anyone (hlod...) sees level:loaded
  e.ops.allow(st.nodeSet.place);
  st.done = true;
  e.assets.trim();                   // old level's models have no copies in use: return GPU memory
  e.events.emit('level:loaded', { root: api.root, markers: api.markers, spawn: api.spawn });
}

/** Process a scene: classify meshes, build the heightfield, record markers. Colliders wait for the collision module (may not be installed at install time) */
export function processScene(st, root) {
  const { e, api, o } = st;
  api.root = root;
  root.userData.budgetTag ??= 'level';
  if (o.addToScene && !root.parent) e.add(root, { owner: 'level' });
  root.updateMatrixWorld(true);
  st.nodeSet.take(root);   // record nodes leave the level root first: no ground, collision or ray registration for them, and hlod never bakes them
  const { meshes, cols, markerObjs, walk, walkSet } = sortNodes(root, o);
  st.walkMeshes.push(...walk);
  // heightfield
  const t0 = performance.now();   // measure
  st.hf = api.heightfield = buildHeightfield(walk, { cellSize: o.cellSize, outside: o.outside, typeOf: groundTypeOf(root), sharpEdge: o.sharpEdge, stepUp: e.movement.stepHeight, layerGap: e.movement.height });
  api.buildMs = performance.now() - t0;   // measure: heightfield build time (shown in the debug panel)
  const markers = api.markers = readMarkers(markerObjs, o.hideMarkers);
  const sp = markers.spawn || Object.values(markers).find(m => /^spawn_/i.test(m.name));
  api.spawn = sp ? sp.position.clone() : new THREE.Vector3(0, st.hf.height(0, 0), 0);
  st.pendingColliders = o.colliders === false ? cols.filter(m => COL_RE.test(m.name) || chainValue(m, root, 'collider')) : cols;
  // rays: all meshes; collision meshes and shown non-walkable meshes also occlude the camera, unless a node says userData.occluder = false (a glass roof, a thin railing).
  // col_ meshes are hidden by design and still block; any other hidden mesh is not on screen, so the arm has nothing to avoid
  const blocks = m => chainValue(m, root, 'occluder') !== false, shownHere = m => !chainHas(m, root, p => !p.visible);
  st.removers.push(e.rays.addStatic(root), e.rays.addStatic([...cols.filter(blocks), ...meshes.filter(m => !walkSet.has(m) && shownHere(m) && blocks(m))], { occluder: true }));
  st.trimeshCache = null; st.version++;
  addColliders(st);
}

/** Turn collision meshes into rotated boxes in the collision module (best-fit box by the mesh's world orientation) */
function addColliders(st) {
  const ph = st.e.collision;
  if (!ph || !st.pendingColliders) return;
  for (const b of colliderBoxes(st.pendingColliders, { colliderHeight: st.o.colliderHeight, colliderPad: st.o.colliderPad })) st.removers.push(ph.addBox(b.at, b.opts));
  st.pendingColliders = null;
}
