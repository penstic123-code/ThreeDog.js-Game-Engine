// What counts as a lit material, and what adds light a bake already holds: one answer for patches (render/fx/patchNodes.tsl.js), lightmaps and probe sets.
// cascades.js keeps its own list: it names the materials its GLSL patch can reach, which is a different question.

/** Every material of a mesh @param {any} o @returns {any[]} */
export const mats = o => (Array.isArray(o.material) ? o.material : [o.material]);

/**
 * A material that takes light. A classic material has no `lights` flag (that is a ShaderMaterial / NodeMaterial field): the lit classic types are the ones three's node twins light.
 * @param {any} m @returns {boolean}
 */
export const lit = m => (m?.isNodeMaterial ? !!m.lights && !m.isMeshBasicNodeMaterial
  : !!(m?.isMeshLambertMaterial || m?.isMeshPhongMaterial || m?.isMeshStandardMaterial || m?.isMeshToonMaterial));

/** Is o a fill light? A lit one goes on the `doubled` list, since the bake saw it already @param {any} o @param {string[]} doubled @returns {boolean} */
export function noteFillLight(o, doubled) {
  if (!(o.isAmbientLight || o.isHemisphereLight || o.isLightProbe)) return false;
  if (o.intensity > 0) doubled.push(`${o.type} ${o.name || o.id}`);
  return true;
}

/** The scene's environment light, the same way @param {any} scene @param {string[]} doubled */
export function noteEnvironment(scene, doubled) {
  if (scene.environment && scene.environmentIntensity > 0) doubled.push('scene.environment');
}
