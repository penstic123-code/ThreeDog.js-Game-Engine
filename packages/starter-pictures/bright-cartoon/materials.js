// @ts-check
// Materials by name: other code asks for picture.materials.<name> and never builds its own, so a surface changes in this one place.
// Each is two colors from palette.surface. A new surface is one row in the palette and it appears here by itself.
import { color, uniform } from 'three/tsl';
import { celMaterial, patches } from './paint.js';
import { palette } from './palette.js';

export function createMaterials() {
  /** @type {Record<string, any>} */
  const materials = {};
  for (const [name, s] of Object.entries(palette.surface)) materials[name] = celMaterial(patches(s));
  // the one thing that gives light: its strength is a uniform, so glow.value moves it with no rebuild
  const glow = uniform(palette.glow.day);
  materials.glow = celMaterial(color(palette.glow.color));
  materials.glow.emissiveNode = color(palette.glow.color).mul(glow);
  return { materials, glow };
}
