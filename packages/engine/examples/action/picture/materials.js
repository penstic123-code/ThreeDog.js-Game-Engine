// @ts-check
// Materials by name. Module level, because models.js is an asset generator that `npm run check` imports with no engine. Faceted Lambert: in a small
// room the facets on the slime and the pillars are most of what says "form".
import { THREE } from '../../../index.js';
import { COLORS } from './palette.js';

const facets = (/** @type {number} */ color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
export const mat = { floor: facets(COLORS.floor), wall: facets(COLORS.wall), pillar: facets(COLORS.pillar), enemy: facets(COLORS.enemy), eye: facets(COLORS.eye) };
