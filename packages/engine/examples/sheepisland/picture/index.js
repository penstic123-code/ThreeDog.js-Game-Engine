// @ts-check
// The picture of sheep island: wiring only. Each part writes plain three.js from the signals; one onRender drives them all.
import { EXPOSURE, TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createSky } from './sky.js';

/** @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = TONE_MAPPING;
  engine.renderer.toneMappingExposure = EXPOSURE;
  const lights = createLights(engine), materials = createMaterials(engine), sky = createSky(engine);
  // onRender, not onFrame: onFrame runs before the sky module, so it would read last frame's signals
  engine.onRender(() => {
    sky.update(engine.uniforms);
    lights.update(engine.uniforms);
    materials.update();
  });
  return { sun: lights.sun, hemi: lights.hemi };
}
