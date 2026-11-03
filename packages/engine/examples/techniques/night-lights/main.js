// @ts-check
// hint-off-file(material): the demo street is deliberately plain gray three.js materials, not a style
// Night-lights demo (page /night-lights.html): a neutral gray street with lamps, lit windows and two signs, the technique of nightLights.js.
// URL: ?time=HH:MM (the engine reads it) &halo=0 &bloom=0 &glare=1 (the classic mistakes all at once: decay 0, hot windows, low bloom threshold)
// Test page for tests/specs/night-lights.mjs: window.nightLightsTest = { lights, THREE, lampAt, between }.
import { createEngine, calendar, sky, fixedCamera, lightPool, presets, THREE } from '../../../index.js';
import { bloom } from '@threedog/post-effects';
import { createNightLights } from './nightLights.js';

const url = new URLSearchParams(location.search), glare = url.get('glare') === '1';
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), ui: { loading: false }, saveKey: 'threedog-night-lights' });
engine.use(calendar({ ...presets.calendar.fixedTime, time: '22:00' }), sky(), lightPool({ point: 2, spot: 8 }),
  fixedCamera({ shots: { street: { position: [3.2, 1.7, 12], lookAt: [-1, 1.2, -20] } }, start: 'street' }));
// Bloom only for what is hotter than the threshold (linear): lamp heads at 2.5 bloom, windows at 0.6 never do. A threshold under 1 makes
// every lit wall and window glow (the glare=1 case).
if (url.get('bloom') !== '0') engine.look.post.add(bloom(glare ? { threshold: 0.2, strength: 1.2, radius: 0.8 } : { threshold: 1.4, strength: 0.45, radius: 0.35 }));

// ---- the street: everything gray ----
const gray = (/** @type {number} */ c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ m, /** @type {number[]} */ [x, y, z]) => {
  const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.receiveShadow = true; mesh.castShadow = true; engine.scene.add(mesh); return mesh;
};
add(new THREE.PlaneGeometry(10, 160).rotateX(-Math.PI / 2), gray(0x5c5c60, 0.8), [0, 0, -50]);
const curb = gray(0x8a8a8c), wall = gray(0x7c7c80);
for (const x of [-6.5, 6.5]) add(new THREE.BoxGeometry(3, 0.15, 160), curb, [x, 0.075, -50]);
const winMat = (/** @type {number} */ c) => new THREE.MeshStandardMaterial({ color: 0x18181a, emissive: c, emissiveIntensity: 0, roughness: 0.3 });
const warm = winMat(0xffb36b), cool = winMat(0xc8d8ff);
for (const side of [-1, 1]) for (let z = 10, i = 0; z > -110; z -= 14, i++) {
  const h = 8 + ((i * 7 + (side > 0 ? 3 : 0)) % 5) * 2;
  add(new THREE.BoxGeometry(6, h, 12), wall, [side * 11, h / 2, z]);
  for (let fy = 2; fy < h - 1; fy += 3) for (const dz of [-3.5, 0, 3.5]) {
    const k = (i * 5 + fy * 3 + dz * 2 + side) % 7;
    if (k > 3) continue;   // about half the windows are dark: all lit reads as an office tower, not a street at night
    add(new THREE.PlaneGeometry(1.4, 1.6).rotateY(-side * Math.PI / 2), k === 0 ? cool : warm, [side * 7.99, fy, z + dz]).castShadow = false;
  }
}
// two signs on the facades: saturated colours so their brightness reads as colour instead of white
const signA = winMat(0x30e0ff), signB = winMat(0xff3a8a);
add(new THREE.BoxGeometry(0.15, 0.7, 3.2), signA, [-7.9, 4.2, -6]).castShadow = false;
add(new THREE.BoxGeometry(0.15, 2.6, 0.6), signB, [7.9, 4.5, -22]).castShadow = false;

// ---- the technique ----
const lights = createNightLights(engine, { halo: url.get('halo') !== '0', ...(glare ? { lampDecay: 0, windowEmissive: 3, headEmissive: 8 } : {}) });
lights.addGlow(warm); lights.addGlow(cool, 0.45); lights.addGlow(signA, 1.4); lights.addGlow(signB, 1.4);
const pole = gray(0x505054), lampAt = [];
for (let z = 8, i = 0; z > -110; z -= 13, i++) {
  const x = i % 2 ? 5.2 : -5.2;
  add(new THREE.CylinderGeometry(0.08, 0.1, 5.6, 8), pole, [x, 2.8, z]);
  add(new THREE.BoxGeometry(0.7, 0.12, 0.35), pole, [x * 0.9, 5.62, z]);
  const head = new THREE.MeshStandardMaterial({ color: 0x202020, emissive: 0, emissiveIntensity: 0 });
  add(new THREE.BoxGeometry(0.5, 0.06, 0.28), head, [x * 0.86, 5.53, z]).castShadow = false;   // the glowing underside only: a thin lens, not a lit box
  lights.addLamp({ x: x * 0.86, y: 5.45, z }, { head });
  lampAt.push([x * 0.86, z]);
}

// The neutral sky keeps a fair amount of ambient at night; a night scene where lamps should matter needs the ambient well under the pools.
// A game's own sky keyframes do this; here: lower the sky ambient by the same night factor the lights use (the room-map light already follows it).
let ambientMod = /** @type {{ remove(): void } | null} */ (null), lastNight = -1;
engine.onFrame(() => {
  const n = Math.round(lights.night * 20) / 20;   // a few steps: changing the multiplier is not free
  if (n === lastNight) return;
  lastNight = n;
  ambientMod?.remove();
  ambientMod = n > 0 ? engine.mod('look.lights.hemi.intensity', { owner: 'night-demo', mul: 1 - 0.5 * n }) : null;
});

// points the spec reads: the ground under the second lamp, and the ground half way to the next lamp on the same side
const between = [lampAt[1][0], (lampAt[1][1] + lampAt[3][1]) / 2];
Object.assign(window, { engine, nightLightsTest: { lights, THREE, lampAt, between } });
engine.start();
