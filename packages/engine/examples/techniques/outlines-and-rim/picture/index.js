// @ts-check
// The picture of the outlines demo: wiring only. Nothing here moves, so there is no onRender; a picture with signals would call each part from one.
import { THREE } from 'threedog';
import { COLORS, FOG, HULL, TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';
import { createPost } from './post.js';

/** Returns { mat, hull, offLayer, sun, hemi } @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = TONE_MAPPING;
  engine.scene.background = new THREE.Color(COLORS.sky);
  engine.scene.fog = new THREE.Fog(COLORS.sky, FOG.near, FOG.far);
  const { sun, hemi } = createLights(engine), { offLayer } = createPost(engine);
  return { mat: createMaterials(), hull: HULL, offLayer, sun, hemi };
}
