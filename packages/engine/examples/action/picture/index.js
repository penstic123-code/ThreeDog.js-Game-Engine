// @ts-check
// The action room's picture: wiring only. No sky.js: the engine's dome is what shows beyond the walls, and fog has nothing to cover in a 16 m room.
import { TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';

/** @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = TONE_MAPPING;
  const lights = createLights(engine);
  // onRender, not onFrame: onFrame runs before the sky module, so it would read last frame's signals
  engine.onRender(() => lights.update(engine.uniforms));
  return { sun: lights.sun, hemi: lights.hemi };
}
