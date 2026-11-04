// @ts-check
// Demo page for the day-night-grade technique (page /day-night-grade.html). A neutral gray street corner: three houses with a lit window each,
// two lamp posts with a point light, a figure-sized capsule. The day runs in 4 minutes; ?time=17:30 (the engine reads it) starts at a time.
// Test page for tests/specs/day-night-grade.mjs: window.dayNightTest = { THREE, picture }. Shapes only here; the whole picture is picture/.
import { createEngine, calendar, sky, fixedCamera, THREE } from 'threedog';
import { createPicture } from './picture/index.js';

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false,
  ui: { loading: false }, saveKey: 'threedog-day-night' });
engine.use(calendar({ time: '12:00', dayLength: 240 }));
engine.use(sky());
engine.use(fixedCamera({ position: [9, 4.2, 11], lookAt: [0, 1.2, 0] }));
const picture = createPicture(engine), { mat } = picture;

const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat.ground);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
engine.scene.add(ground);
const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ m, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  engine.scene.add(mesh);
  return mesh;
};
for (const [x, z, w] of [[-5, -4, 4], [1, -6, 5], [6, -2, 3.5]]) {
  add(new THREE.BoxGeometry(w, 3, 4), mat.wall, x, 1.5, z);
  add(new THREE.ConeGeometry(w * 0.8, 1.4, 4).rotateY(Math.PI / 4), mat.roof, x, 3.7, z);
  add(new THREE.BoxGeometry(0.9, 0.8, 0.05), mat.glass, x, 1.6, z + 2.01);
}
// lamp posts: an emissive head (what you see) plus a point light (what it lights); both follow the night together
for (const [x, z] of [[-1.5, 1.5], [4.5, 2.5]]) {
  add(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 10), mat.roof, x, 1.6, z);
  add(new THREE.SphereGeometry(0.18, 16, 12), mat.head, x, 3.3, z).castShadow = false;
  picture.addLamp(x, 3.1, z);
}
add(new THREE.CapsuleGeometry(0.28, 1.1, 8, 16), mat.figure, 1.5, 0.83, 2.2);
add(new THREE.BoxGeometry(0.8, 0.8, 0.8), mat.crate, -3, 0.4, 2.5);

Object.assign(window, { engine, dayNightTest: { THREE, picture } });
engine.start();
