// @ts-check
// The open world's picture: wiring only. Each part writes plain three.js; one onRender drives them from the signals.
import { EXPOSURE, PARTICLES, TONE_MAPPING, UI } from './palette.js';
import { createSky } from './sky.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createPost } from './post.js';

/** Call after engine.use(...): it writes into the sky, water and particles modules. @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = TONE_MAPPING;
  engine.renderer.toneMappingExposure = EXPOSURE;
  const sky = createSky(engine), lights = createLights(engine, sky), materials = createMaterials(engine);
  createPost(engine);
  for (const [name, fx] of Object.entries(PARTICLES)) engine.particles.define(name, fx);
  for (const [k, v] of Object.entries(UI)) engine.uiRoot.style.setProperty(`--threedog-${k}`, v);
  // onRender, not onFrame: onFrame runs before the sky module, so it would read last frame's signals and be written over
  engine.onRender(() => { sky.update(engine.uniforms); lights.update(engine.uniforms); });
  return { sun: lights.sun, hemi: lights.hemi, fill: lights.fill, doorLamp: materials.doorLamp };
}
