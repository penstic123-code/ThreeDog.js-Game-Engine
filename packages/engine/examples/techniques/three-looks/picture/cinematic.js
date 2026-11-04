// @ts-check
// Cinematic low-poly: faceted physical materials, a low warm sun against a cool fill, fog, a film tone curve, then a warm grade and grain on the finished picture.
import { THREE } from 'threedog';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { bloom, lut, vignette, grain } from '@threedog/post-effects';
import { addSun, swaying } from './sun.js';

const COLORS = { wall: 0xb8a890, roof: 0x7a4a3a, door: 0x3a4a58, trunk: 0x4a3a30, leaves: 0x5a7a50, body: 0x8a6a58, head: 0xc8a890, ball: 0x905a50, rock: 0x777a80, ground: 0x6a6a50 };
const HAZE = 0xc8a890;

/** @param {any} engine */
export function cinematic(engine) {
  engine.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  engine.renderer.toneMappingExposure = 0.9;
  engine.scene.background = new THREE.Color(HAZE);
  engine.scene.fog = new THREE.Fog(HAZE, 10, 44);
  engine.scene.add(new THREE.HemisphereLight(0x8aa0d0, 0x403830, 1.1));
  addSun(engine, { color: 0xffc890, intensity: 4.2, at: [-14, 6, 8], radius: 6 });
  const facet = color => new MeshStandardNodeMaterial({ color, roughness: 0.85, flatShading: true });
  const materials = Object.fromEntries(Object.entries(COLORS).map(([k, c]) => [k, facet(c)]));
  swaying(materials.leaves, 0.03);
  engine.post.add(bloom({ strength: 0.25 }));   // hdr: before the tone curve, where bright stays bright
  engine.post.add(lut({ temperature: 0.3, saturation: 0.9, contrast: 1.08 }));   // ldr: after it, on display colors; the curve is not applied again
  engine.post.add(vignette({ strength: 0.3 }));
  engine.post.add(grain({ amount: 0.03 }));
  return { materials };
}
