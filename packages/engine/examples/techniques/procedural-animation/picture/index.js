// @ts-check
// The picture of the procedural-animation demo: wiring only.
import { TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createSky } from './sky.js';

/** Returns { mat }. @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = TONE_MAPPING;
  const lights = createLights(engine), sky = createSky(engine), { mat } = createMaterials();
  // onRender, not onFrame: onFrame runs before the sky module, so it would read last frame's signals
  engine.onRender(() => { lights.update(engine.uniforms); sky.update(engine.uniforms); });
  return { mat };
}
