// Default lights every engine has (engine.lights, the mechanism): a directional "sun" + hemisphere ambient, plain white / neutral gray, no
// shadows. They exist only so a scene (and the gray placeholders) is never black; they are not a tuned look: sun color and intensity curves,
// sky colors, fog, shadows and exposure come from the style pack through the sky module, which drives these same two lights instead of
// adding its own. A game that wants different lighting edits or hides them (engine.lights.sun.visible = false) and adds its own three.js lights,
// before engine.start(): a light count that changes during play recompiles shaders (recipes/09 "Lights and stalls", lightPool() for many lights).
import * as THREE from 'three';

/** @param {any} engine @returns {{ sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight }} */
export function createDefaultLights(engine, { add = true } = {}) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(40, 80, 30);   // above and to the side, so faces read with some shading
  sun.castShadow = false;         // placeholder lighting casts no shadows; an installed sky module turns them on (sizes from style.sky.shadow)
  // add: false (createEngine({ lights: false })): the objects still exist so engine.lights.sun / hemi and the sky module never hit undefined, but they
  // are not in the scene, so nothing is lit by them and they cost no shader light slots; the game brings all its own lights
  if (add) engine.scene.add(hemi, sun, sun.target);
  return { sun, hemi };
}
