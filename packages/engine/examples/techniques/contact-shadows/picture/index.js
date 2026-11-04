// @ts-check
// The picture of the contact-shadows demo: wiring only.
import { TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';

/** Returns { mat, sun, hemi }. @param {any} engine @param {{ bakedAO: boolean }} o */
export function createPicture(engine, o) {
  engine.renderer.toneMapping = TONE_MAPPING;
  const lights = createLights(engine), { mat } = createMaterials(o);
  // onRender, not onFrame: onFrame runs before the sky module, so it would read last frame's signals
  engine.onRender(() => lights.update(engine.uniforms));
  return { mat, sun: lights.sun, hemi: lights.hemi };
}
