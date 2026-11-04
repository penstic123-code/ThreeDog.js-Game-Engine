// @ts-check
// 2D radiance cascades demo (page /rc2d.html): a top-down street at night. Street lamps, lit windows and a neon bar are emissive meshes; building
// blocks and a wall are occluders. Both are on the light layer, which is all rc2d.js looks at; the floor is not, so it only receives light.
// URL: ?quality=low|medium|high &cascades=auto|1..8 &interval=4 &apply=0 (no post pass: the frame stays as the scene's own light draws it).
// Test page for tests/specs/rc2d.mjs: window.rc2dTest = { rc, picture, THREE, points } (points: world spots the spec reads the light at).
// Shapes only here; the whole picture is picture/.
import { createEngine, fixedCamera, THREE } from 'threedog';
import { createPicture } from './picture/index.js';

const url = new URLSearchParams(location.search);
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: false }, saveKey: 'threedog-rc2d' });
// projection / size per shot work at run time (recipes/21-camera.md) but CameraShot does not declare them yet, hence the cast
const top = /** @type {any} */ ({ position: [0, 40, 0.001], lookAt: [0, 0, 0], projection: 'orthographic', size: 30 });
engine.use(fixedCamera({ shots: { top }, start: 'top' }));

const cascades = url.get('cascades');
const picture = createPicture(engine, {
  quality: url.get('quality') ?? 'medium',
  cascades: cascades && cascades !== 'auto' ? Number(cascades) : 'auto',
  interval: Number(url.get('interval') ?? 4),
  apply: url.get('apply') !== '0',
});
const { mat, layer, rc } = picture;

const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat.floor);
floor.rotation.x = -Math.PI / 2;
engine.scene.add(floor);

/** A box seen from above: [x0, z0, x1, z1] in metres; on the light layer, so it blocks (and shines when emissive) */
function block(/** @type {number[]} */ [x0, z0, x1, z1], /** @type {THREE.Material} */ material, height = 4) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, height, z1 - z0), material);
  m.position.set((x0 + x1) / 2, height / 2, (z0 + z1) / 2);
  m.layers.enable(layer);
  engine.scene.add(m);
  return m;
}
for (const r of [[-14, -11, -4, -3], [3, -13, 13, -5], [-14, 4, -6, 12], [2, 3.7, 10, 4.3], [2, 3.7, 2.6, 11], [14, 2, 17, 9]]) block(r, mat.wall);
// pillars along the street: small occluders that cast soft shadows from the lamps
for (let x = -10; x <= 10; x += 5) block([x - 0.3, 0.7, x + 0.3, 1.3], mat.wall, 2);

// the third lamp is the one that flickers
[[7, 2.2], [-8, 2], [-2, -5], [-2, 14]].forEach(([x, z], i) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.2, 20), i === 2 ? mat.flicker : mat.lamp);
  m.position.set(x, 4.5, z);
  m.layers.enable(layer);
  engine.scene.add(m);
});
// lit windows on the south face of the first block, a neon bar on the west face of the second
for (let x = -13; x < -5; x += 3) block([x, -3, x + 1.6, -2.75], mat.window, 3);
block([2.75, -12, 3, -6], mat.neon, 3);

// lit: 1 m from lamp 0; open: 4 m from it with nothing between; shadow: 4 m from it behind the wall at z 3.7..4.3
const points = { lit: [7, 3], open: [7, -1.8], shadow: [7, 6.2] };
Object.assign(window, { engine, rc2dTest: { rc, picture, THREE, points } });
engine.start();
