// @ts-check
// Demo page for the contact-shadows technique (page /contact-shadows.html). A neutral gray yard at 14:30: a table with a small cup and a ball on
// it, a crate stack (static, code-built, vertex AO baked), a figure-sized capsule and a wall corner.
// URL: ?mode=float   the engine defaults (70 m shadow box, 4 cm normal bias, full fill): the "small object floats" failure
//      &ao=1         add the screen-space AO pass   &probes=1  bake light probes over the yard (bounce light from the wall)
// Test page for tests/specs/contact-shadows.mjs: window.contactTest = { THREE, points, cs } (points: world spots the spec reads brightness at).
import { createEngine, sky, fixedCamera, makeMaterial, THREE } from 'threedog';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyContactShadows, groundStatic } from './contactShadows.js';

const url = new URLSearchParams(location.search), float = url.get('mode') === 'float';
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), ui: { loading: false }, saveKey: 'threedog-contact' });
engine.use(sky({ time: '14:30' }));
engine.use(fixedCamera({ position: [1.9, 1.6, 2.3], lookAt: [0, 0.55, -0.1] }));

const gray = (/** @type {number} */ c, vertexColors = false) => makeMaterial('prop', { color: c, vertexColors });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), makeMaterial('terrain', { color: 0x9a9a9a }));
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
// the table: top 1.2 x 0.8 at 0.75 m, four legs. Objects sit exactly on their support (y = half height): a 1 cm gap also reads as floating
add(new THREE.BoxGeometry(1.2, 0.05, 0.8), gray(0xb0b0b0), 0, 0.725, 0);
for (const [x, z] of [[-0.55, -0.35], [0.55, -0.35], [-0.55, 0.35], [0.55, 0.35]]) add(new THREE.BoxGeometry(0.05, 0.7, 0.05), gray(0x8c8c8c), x, 0.35, z);
const cup = add(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 24), gray(0xd0d0d0), 0.2, 0.75 + 0.05, 0.1);
add(new THREE.SphereGeometry(0.07, 24, 16), gray(0xc4c4c4), -0.25, 0.75 + 0.07, -0.1);
// a small object on the ground, where floating is easiest to see
const block = add(new THREE.BoxGeometry(0.12, 0.12, 0.12), gray(0xc8c8c8), 1.1, 0.06, 0.6);
// the crate stack: one static merged geometry with baked vertex AO (darker at the floor and between crates). Tessellated boxes: AO is per vertex
const crate = (/** @type {number} */ s, /** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => new THREE.BoxGeometry(s, s, s, 6, 6, 6).translate(x, y + s / 2, z);
const stack = mergeGeometries([crate(0.6, 0, 0, 0), crate(0.6, 0.62, 0, 0.05), crate(0.45, 0.3, 0.6, 0)]);
if (!float) groundStatic(stack, { ground: 0 });
add(stack, gray(0xb4b4b4, !float), -1.6, 0, -0.6);
// a figure-sized capsule and a wall corner (the probes' bounce light shows next to the wall)
add(new THREE.CapsuleGeometry(0.25, 1.2, 8, 16), gray(0xa8a8a8), 1.4, 0.85, -1.2);
add(new THREE.BoxGeometry(5, 2.5, 0.2), gray(0xbcbcbc), 0, 1.25, -2.4);
add(new THREE.BoxGeometry(0.2, 2.5, 4), gray(0xbcbcbc), -2.6, 1.25, -0.5);

// the shadow box centers on engine.focus, which the fixed camera puts at its lookAt (the table): the middle of the compact scene
const cs = float ? null : applyContactShadows(engine, { ao: url.get('ao') === '1' });
if (url.get('probes') === '1') await engine.bakeProbes({ bounds: { min: [-3, 0.2, -2.2], max: [3, 2, 3] }, spacing: 1.5 });

// small objects (base center and half width, m) and open spots on the same surfaces; the spec reads just beside each base on the side away from the sun
const points = { cup: { at: [0.2, 0.751, 0.1], r: 0.04 }, block: { at: [1.1, 0.001, 0.6], r: 0.06 }, tableOpen: [-0.4, 0.751, 0.3], groundOpen: [-1.0, 0.001, 0.9] };
Object.assign(window, { engine, contactTest: { THREE, points, cs, cup } });
engine.start();
