// The ground pickup shape, registered as the asset model name 'pickup' (assets in art/index.js).
// It is an asset like the trees, not a style factory: pickups find it by name (item model -> 'pickup:<item>' -> 'pickup'), and it returns bare
// geometry so every item gets its own color in the style's 'pickup' material role (the style's materials.pickup decides the shading).
import * as THREE from 'three';

/** Faceted octahedron, 0.25 m: a gem / token shape any item can wear. */
export function pickup() {
  return new THREE.OctahedronGeometry(0.25, 0);
}
