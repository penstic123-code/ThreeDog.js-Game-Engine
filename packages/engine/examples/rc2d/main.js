// @ts-check
// 2D radiance cascades demo (page /rc2d.html): a top-down street at night. Street lamps, lit windows and a neon bar are emissive meshes; building
// blocks and a wall are occluders. Both are on layer 5, which is all rc2d.js looks at; the floor is not, so it only receives light.
// URL: ?quality=low|medium|high &cascades=auto|1..8 &interval=4 &apply=0 (no post pass: the frame stays as the scene's own light draws it).
// Test page for tests/specs/rc2d.mjs: window.rc2dTest = { rc, THREE, points } (points: world spots the spec reads the light at).
import { createEngine, fixedCamera, makeMaterial, THREE } from '../../index.js';
import { createRadianceCascades2D } from './rc2d.js';

const LAYER = 5, AMBIENT = 0.12;   // the scene's own light (one ambient light); rc2d divides by it to get albedo back
const url = new URLSearchParams(location.search);
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: false }, saveKey: 'threedog-rc2d' });
engine.scene.add(new THREE.AmbientLight(0xffffff, AMBIENT));
engine.look.lights.set({ env: { intensity: 0 } });   // no room-map light either: AMBIENT is the whole of the scene's own light
// projection / size per shot work at run time (recipes/21-camera.md) but CameraShot does not declare them yet, hence the cast
const top = /** @type {any} */ ({ position: [0, 40, 0.001], lookAt: [0, 0, 0], projection: 'orthographic', size: 30 });
engine.use(fixedCamera({ shots: { top }, start: 'top' }));

const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), makeMaterial('terrain', { color: 0x8a8a90 }));
floor.rotation.x = -Math.PI / 2;
engine.scene.add(floor);

/** A box seen from above: [x0, z0, x1, z1] in metres; on the light layer, so it blocks (and shines when emissive) */
function block(/** @type {number[]} */ [x0, z0, x1, z1], /** @type {THREE.Material} */ material, height = 4) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, height, z1 - z0), material);
  m.position.set((x0 + x1) / 2, height / 2, (z0 + z1) / 2);
  m.layers.enable(LAYER);
  engine.scene.add(m);
  return m;
}
const wall = makeMaterial('prop', { color: 0x6d6258 });
for (const r of [[-14, -11, -4, -3], [3, -13, 13, -5], [-14, 4, -6, 12], [2, 3.7, 10, 4.3], [2, 3.7, 2.6, 11], [14, 2, 17, 9]]) block(r, wall);
// pillars along the street: small occluders that cast soft shadows from the lamps
for (let x = -10; x <= 10; x += 5) block([x - 0.3, 0.7, x + 0.3, 1.3], wall, 2);

const glow = (/** @type {number} */ color, /** @type {number} */ intensity) => makeMaterial('prop', { color: 0x000000, emissive: color, emissiveIntensity: intensity });
const lamps = [[7, 2.2], [-8, 2], [-2, -5], [-2, 14]].map(([x, z]) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.2, 20), glow(0xffb060, 6));
  m.position.set(x, 4.5, z);
  m.layers.enable(LAYER);
  engine.scene.add(m);
  return m;
});
// lit windows on the south face of the first block, a neon bar on the west face of the second
for (let x = -13; x < -5; x += 3) block([x, -3, x + 1.6, -2.75], glow(0x7fb0ff, 2), 3);
block([2.75, -12, 3, -6], glow(0xff40c0, 3), 3);

// one flickering lamp: rc2d reads emissiveIntensity every frame, so plain material writes are all it takes
const flicker = /** @type {any} */ (lamps[2].material);
engine.onFrame(() => { flicker.emissiveIntensity = 6 * (0.8 + 0.2 * Math.sin(engine.clock.now * 9) * Math.sin(engine.clock.now * 2.3)); });

const cascades = url.get('cascades');
const rc = createRadianceCascades2D(engine, {
  layer: LAYER, ambient: AMBIENT,
  quality: /** @type {any} */ (url.get('quality') ?? 'medium'),
  cascades: cascades && cascades !== 'auto' ? Number(cascades) : 'auto',
  interval: Number(url.get('interval') ?? 4),
  apply: url.get('apply') !== '0',
});

// lit: 1 m from lamp 0; open: 4 m from it with nothing between; shadow: 4 m from it behind the wall at z 3.7..4.3
const points = { lit: [7, 3], open: [7, -1.8], shadow: [7, 6.2] };
Object.assign(window, { engine, rc2dTest: { rc, THREE, points } });
engine.start();
