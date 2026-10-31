import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { copyPatches } from '../../render/patches.js';

// Multi-material model (bark trunk + alpha-cut leaf cards) -> one geometry with a group per mesh + a material array, so a species stays
// one InstancedMesh: instance matrices, felling and LOD swaps work unchanged for every part. Only attributes all meshes share are kept.
/** @internal */
export function fromModel(root, label) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), geos = [], mats = [];
  root.traverse(n => {
    if (!n.isMesh) return;
    if (Array.isArray(n.material)) throw new Error(`${label}: model mesh '${n.name}' has several materials; split it into one mesh per material`);
    geos.push(n.geometry.clone().applyMatrix4(n.matrixWorld.clone().premultiply(inv)));
    mats.push(copyPatches(n.material, n.material.clone()));   // the clone keeps the model material's own shader patches
  });
  if (!geos.length) throw new Error(`${label}: model has no meshes`);
  const names = Object.keys(geos[0].attributes).filter(k => geos.every(g => g.attributes[k]));
  const indexed = geos.every(g => g.index);
  const ready = geos.map(g => { const h = indexed ? g : g.toNonIndexed(); for (const k in h.attributes) if (!names.includes(k)) h.deleteAttribute(k); return h; });
  return { geometry: mergeGeometries(ready, true), materials: mats };
}
