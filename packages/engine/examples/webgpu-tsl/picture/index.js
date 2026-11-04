// @ts-check
// The picture of the WebGPU + TSL demo: wiring only. Materials and post are nodes that read the engine's values themselves, so only the sky
// and the lights have per-frame work.
import { EXPOSURE, TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createSky } from './sky.js';
import { createPost } from './post.js';

/** Returns { mat, sun, hemi, scanlines }; scanlines is a uniform node, write its .value. @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = TONE_MAPPING;
  engine.renderer.toneMappingExposure = EXPOSURE;
  const lights = createLights(engine), { mat } = createMaterials(engine), sky = createSky(engine), post = createPost(engine);
  // onRender, not onFrame: onFrame runs before the sky module, so it would read last frame's signals
  engine.onRender(() => { sky.update(engine.uniforms); lights.update(engine.uniforms); });
  return { mat, sun: lights.sun, hemi: lights.hemi, scanlines: post.amount };
}
