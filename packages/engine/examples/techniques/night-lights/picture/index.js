// @ts-check
// The picture of the night street: wiring only. Each part writes plain three.js from the signals; one onRender drives them.
import { EXPOSURE, TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createSky } from './sky.js';
import { createPost } from './post.js';

/** Needs engine.use(lightPool(...)) first. Returns { mat, addLamp, nightLights, sun, hemi }. @param {any} engine @param {{ halo: boolean, bloom: boolean, glare: boolean }} o */
export function createPicture(engine, o) {
  engine.renderer.toneMapping = TONE_MAPPING;
  engine.renderer.toneMappingExposure = EXPOSURE;
  const mat = createMaterials(), lights = createLights(engine, mat, o), sky = createSky(engine);
  if (o.bloom) createPost(engine, o);
  // onRender, not onFrame: onFrame runs before the sky module, so it would read last frame's signals
  engine.onRender(() => { sky.update(engine.uniforms); lights.update(engine.uniforms); });
  return { mat, addLamp: lights.addLamp, nightLights: lights.nightLights, sun: lights.sun, hemi: lights.hemi };
}
