// Default lights every engine has: a directional "sun" + hemisphere ambient, neutral white/gray so a scene without sky is never black.
// The sky module drives these same two lights (color, intensity, direction, shadows) instead of adding its own; a game that wants
// different lighting edits or hides them (engine.lights.sun.visible = false) and adds its own three.js lights.
import * as THREE from 'three';

/** @param {any} engine @returns {{ sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight }} */
export function createDefaultLights(engine) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(40, 80, 30);   // above and to the side, so faces read with some shading
  engine.scene.add(hemi, sun, sun.target);
  return { sun, hemi };
}
