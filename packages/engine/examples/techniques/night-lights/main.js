// @ts-check
// Night-lights demo (page /night-lights.html): a neutral gray street with lamps, lit windows and two signs, the technique of nightLights.js.
// URL: ?time=HH:MM (the engine reads it) &halo=0 &bloom=0 &glare=1 (the classic mistakes all at once: decay 0, hot windows, low bloom threshold)
// Test page for tests/specs/night-lights.mjs: window.nightLightsTest = { lights, picture, THREE, lampAt, between }. Shapes only here; the whole picture is picture/.
import { createEngine, calendar, sky, fixedCamera, lightPool, presets, THREE } from 'threedog';
import { createPicture } from './picture/index.js';

const url = new URLSearchParams(location.search);
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: false }, saveKey: 'threedog-night-lights' });
engine.use(calendar({ ...presets.calendar.fixedTime, time: '22:00' }), sky(), lightPool({ point: 2, spot: 8 }),
  fixedCamera({ shots: { street: { position: [3.2, 1.7, 12], lookAt: [-1, 1.2, -20] } }, start: 'street' }));
const picture = createPicture(engine, { halo: url.get('halo') !== '0', bloom: url.get('bloom') !== '0', glare: url.get('glare') === '1' }), { mat } = picture;

// ---- the street ----
const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ m, /** @type {number[]} */ [x, y, z]) => {
  const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.receiveShadow = true; mesh.castShadow = true; engine.scene.add(mesh); return mesh;
};
add(new THREE.PlaneGeometry(10, 160).rotateX(-Math.PI / 2), mat.road, [0, 0, -50]);
for (const x of [-6.5, 6.5]) add(new THREE.BoxGeometry(3, 0.15, 160), mat.curb, [x, 0.075, -50]);
for (const side of [-1, 1]) for (let z = 10, i = 0; z > -110; z -= 14, i++) {
  const h = 8 + ((i * 7 + (side > 0 ? 3 : 0)) % 5) * 2;
  add(new THREE.BoxGeometry(6, h, 12), mat.wall, [side * 11, h / 2, z]);
  for (let fy = 2; fy < h - 1; fy += 3) for (const dz of [-3.5, 0, 3.5]) {
    const k = (i * 5 + fy * 3 + dz * 2 + side) % 7;
    if (k > 3) continue;   // about half the windows are dark: all lit reads as an office tower, not a street at night
    add(new THREE.PlaneGeometry(1.4, 1.6).rotateY(-side * Math.PI / 2), k === 0 ? mat.windowCool : mat.windowWarm, [side * 7.99, fy, z + dz]).castShadow = false;
  }
}
// two signs on the facades: saturated colours so their brightness reads as colour instead of white
add(new THREE.BoxGeometry(0.15, 0.7, 3.2), mat.signCyan, [-7.9, 4.2, -6]).castShadow = false;
add(new THREE.BoxGeometry(0.15, 2.6, 0.6), mat.signPink, [7.9, 4.5, -22]).castShadow = false;

// ---- the lamps ----
const lampAt = [];
for (let z = 8, i = 0; z > -110; z -= 13, i++) {
  const x = i % 2 ? 5.2 : -5.2;
  add(new THREE.CylinderGeometry(0.08, 0.1, 5.6, 8), mat.pole, [x, 2.8, z]);
  add(new THREE.BoxGeometry(0.7, 0.12, 0.35), mat.pole, [x * 0.9, 5.62, z]);
  add(new THREE.BoxGeometry(0.5, 0.06, 0.28), mat.head, [x * 0.86, 5.53, z]).castShadow = false;   // the glowing underside only: a thin lens, not a lit box
  picture.addLamp({ x: x * 0.86, y: 5.45, z });
  lampAt.push([x * 0.86, z]);
}

// points the spec reads: the ground under the second lamp, and the ground half way to the next lamp on the same side
const between = [lampAt[1][0], (lampAt[1][1] + lampAt[3][1]) / 2];
Object.assign(window, { engine, nightLightsTest: { lights: picture.nightLights, picture, THREE, lampAt, between } });
engine.start();
