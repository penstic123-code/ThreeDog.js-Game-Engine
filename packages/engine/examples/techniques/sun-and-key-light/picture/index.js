// @ts-check
// The picture of the sun-and-key-light demo: wiring only. A route is fixed, so nothing here runs per frame.
import { TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createSky } from './sky.js';

/** Returns { mat, sun, hemi, sunDir, ratio }. @param {any} engine @param {Parameters<typeof createLights>[1]} o */
export function createPicture(engine, o) {
  engine.renderer.toneMapping = TONE_MAPPING;
  createSky(engine, o.route.backdrop);
  return { ...createMaterials(), ...createLights(engine, o) };
}
