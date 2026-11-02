// @ts-check
// Outlines and rim light: three ways to make a silhouette read against a background of the same value.
//   post outline  -> @threedog/post-effects outline() (one full-screen pass on the depth buffer; nothing here, see main.js)
//   inverted hull -> addHull(): a slightly larger back-face copy of the mesh drawn in the line color, per object
//   rim light     -> rimPatch(): an edge light added in the material's own lighting, no extra draw at all
// Copy this file into a game; it imports only three and threedog.
import * as THREE from 'three';
import { applyEffects } from 'threedog';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// one resolution uniform shared by every screen-space hull: updated once per frame by trackResolution, not per material
const resolution = { value: new THREE.Vector2(1280, 720) };
/** Keep the screen-space hulls' pixel width right after resizes @param {{ renderer: THREE.WebGLRenderer, onFrame: (fn: () => void) => any }} engine */
export function trackResolution(engine) {
  return engine.onFrame(() => engine.renderer.getDrawingBufferSize(resolution.value));
}

/**
 * Inverted-hull outline: a copy of the mesh, pushed out along its normals, drawn back faces only, in the line color. Unlit
 * (MeshBasicMaterial) but it keeps fog, so far lines fade with the scene. It costs one more draw of that mesh, nothing full-screen.
 * The hull uses smooth normals (vertices welded): a box's split face normals would push its faces apart and leave gaps at the corners.
 * @param {THREE.Mesh} mesh
 * @param {{ thickness?: number, units?: 'world' | 'screen', color?: THREE.ColorRepresentation }} [o] thickness: meters (world) or device
 *   pixels (screen). World lines get thinner with distance like a real rim of paint; screen lines stay the same width like ink.
 */
export function addHull(mesh, { thickness = 0.03, units = 'world', color = 0x1e1e24 } = {}) {
  const g = mesh.geometry.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);   // weld by position only
  const smooth = mergeVertices(g);
  smooth.computeVertexNormals();
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  const scale = mesh.getWorldScale(new THREE.Vector3()).x || 1;
  applyEffects(m, { clouds: false, patches: [units === 'world'
    // object space: divide by the mesh's scale so `thickness` stays in meters
    ? { name: 'hull', cacheKey: 'world', uniforms: { uHull: { value: thickness / scale } }, pars: 'uniform float uHull;',
      slot: 'position', glsl: 'transformed += normal * uHull;' }
    // clip space: push along the screen direction of the normal; * w undoes the perspective divide, so the width is in pixels
    : { name: 'hull', cacheKey: 'screen', uniforms: { uHullPx: { value: thickness }, uHullRes: resolution }, pars: 'uniform float uHullPx; uniform vec2 uHullRes;',
      slot: 'clipPosition', glsl: `{ vec2 dir = ( projectionMatrix * vec4( normalize( normalMatrix * normal ), 0.0 ) ).xy;
        gl_Position.xy += normalize( dir + 1e-6 ) * uHullPx * 2.0 / uHullRes * gl_Position.w; }` }] });
  const hull = new THREE.Mesh(smooth, m);
  hull.name = 'hull'; hull.castShadow = false;   // a hull casting a shadow would fatten the object's shadow
  mesh.add(hull);
  return hull;
}

/**
 * Rim light as a patch on any lit material: a fresnel edge light added to the ambient part (engine GLSL threedogRim, recipe 43; the same
 * math as the style `lighting.rim` key). `shadowSide` 1 = only on the side turned away from the sun, a back light that separates the
 * shaded side from a dark background; 0 = all round.
 * @param {{ color?: THREE.ColorRepresentation, strength?: number, power?: number, shadowSide?: number }} [o]
 */
export function rimPatch({ color = 0xdfe8ff, strength = 0.8, power = 3, shadowSide = 0.6 } = {}) {
  return {
    name: 'rim', cacheKey: 'v1',
    uniforms: { uRimC: { value: new THREE.Color(color) }, uRimK: { value: new THREE.Vector3(strength, power, shadowSide) } },
    pars: 'uniform vec3 uRimC; uniform vec3 uRimK;\n#include <threedog_lighting>',
    glsl: { lighting: `#if NUM_DIR_LIGHTS > 0
  reflectedLight.indirectDiffuse += threedogRim( normal, normalize( vViewPosition ), uRimC, uRimK.x, uRimK.y, uRimK.z, dot( normal, directionalLights[ 0 ].direction ) );
#else
  reflectedLight.indirectDiffuse += threedogRim( normal, normalize( vViewPosition ), uRimC, uRimK.x, uRimK.y, 0.0, 0.0 );
#endif` },
  };
}
