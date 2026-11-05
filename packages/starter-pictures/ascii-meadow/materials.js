// @ts-check
// Materials by name: other code asks for picture.materials.<name> and never builds its own, so a surface changes in this one place.
// `prop` reads vertex colors: every tree, rock and reed carries its own colors, so a whole forest is one material and one draw (props.js says why).
import { attribute, float, positionWorld } from 'three/tsl';
import { drift, softMaterial } from './paint.js';
import { palette } from './palette.js';

export function createMaterials() {
  const { size, amount } = palette.leafGrain;
  const grain = float(1).add(drift(positionWorld, size).mul(amount * 2));
  return { prop: softMaterial(attribute('color', 'vec3').mul(grain)) };
}
