// @ts-check
// Materials by name. They live at module level, not inside createPicture, because the model builders (models.js, art/) are asset generators that `npm run check`
// imports with no engine. Lambert throughout: this low-poly world is lit by color and shape, nothing here needs a specular model.
import { THREE, applyEffects } from '../../../index.js';
import { COLORS, DOOR_LAMP } from './palette.js';

const lambert = (/** @type {THREE.MeshLambertMaterialParameters} */ p) => new THREE.MeshLambertMaterial(p);
const facets = (/** @type {number} */ color) => lambert({ color, flatShading: true });

export const mat = {
  building: lambert({ vertexColors: true }),
  crate: lambert({ vertexColors: true }),
  ball: facets(COLORS.ball), barrel: facets(COLORS.barrel),
  doorLamp: lambert({ color: COLORS.lampBody, emissive: COLORS.lampGlow, emissiveIntensity: 0 }),
  cloth: facets(COLORS.cloth), skin: facets(COLORS.skin), trousers: facets(COLORS.trousers), hair: facets(COLORS.hair),
};

const pickups = new Map();
/** The ground pickup in one item's color, one material per color: faceted with a faint glow, so a small thing still catches the eye in the grass @param {number} color */
export function pickupMaterial(color) {
  if (!pickups.has(color)) pickups.set(color, applyEffects(lambert({ color, flatShading: true, emissive: COLORS.pickupGlow })));
  return pickups.get(color);
}

/** @param {any} engine */
export function createMaterials(engine) {
  // the cloud shadows fall on the cabin, the crates and the people too, not only on the ground and the plants
  for (const m of Object.values(mat)) applyEffects(m, { engine });
  engine.water.material.color.set(COLORS.water);
  return {
    /** The clock in main.js switches the lamp @param {boolean} on */
    doorLamp(on) { mat.doorLamp.emissiveIntensity = on ? DOOR_LAMP : 0; },
  };
}
