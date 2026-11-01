// Lowpoly style pack - procedural shapes the engine asks the style pack for: the ground pickup.
// Without a style pack the engine draws a neutral placeholder (plain box) instead. Character bodies are not here: they are assets (humanoid.js).
import * as THREE from 'three';

/** Faceted glowing octahedron in the item's color (materials.pickup decides shading). */
export function pickup(item, { color, size }, engine) {
  return new THREE.Mesh(new THREE.OctahedronGeometry(size, 0),
    engine.makeMaterial('pickup', { color, emissive: color, emissiveIntensity: 0.35, flatShading: true }));
}
