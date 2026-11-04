// @ts-check
// The picture of the day-night demo: wiring only. Each part writes plain three.js from the signals; one onRender drives them all.
import { TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createSky } from './sky.js';
import { createPost } from './post.js';

/** Returns { mat, addLamp, level(), grade(), remove() }; remove() stops the cycle and takes the grade out of the post chain. @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = TONE_MAPPING;
  const lights = createLights(engine), materials = createMaterials(), sky = createSky(engine), post = createPost(engine);
  let on = true;
  // onRender, not onFrame: onFrame runs before the sky module, so it would read last frame's signals
  engine.onRender(() => {
    if (!on) return;
    sky.update(engine.uniforms); lights.update(engine.uniforms); materials.update(lights.level()); post.update(engine.uniforms);
  });
  return { mat: materials.mat, addLamp: lights.addLamp, sun: lights.sun, hemi: lights.hemi, level: lights.level, grade: post.grade, remove() { on = false; post.remove(); } };
}
