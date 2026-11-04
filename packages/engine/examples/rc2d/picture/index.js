// @ts-check
// The picture of the rc2d demo: wiring only.
import { EXPOSURE, LIGHT_LAYER, TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createPost } from './post.js';

/** Returns { mat, layer, rc, remove() }; remove() takes the pass out of the chain and frees the cascades. @param {any} engine @param {Parameters<typeof createPost>[1]} o */
export function createPicture(engine, o) {
  engine.renderer.toneMapping = TONE_MAPPING;
  engine.renderer.toneMappingExposure = EXPOSURE;
  createLights(engine);
  const materials = createMaterials();
  // hooked before createPost: the hooks run in order and the cascades' own one must read this frame's flicker
  engine.onRender(() => materials.update(engine.clock.now));
  const post = createPost(engine, o);
  return { mat: materials.mat, layer: LIGHT_LAYER, rc: post.rc, remove: post.remove };
}
