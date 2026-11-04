// @ts-check
// Procedural surface demo (page /technique-surface.html): four identical house blocks at the game's real camera distance.
// 1 plain, 2 world-space triplanar noise at a scale picked from the camera, 3 the same noise at a scale tuned up close (it fades away at
// this distance: the lesson), 4 stacked: lazily painted brush texture + baked cavity AO + edge wear. In front, crates from one
// InstancedMesh: the left half with one color, the right half with per-instance hue / value jitter.
// Shapes only here; the whole picture is picture/. Test page for tests/specs/technique-pictures.mjs: window.techTest = { THREE, walls, crates, scales, picture }.
import { createEngine, fixedCamera, THREE } from 'threedog';
import { createPicture } from './picture/index.js';

const SHOT = { position: [0, 4.5, 15], lookAt: [0, 1.2, 0], fov: 45 };   // the shot the scales are chosen for: use your game's camera here
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: false }, saveKey: 'threedog-technique-surface' });
engine.use(fixedCamera({ shots: { main: /** @type {any} */ (SHOT) }, start: 'main' }));
const picture = createPicture(engine, SHOT);

const W = 2.8, H = 2.2, D = 2.4;
// occluders for the baked cavity, in the walls' local space: the ground under them and the roof slab over them
const occluders = () => [new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2).translate(0, -H / 2, 0), new THREE.BoxGeometry(W + 0.5, 0.25, D + 0.5).translate(0, H / 2 + 0.12, 0)];
/** One house: walls (a box with enough segments to carry vertex AO), a roof slab that overhangs */
function house(/** @type {number} */ x, /** @type {(g: THREE.BoxGeometry, occluders: THREE.BufferGeometry[]) => THREE.Material} */ wallMaterial) {
  const g = new THREE.BoxGeometry(W, H, D, 14, 11, 12), m = wallMaterial(g, occluders());
  const walls = new THREE.Mesh(g, m);
  walls.position.set(x, H / 2, -D / 2);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.25, D + 0.5), picture.roof);
  roof.position.set(x, H + 0.12, -D / 2);
  for (const o of [walls, roof]) { o.castShadow = o.receiveShadow = true; engine.scene.add(o); }
  return walls;
}
const walls = Object.entries(picture.walls).map(([name, make], i) => {
  const x = (i - 1.5) * 4.1, mesh = house(x, make);
  // test spots: a grid over the front face (z = 0), inset from the edges; bottom / middle rows for the cavity check
  const grid = [];
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 8; gx++) grid.push([x - 1.1 + gx * 2.2 / 7, 0.45 + gy * 1.3 / 5, 0.01]);
  return { name, x, mesh, grid, foot: [x, 0.08, 0.01], middle: [x, 1.1, 0.01] };
});

// crates: one InstancedMesh, the left half plain, the right half jittered (two meshes so both halves share the geometry and material)
const crateG = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const crates = ['same', 'jitter'].map((kind, k) => {
  const im = new THREE.InstancedMesh(crateG, picture.crate, 8), t = new THREE.Object3D(), spots = [];
  for (let i = 0; i < 8; i++) {
    t.position.set((k ? 0.6 : -7.4) + i * 0.95, 0.3, 3.2); t.rotation.y = (i * 0.37) % 0.5 - 0.25; t.updateMatrix();
    im.setMatrixAt(i, t.matrix); spots.push([t.position.x, 0.62, 3.2]);   // top face center: lit the same way on every crate
  }
  if (k) picture.crateJitter(im); else picture.crateSame(im);
  im.castShadow = im.receiveShadow = true;
  engine.scene.add(im);
  return { kind, mesh: im, spots };
});

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), picture.ground);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
engine.scene.add(ground);

const labels = document.getElementById('labels');
if (labels) {
  const items = [...walls.map(w => ({ name: w.name, at: [w.x, 2.9, -1.2] })), { name: 'one color', at: [-4, 0, 4] }, { name: 'per-instance jitter', at: [4, 0, 4] }];
  const tags = items.map(c => labels.appendChild(Object.assign(document.createElement('div'), { textContent: c.name })));
  engine.onFrame(() => items.forEach((c, i) => {
    const v = new THREE.Vector3(...c.at).project(engine.camera);
    tags[i].style.cssText = `position:fixed;left:${(v.x + 1) / 2 * innerWidth}px;top:${(1 - v.y) / 2 * innerHeight}px;transform:translate(-50%,-100%)`;
  }));
}

Object.assign(window, { engine, techTest: { THREE, walls, crates, scales: picture.scales, picture } });
engine.start();
