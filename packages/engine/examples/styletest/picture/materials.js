// @ts-check
// The exhibits' materials by name. One surface kind each: wood and plaster are matte Lambert, stone is faceted, metal needs a PBR model, glass needs a highlight.
// Module level for the same reason as the world picture's: the model builders are asset generators `npm run check` imports with no engine.
import { THREE, applyEffects } from '../../../index.js';
import { mat as worldMat } from '../../world/picture/materials.js';
import { COLORS, GLASS, METAL } from './palette.js';

const lambert = (/** @type {THREE.MeshLambertMaterialParameters} */ p) => new THREE.MeshLambertMaterial(p);
const matte = (/** @type {number} */ color) => lambert({ color });
const facets = (/** @type {number} */ color) => lambert({ color, flatShading: true });
// depthWrite off: the panes stand one behind the other, and that sorting is part of what the exhibit shows
const glass = (/** @type {number} */ color, /** @type {number} */ opacity) => new THREE.MeshPhongMaterial({ color, shininess: GLASS.shininess, transparent: true, opacity, depthWrite: false });

const own = {
  crate: matte(COLORS.crate), crateBand: matte(COLORS.crateBand), tableLeg: matte(COLORS.tableLeg), bedFrame: matte(COLORS.bedFrame),
  stone: facets(COLORS.stone), plinth: facets(COLORS.plinth),
  metal: new THREE.MeshStandardMaterial({ color: COLORS.metal, ...METAL }),
  block: matte(COLORS.block), slab: matte(COLORS.slab), plaster: matte(COLORS.plaster), linen: matte(COLORS.linen),
  shell: lambert({ vertexColors: true }),
  pane: glass(COLORS.glassBlue, GLASS.paneOpacity), paneAmber: glass(COLORS.glassAmber, GLASS.paneOpacity), window: glass(COLORS.glassBlue, GLASS.windowOpacity),
};
export const mat = { ...own, lamp: worldMat.doorLamp };

/** @param {any} engine */
export function createMaterials(engine) {
  // the cloud shadows fall on the exhibits too; the lamp is the world picture's and already has them
  for (const m of Object.values(own)) applyEffects(m, { engine });
}
