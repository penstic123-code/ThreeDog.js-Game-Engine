// @ts-check
// Wet-road demo (page /wet-road.html): a neutral gray street, lamps and lit windows at night, the technique of wetRoad.js on the road.
// URL: ?time=HH:MM ?weather=rain|clear (the engine reads both) &wet=0..1 (hold wetness) &mask=1 (show the puddle mask) &streaks=0 &puddles=0
// Test page for tests/specs/wet-road.mjs: window.wetRoadTest = { wet, road, THREE, lamps, picture }. Shapes only here; the whole picture is picture/.
import { createEngine, calendar, sky, weather, fixedCamera, lightPool, presets, THREE } from 'threedog';
import { createWetRoad } from './wetRoad.js';
import { createPicture } from './picture/index.js';

const url = new URLSearchParams(location.search);
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: false }, saveKey: 'threedog-wet-road' });
engine.use(calendar({ ...presets.calendar.fixedTime, time: '21:30' }), sky(), weather({ ...presets.weather.temperate, start: 'rain' }),
  lightPool({ point: 8 }), fixedCamera({ shots: { street: { position: [1.6, 1.7, 13], lookAt: [-0.4, 0.4, -20] } }, start: 'street' }));
const picture = createPicture(engine), { mat } = picture;

// ---- the street: only the road is patched ----
const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ m, /** @type {number[]} */ [x, y, z]) => {
  const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.receiveShadow = true; mesh.castShadow = true; engine.scene.add(mesh); return mesh;
};
add(new THREE.PlaneGeometry(10, 160).rotateX(-Math.PI / 2), mat.road, [0, 0, -50]);
for (let z = 20; z > -120; z -= 6) add(new THREE.PlaneGeometry(0.15, 3).rotateX(-Math.PI / 2), mat.paint, [0, 0.005, z]);   // dashed centre line
for (const x of [-6.5, 6.5]) add(new THREE.BoxGeometry(3, 0.15, 160), mat.curb, [x, 0.075, -50]);
const windows = [];
for (const side of [-1, 1]) for (let z = 10, i = 0; z > -110; z -= 14, i++) {
  const h = 8 + ((i * 7 + (side > 0 ? 3 : 0)) % 5) * 2;
  add(new THREE.BoxGeometry(6, h, 12), mat.wall, [side * 11, h / 2, z]);
  for (let fy = 2; fy < h - 1; fy += 3) for (const dz of [-3.5, 0, 3.5]) if ((i + fy + dz) % 3 !== 0) {
    const w = add(new THREE.PlaneGeometry(1.4, 1.6).rotateY(-side * Math.PI / 2), mat.glass, [side * 7.99, fy, z + dz]);
    w.castShadow = false;
    windows.push(w);
  }
}
const lamps = [];
for (let z = 8, i = 0; z > -110; z -= 18, i++) {
  const x = i % 2 ? 5.2 : -5.2;
  add(new THREE.CylinderGeometry(0.08, 0.1, 5.6, 8), mat.pole, [x, 2.8, z]);
  add(new THREE.BoxGeometry(0.5, 0.18, 0.5), mat.head, [x * 0.86, 5.55, z]).castShadow = false;
  lamps.push(picture.addLamp(new THREE.Vector3(x * 0.86, 5.45, z)));
}

// ---- the technique ----
const wet = createWetRoad(engine, { materials: [mat.road, mat.paint], streaks: url.get('streaks') !== '0', bounds: [-5, -130, 5, 30], puddles: url.get('puddles') !== '0' });
if (url.has('wet')) wet.hold(Number(url.get('wet')));
wet.maskView = url.get('mask') === '1';
// only a few streaks per facade: one per window column is plenty
picture.addStreaks(wet, lamps.map(l => l.at), windows.filter(w => w.position.y < 3).map(w => w.position));

Object.assign(window, { engine, wetRoadTest: { wet, road: mat.road, THREE, lamps, picture } });
engine.start();
