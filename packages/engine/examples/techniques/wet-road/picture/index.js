// @ts-check
// The picture of the wet-road demo: wiring only.
import { TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createSky } from './sky.js';

/** Returns { mat, sun, hemi, level(), addLamp, addStreaks }. @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = TONE_MAPPING;
  const lights = createLights(engine), materials = createMaterials(), sky = createSky(engine);
  // onRender, not onFrame: onFrame runs before the sky module, so it would read last frame's signals
  engine.onRender(() => {
    lights.update(engine.uniforms); materials.update(lights.level()); sky.update(engine.uniforms, lights.level());
  });
  return { mat: materials.mat, sun: lights.sun, hemi: lights.hemi, level: lights.level, addLamp: lights.addLamp, addStreaks: lights.addStreaks };
}
