// @ts-check
// Comic: two bands, a heavy line on silhouettes and creases, then the finished picture snapped to three inks. Grays only in the materials: the ink decides the tones.
import { THREE, rampTexture } from 'threedog';
import { MeshToonNodeMaterial } from 'three/webgpu';
import { celLighting } from 'threedog/tsl';
import { outline, lut, paletteLut } from '@threedog/post-effects';
import { addSun, swaying } from './sun.js';

const GRAYS = { wall: 0xf0f0f0, roof: 0x707070, door: 0x303030, trunk: 0x505050, leaves: 0xa8a8a8, body: 0xc8c8c8, head: 0xf0f0f0, ball: 0x808080, rock: 0xb0b0b0, ground: 0xe8e8e8 };
const INKS = [0x0c0c10, 0x8e8e92, 0xf6f3ea];   // black, one screen tone, paper
const RAMP = [0.18, 1];

/** @param {any} engine */
export function comic(engine) {
  engine.renderer.toneMapping = THREE.NoToneMapping;
  engine.scene.background = new THREE.Color(INKS[2]);
  engine.scene.add(new THREE.AmbientLight(0xffffff, 0.15));
  addSun(engine, { color: 0xffffff, intensity: 3.4, at: [-8, 14, 6], radius: 1 });
  const ramp = rampTexture(RAMP);
  const cel = color => { const m = new MeshToonNodeMaterial({ color, gradientMap: ramp }); m.setupLightingModel = celLighting; return m; };
  const materials = Object.fromEntries(Object.entries(GRAYS).map(([k, c]) => [k, cel(c)]));
  swaying(materials.leaves, 0.03);
  engine.post.add(outline({ color: 0x000000, thickness: 2, strength: 1, mode: 'both', fadeWithDistance: false }));
  // reads the picture after the output encoding (ldr), so the inks are the display colors written above
  engine.post.add(lut({ lut: paletteLut(INKS), saturation: 0 }));
  return { materials };
}
