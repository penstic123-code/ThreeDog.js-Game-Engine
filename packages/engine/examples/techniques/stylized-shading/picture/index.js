// @ts-check
// The picture of the shading demo: wiring only. Nothing here moves, so there is no onRender; a picture with signals would call each part from one.
import { THREE } from 'threedog';
import { COLORS, FOG, PARTS, TONE_MAPPING } from './palette.js';
import { createLights } from './lights.js';
import { createMaterials } from './materials.js';

/** Returns { routes, ground, parts, sun, hemi } @param {any} engine */
export function createPicture(engine) {
  engine.renderer.toneMapping = TONE_MAPPING;
  engine.scene.background = new THREE.Color(COLORS.sky);
  engine.scene.fog = new THREE.Fog(COLORS.sky, FOG.near, FOG.far);   // every route keeps three's fog chunk
  return { ...createLights(engine), ...createMaterials(), parts: Object.keys(PARTS) };
}
