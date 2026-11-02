// @ts-check
// hint-off-file(material): the demo street is deliberately plain gray three.js materials, not a style
// Wet-road demo (page /wet-road.html): a neutral gray street, lamps and lit windows at night, the technique of wetRoad.js on the road.
// URL: ?time=HH:MM ?weather=rain|clear (the engine reads both) &wet=0..1 (hold wetness) &mask=1 (show the puddle mask) &streaks=0 &puddles=0
// Test page for tests/specs/wet-road.mjs: window.wetRoadTest = { wet, road, THREE, lamps }.
import { createEngine, calendar, sky, weather, fixedCamera, lightPool, presets, THREE } from '../../../index.js';
import { createWetRoad } from './wetRoad.js';

const url = new URLSearchParams(location.search);
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), ui: { loading: false }, saveKey: 'threedog-wet-road' });
engine.use(calendar({ ...presets.calendar.fixedTime, time: '21:30' }), sky(), weather({ ...presets.weather.temperate, start: 'rain' }),
  lightPool({ point: 8 }), fixedCamera({ shots: { street: { position: [1.6, 1.7, 13], lookAt: [-0.4, 0.4, -20] } }, start: 'street' }));
engine.look.env.replace('sky');   // something to reflect by day; at night the sky is dark and the streaks carry the reflections

// ---- the street: everything gray; only the road is patched ----
const gray = (/** @type {number} */ c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
const road = gray(0x606064, 0.85), paint = gray(0xb8b8b4, 0.7);
const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ m, /** @type {number[]} */ [x, y, z]) => {
  const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); mesh.receiveShadow = true; mesh.castShadow = true; engine.scene.add(mesh); return mesh;
};
add(new THREE.PlaneGeometry(10, 160).rotateX(-Math.PI / 2), road, [0, 0, -50]);
for (let z = 20; z > -120; z -= 6) add(new THREE.PlaneGeometry(0.15, 3).rotateX(-Math.PI / 2), paint, [0, 0.005, z]);   // dashed centre line
const curb = gray(0x8a8a8c);
for (const x of [-6.5, 6.5]) add(new THREE.BoxGeometry(3, 0.15, 160), curb, [x, 0.075, -50]);
const wall = gray(0x7c7c80), win = new THREE.MeshStandardMaterial({ color: 0x202024, emissive: 0xffd9a0, emissiveIntensity: 0 });
const windows = [];
for (const side of [-1, 1]) for (let z = 10, i = 0; z > -110; z -= 14, i++) {
  const h = 8 + ((i * 7 + (side > 0 ? 3 : 0)) % 5) * 2;
  add(new THREE.BoxGeometry(6, h, 12), wall, [side * 11, h / 2, z]);
  for (let fy = 2; fy < h - 1; fy += 3) for (const dz of [-3.5, 0, 3.5]) if ((i + fy + dz) % 3 !== 0) {
    const w = add(new THREE.PlaneGeometry(1.4, 1.6).rotateY(-side * Math.PI / 2), win, [side * 7.99, fy, z + dz]);
    w.castShadow = false;
    windows.push(w);
  }
}
const pole = gray(0x505054), headMat = new THREE.MeshStandardMaterial({ color: 0x303030, emissive: 0xffc890, emissiveIntensity: 0 });
const lamps = [];
for (let z = 8, i = 0; z > -110; z -= 18, i++) {
  const x = i % 2 ? 5.2 : -5.2;
  add(new THREE.CylinderGeometry(0.08, 0.1, 5.6, 8), pole, [x, 2.8, z]);
  add(new THREE.BoxGeometry(0.5, 0.18, 0.5), headMat, [x * 0.86, 5.55, z]).castShadow = false;
  const at = new THREE.Vector3(x * 0.86, 5.45, z);
  lamps.push({ at, light: engine.lightPool.add(at, { color: 0xffc890, intensity: 0, distance: 20 }) });
}

// ---- the technique ----
const wet = createWetRoad(engine, { materials: [road, paint], streaks: url.get('streaks') !== '0', bounds: [-5, -130, 5, 30], puddles: url.get('puddles') !== '0' });
if (url.has('wet')) wet.hold(Number(url.get('wet')));
wet.maskView = url.get('mask') === '1';
// streaks: lamps reflect warm and strong, the windows facing the street weaker (only a few per facade: one streak per window column is plenty)
const lampStreaks = lamps.map(l => wet.addStreak(l.at, { color: 0xffc890, intensity: 0 }));
const winStreaks = windows.filter(w => w.position.y < 3).map(w => wet.addStreak(w.position, { color: 0xffd9a0, intensity: 0 }));

engine.look.materials.glow(headMat, { night: 3 }); engine.look.materials.glow(win, { night: 0.8 });   // emissive follows daylight
// lamps and windows on at night (the night-lights technique does this properly; here only enough to have something to reflect)
let lastEnv = -1;
engine.onFrame(() => {
  const night = 1 - THREE.MathUtils.smoothstep(engine.calendar.daylight, 0, 0.3);
  // the neutral sky stays a mid gray at night; dim its light so the lamps matter (a real game's sky keyframes do this)
  const env = +(0.1 + 0.9 * (1 - night)).toFixed(2);
  if (env !== lastEnv) { lastEnv = env; engine.look.env.set({ intensity: env }); }
  for (const l of lamps) l.light.set({ intensity: 80 * night });
  for (const s of lampStreaks) s.set({ intensity: 1.6 * night });
  for (const s of winStreaks) s.set({ intensity: 0.35 * night });
});

Object.assign(window, { engine, wetRoadTest: { wet, road, THREE, lamps } });
engine.start();
