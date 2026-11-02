// @ts-check
// Procedural surface demo (page /technique-surface.html): four identical house blocks at the game's real camera distance.
// 1 plain, 2 world-space triplanar noise at a scale picked from the camera, 3 the same noise at a scale tuned up close (it fades away at
// this distance: the lesson), 4 stacked: lazily painted brush texture + baked cavity AO + edge wear. In front, crates from one
// InstancedMesh: the left half with one color, the right half with per-instance hue / value jitter.
// Test page for tests/specs/technique-looks.mjs: window.techTest = { THREE, walls, crates }.
import { createEngine, fixedCamera, THREE } from 'threedog';
import { scaleForCamera, worldVariation, brushTexture, cavity, edgeWear, jitterInstances } from './surface.js';

// ---------- parameters: change these first ----------
const PARAMS = {
  sun: [30, 40, 26], sunIntensity: 3.2, hemi: 0.35,   // sun offset from its target (direction only); key / fill strengths: the fill sets how dark shade gets
  camera: { position: [0, 4.5, 15], lookAt: [0, 1.2, 0], fov: 45 },   // the shot the scales are chosen for: use your game's camera here
  wall: 0xd6d0c6, roof: 0x8c847d, crate: 0xb7a58f, ground: 0x8f8d88,
  noise: { cellPx: 14, strength: 0.4 },        // cells of 14 screen pixels: reads as plaster patches at this distance
  closeUpScale: 40,                            // repeats per meter an artist picks 1 m from the wall; invisible at 15 m
  brush: { cellPx: 120, strength: 0.5 },       // one brush tile over ~120 px, so single strokes are ~10 px
  cavity: { strength: 0.9 },
  wear: { width: 0.1, strength: 0.7 },
  jitter: { hue: 0.03, value: 0.12 },
};

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), ui: { loading: false }, saveKey: 'threedog-technique-surface' });
const sky = new THREE.Color(0xa3acb6);
engine.scene.background = sky;
engine.scene.fog = new THREE.Fog(sky, 30, 90);
// no sky drives the sun here, so its position is a plain write (with a sky: look.lights.manual('sun.direction') first). From the right, lower than the default, so every model shows a lit side, a turn and a shaded side
engine.lights.sun.position.copy(engine.lights.sun.target.position).add(new THREE.Vector3(...PARAMS.sun));
engine.lights.sun.intensity = PARAMS.sunIntensity;   // plain three.js writes: with no sky nothing else drives these
engine.lights.hemi.intensity = PARAMS.hemi;
engine.use(fixedCamera({ shots: { main: /** @type {any} */ (PARAMS.camera) }, start: 'main' }));

// distance to the walls' fronts and the real drawing-buffer height: the two numbers every scale below comes from
const viewH = engine.renderer.getDrawingBufferSize(new THREE.Vector2()).y || 540;
const dist = Math.hypot(PARAMS.camera.position[1] - 1.1, PARAMS.camera.position[2]);
const noiseScale = scaleForCamera(PARAMS.camera, dist, viewH, PARAMS.noise.cellPx);
const brushScale = scaleForCamera(PARAMS.camera, dist, viewH, PARAMS.brush.cellPx);

const W = 2.8, H = 2.2, D = 2.4;
/** One house: walls (a box with enough segments to carry vertex AO), a roof slab that overhangs */
function house(/** @type {number} */ x, /** @type {(g: THREE.BoxGeometry) => THREE.Material} */ wallMaterial) {
  const g = new THREE.BoxGeometry(W, H, D, 14, 11, 12), m = wallMaterial(g);
  const walls = new THREE.Mesh(g, m);
  walls.position.set(x, H / 2, -D / 2);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.25, D + 0.5), new THREE.MeshLambertMaterial({ color: PARAMS.roof }));
  roof.position.set(x, H + 0.12, -D / 2);
  for (const o of [walls, roof]) { o.castShadow = o.receiveShadow = true; engine.scene.add(o); }
  return walls;
}
const lambert = () => new THREE.MeshLambertMaterial({ color: PARAMS.wall });
const variants = {
  plain: () => lambert(),
  'noise, scale from camera': () => worldVariation(lambert(), { scale: noiseScale, strength: PARAMS.noise.strength }),
  'noise, tuned up close': () => worldVariation(lambert(), { scale: PARAMS.closeUpScale, strength: PARAMS.noise.strength }),
  'brush + cavity + wear': (/** @type {THREE.BoxGeometry} */ g) => {
    // occluders in the walls' local space: the ground under them and the roof slab over them
    const groundG = new THREE.PlaneGeometry(12, 12).rotateX(-Math.PI / 2).translate(0, -H / 2, 0);
    const roofG = new THREE.BoxGeometry(W + 0.5, 0.25, D + 0.5).translate(0, H / 2 + 0.12, 0);
    cavity(g, { occluders: [groundG, roofG], strength: PARAMS.cavity.strength, radius: 0.9 });
    const m = new THREE.MeshLambertMaterial({ color: PARAMS.wall, vertexColors: true });
    worldVariation(m, { scale: brushScale, strength: PARAMS.brush.strength, texture: brushTexture() });
    return edgeWear(g, m, PARAMS.wear);
  },
};
const walls = Object.entries(variants).map(([name, make], i) => {
  const x = (i - 1.5) * 4.1, mesh = house(x, make);
  // test spots: a grid over the front face (z = 0), inset from the edges; bottom / middle rows for the cavity check
  const grid = [];
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 8; gx++) grid.push([x - 1.1 + gx * 2.2 / 7, 0.45 + gy * 1.3 / 5, 0.01]);
  return { name, x, mesh, grid, foot: [x, 0.08, 0.01], middle: [x, 1.1, 0.01] };
});

// crates: one InstancedMesh, the left half plain, the right half jittered (two meshes so both halves share the geometry and material)
const crateG = new THREE.BoxGeometry(0.6, 0.6, 0.6), crateM = new THREE.MeshLambertMaterial({ color: 0xffffff });
const crates = ['same', 'jitter'].map((kind, k) => {
  const im = new THREE.InstancedMesh(crateG, crateM, 8), t = new THREE.Object3D(), spots = [];
  for (let i = 0; i < 8; i++) {
    t.position.set((k ? 0.6 : -7.4) + i * 0.95, 0.3, 3.2); t.rotation.y = (i * 0.37) % 0.5 - 0.25; t.updateMatrix();
    im.setMatrixAt(i, t.matrix); spots.push([t.position.x, 0.62, 3.2]);   // top face center: lit the same way on every crate
  }
  if (k) jitterInstances(im, PARAMS.crate, PARAMS.jitter);
  else for (let i = 0; i < 8; i++) im.setColorAt(i, new THREE.Color(PARAMS.crate));
  im.castShadow = im.receiveShadow = true;
  engine.scene.add(im);
  return { kind, mesh: im, spots };
});

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: PARAMS.ground }));
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

Object.assign(window, { engine, techTest: { THREE, walls, crates, scales: { noise: noiseScale, brush: brushScale, closeUp: PARAMS.closeUpScale, dist, viewH } } });
engine.start();
