// @ts-check
// Cartoon: flat colored bands from one shared ramp, a cool shade under a white sun, no tone curve (the colors written here are the colors drawn), no post at all.
import { THREE, rampTexture } from 'threedog';
import { MeshToonNodeMaterial } from 'three/webgpu';
import { celLighting } from 'threedog/tsl';
import { addSun, swaying } from './sun.js';

const COLORS = { wall: 0xfff0d0, roof: 0xe8503a, door: 0x3f7fd0, trunk: 0x9a6236, leaves: 0x54c24e, body: 0xf2b632, head: 0xffd9b0, ball: 0xee3f88, rock: 0xb8bcc8, ground: 0x96dc6a };
const SKY = 0x8fd8ff;
const RAMP = [0x8a90e0, 0xd8dcff, 0xffffff];   // light of each band, dark to light: every material shares it, so all shade leans the same way

/** @param {any} engine */
export function cartoon(engine) {
  engine.renderer.toneMapping = THREE.NoToneMapping;
  engine.scene.background = new THREE.Color(SKY);
  engine.scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  addSun(engine, { color: 0xffffff, intensity: 2.6, at: [9, 16, 7], radius: 1 });
  const ramp = rampTexture(RAMP);
  const cel = color => { const m = new MeshToonNodeMaterial({ color, gradientMap: ramp }); m.setupLightingModel = celLighting; return m; };
  const materials = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, cel(c)]));
  swaying(materials.leaves, 0.03);
  return { materials };
}
