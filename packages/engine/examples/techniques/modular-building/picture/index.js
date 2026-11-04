// @ts-check
// The picture of the modular-building demo: wiring only.
import { THREE } from 'threedog';
import { BACKGROUND, EXPOSURE, TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';

/** Returns { mat, sun, hemi }. @param {any} engine @param {{ set: string }} o */
export function createPicture(engine, o) {
  engine.renderer.toneMapping = TONE_MAPPING;
  engine.renderer.toneMappingExposure = EXPOSURE;
  engine.scene.background = new THREE.Color(BACKGROUND);
  const lights = createLights(engine), { mat } = createMaterials(o.set);
  // onRender, not onFrame: engine.focus is this frame's only after the camera module ran
  engine.onRender(() => lights.update());
  return { mat, sun: lights.sun, hemi: lights.hemi };
}
