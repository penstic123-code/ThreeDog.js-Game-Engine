// @ts-check
// Stylized shading demo (page /technique-shading.html): the same neutral models (a house block, a character-sized capsule, a ball, a ground
// tile) five times, one column per route: toon by ramp texture, toon by smoothstep, painterly soft light, stylized PBR, and the "plastic"
// mistake for comparison. Shapes only here; the whole picture, sun with its shadow map included, is picture/.
// Test page for tests/specs/technique-pictures.mjs: window.techTest = { THREE, columns, sun, hemi }.
import { createEngine, fixedCamera, THREE } from 'threedog';
import { createPicture } from './picture/index.js';

const SPACING = 3.5;
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: false }, saveKey: 'threedog-technique-shading' });
engine.use(fixedCamera({ shots: { main: { position: [0, 5.2, 13.5], lookAt: [0, 0.9, 0], fov: 45 } }, start: 'main' }));
const picture = createPicture(engine);

/** A gable roof as an extruded triangle, w wide, d deep, h high */
function roofGeometry(w, d, h) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}
const geo = {
  wall: new THREE.BoxGeometry(2, 1.6, 1.8), roof: roofGeometry(2.3, 2.0, 0.9), body: new THREE.CapsuleGeometry(0.32, 1.1, 8, 24),
  ball: new THREE.SphereGeometry(0.45, 48, 24), tile: new THREE.BoxGeometry(3.0, 0.06, 5.0),
};

/** @param {THREE.BufferGeometry} g @param {THREE.Material} m @param {number[]} at */
function place(g, m, at) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = mesh.receiveShadow = true;
  engine.scene.add(mesh);
  return mesh;
}
const names = Object.keys(picture.routes), columns = [];
names.forEach((name, i) => {
  const x = (i - (names.length - 1) / 2) * SPACING, make = picture.routes[name];
  const mats = Object.fromEntries(picture.parts.map(p => [p, make(/** @type {any} */ (p))]));
  place(geo.tile, mats.tile, [x, 0.03, 0]);
  const house = place(geo.wall, mats.wall, [x, 0.86, -1.2]);
  place(geo.roof, mats.roof, [x, 1.66, -1.2]);
  const body = place(geo.body, mats.body, [x - 0.6, 0.93, 1.0]);
  const ball = place(geo.ball, mats.ball, [x + 0.65, 0.51, 1.1]);
  // spots the spec reads: ground in the house's cast shadow (sun from +x, slightly behind), and open ground in the same tile
  columns.push({ name, x, house, body, ball, shadowSpot: [x - 1.35, 0.06, -0.6], openSpot: [x + 1.2, 0.06, 1.9] });
});
// a darker ground around the tiles so their edges read
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), picture.ground);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
engine.scene.add(ground);

// column names over the picture (HTML, so screenshots of the 3D canvas stay clean of text)
const labels = document.getElementById('labels');
if (labels) {
  const tags = columns.map(c => labels.appendChild(Object.assign(document.createElement('div'), { textContent: c.name })));
  engine.onFrame(() => columns.forEach((c, i) => {
    const v = new THREE.Vector3(c.x, 0, 2.7).project(engine.camera);
    tags[i].style.cssText = `position:fixed;left:${(v.x + 1) / 2 * innerWidth}px;top:${(1 - v.y) / 2 * innerHeight}px;transform:translateX(-50%)`;
  }));
}

Object.assign(window, { engine, techTest: { THREE, columns, sun: picture.sun, hemi: picture.hemi } });
engine.start();
