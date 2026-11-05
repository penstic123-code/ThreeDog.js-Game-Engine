import { mergeCommon } from '../../render/mergeCommon.js';
import { copyPatches } from '../../render/patches.js';
import { codedError } from '../../core/errorHints.js';

// Multi-material model (bark trunk + alpha-cut leaf cards) -> one geometry with a group per mesh + a material array, so a species stays
// one InstancedMesh: instance matrices, felling and LOD swaps work unchanged for every part. Only attributes all meshes share are kept.
/** @internal */
export function fromModel(root, label) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), geos = [], mats = [];
  root.traverse(n => {
    if (!n.isMesh) return;
    if (Array.isArray(n.material)) throw codedError('vegetation-option', `${label}: model mesh '${n.name}' has several materials; split it into one mesh per material`);
    geos.push(n.geometry.clone().applyMatrix4(n.matrixWorld.clone().premultiply(inv)));
    mats.push(copyPatches(n.material, n.material.clone()));   // the clone keeps the model material's own shader patches
  });
  if (!geos.length) throw codedError('vegetation-option', `${label}: model has no meshes`);
  return { geometry: mergeCommon(geos, true), materials: mats };
}
