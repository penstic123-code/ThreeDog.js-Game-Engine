// Sorting a level's nodes by their names and custom properties (the naming conventions: the top of index.js). Reads the scene, builds nothing; the only write is
// hiding what the conventions hide.
import * as THREE from 'three';
import { MARKER_RE } from './nodes.js';

const WALK_RE = /ground|floor|road|terrain|stairs?|ramp/i;
export const COL_RE = /^col_/i;

// a name or userData on the node itself or any ancestor counts (in glTF meshes often hang under a same-named empty)
export function chainHas(o, root, test) {
  for (let p = o; p; p = p.parent) { if (test(p)) return true; if (p === root) break; }
  return false;
}
export function chainValue(o, root, key) {
  for (let p = o; p; p = p.parent) { if (p.userData?.[key] != null) return p.userData[key]; if (p === root) break; }
  return undefined;
}

/**
 * Sort the nodes under root
 * @param {any} root
 * @param {{ walkable: any, colliders: any, hideMarkers: boolean }} o the level options
 * @returns {{ meshes: any[], cols: any[], markerObjs: any[], walk: any[], walkSet: Set<any> }} meshes: every plain mesh; cols: the collision meshes; walk: the walkable ones
 */
export function sortNodes(root, { walkable, colliders, hideMarkers }) {
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
  const walkSet = new Set(walk);
  for (const m of meshes) {
    if (walkSet.has(m)) continue;
    if (chainValue(m, root, 'collider')) cols.push(m);
    else if (colliders === 'auto') { const b = new THREE.Box3().setFromObject(m); if (b.max.y - b.min.y > 0.5) cols.push(m); }
  }
  return { meshes, cols, markerObjs, walk, walkSet };
}

/** The ground type of a mesh's material slot: custom property groundType, else the material name */
export const groundTypeOf = root => (m, mi) => {
  const t = chainValue(m, root, 'groundType'); if (t != null) return String(t);
  const mat = Array.isArray(m.material) ? m.material[mi] : m.material;
  return mat?.name || 'default';
};

/** engine.level.markers from the marker nodes */
export function readMarkers(markerObjs, hideMarkers) {
  const markers = {};
  for (const o of markerObjs) {
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    o.matrixWorld.decompose(position, quaternion, scale);
    markers[o.name] = { name: o.name, position, quaternion, scale, userData: { ...o.userData }, object: o };
    if (hideMarkers && o.isMesh) o.visible = false;
  }
  return markers;
}
