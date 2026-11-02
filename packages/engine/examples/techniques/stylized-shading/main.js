// @ts-check
// Stylized shading demo (page /technique-shading.html): the same neutral models (a house block, a character-sized capsule, a ball, a ground
// tile) five times, one column per route: toon by ramp texture, toon by smoothstep, painterly soft light, stylized PBR, and the "plastic"
// mistake for comparison. The engine's default sun (with its shadow map), hemisphere light and fog light every column.
// Test page for tests/specs/technique-looks.mjs: window.techTest = { THREE, columns, sun }.
import { createEngine, fixedCamera, THREE } from 'threedog';
import { rampTexture, toonMaterial, painterlyMaterial, stylizedPbrMaterial } from './shading.js';

// ---------- parameters: change these first ----------
const PARAMS = {
  sun: [36, 44, -8], sunIntensity: 3.2, hemi: 0.35, env: 0.35,   // sun offset from its target (direction only); key / fill strengths: the fill sets how dark shade gets
  // neutral bases, the same in every column so only the shading differs (sRGB hex)
  colors: { wall: 0xc2bcb2, roof: 0x7d756e, body: 0xb0b2b8, ball: 0xaaa59d, tile: 0x96948f },
  toonRamp: [[0, 0.0], [0.12, 0.45], [0.55, 0xfff2df]],   // [sun share where a band starts, light]: shade, mid band, a warm lit band
  toonBands: { bands: 3, soft: 0.02 },
  toonShade: { shade: 0x6a78b8, shadeStrength: 0.35 },   // the dark band leans blue-violet
  painterly: { wrap: 0.5, terminator: 0xff7a45, terminatorStrength: 0.35, shadow: 0x5a6fb0, shadowStrength: 0.45 },
  pbrRoughness: { wall: 0.9, roof: 0.75, body: 0.6, ball: 0.45, tile: 0.95 },   // designed per surface, never one value for all
  pbrLift: 0.12,
  plasticRoughness: 0.2,   // the mistake: one low roughness everywhere
  spacing: 3.5,
};

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), ui: { loading: false }, saveKey: 'threedog-technique-shading' });
const sky = new THREE.Color(0xa3acb6);
engine.scene.background = sky;
engine.scene.fog = new THREE.Fog(sky, 30, 90);
// no sky drives the sun here, so its position is a plain write (with a sky: look.lights.manual('sun.direction') first). From the right, lower than the default, so every model shows a lit side, a turn and a shaded side
engine.lights.sun.position.copy(engine.lights.sun.target.position).add(new THREE.Vector3(...PARAMS.sun));
engine.lights.sun.intensity = PARAMS.sunIntensity;   // plain three.js writes: with no sky nothing else drives these
engine.lights.hemi.intensity = PARAMS.hemi;
engine.look.lights.set({ env: { intensity: PARAMS.env } });   // the neutral room reflection Standard materials get; strong, it flattens PBR shade   // plain three.js fog: every route's material keeps three's fog chunk
engine.use(fixedCamera({ shots: { main: { position: [0, 5.2, 13.5], lookAt: [0, 0.9, 0], fov: 45 } }, start: 'main' }));

const ramp = rampTexture(/** @type {[number, number][]} */ (PARAMS.toonRamp));
/** @type {Record<string, (part: keyof typeof PARAMS.colors) => THREE.Material>} */
const routes = {
  'toon (ramp texture)': part => toonMaterial({ color: PARAMS.colors[part], ramp, ...PARAMS.toonShade }),
  'toon (smoothstep)': part => toonMaterial({ color: PARAMS.colors[part], ...PARAMS.toonBands, ...PARAMS.toonShade }),
  painterly: part => painterlyMaterial({ color: PARAMS.colors[part], ...PARAMS.painterly }),
  'stylized PBR': part => stylizedPbrMaterial({ color: PARAMS.colors[part], roughness: PARAMS.pbrRoughness[part], lift: PARAMS.pbrLift }),
  'plastic (mistake)': part => new THREE.MeshStandardMaterial({ color: PARAMS.colors[part], roughness: PARAMS.plasticRoughness, metalness: 0 }),
};

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
const names = Object.keys(routes), columns = [];
names.forEach((name, i) => {
  const x = (i - (names.length - 1) / 2) * PARAMS.spacing, make = routes[name];
  const mats = Object.fromEntries(Object.keys(PARAMS.colors).map(p => [p, make(/** @type {any} */ (p))]));
  place(geo.tile, mats.tile, [x, 0.03, 0]);
  const house = place(geo.wall, mats.wall, [x, 0.86, -1.2]);
  place(geo.roof, mats.roof, [x, 1.66, -1.2]);
  const body = place(geo.body, mats.body, [x - 0.6, 0.93, 1.0]);
  const ball = place(geo.ball, mats.ball, [x + 0.65, 0.51, 1.1]);
  // spots the spec reads: ground in the house's cast shadow (sun from +x, slightly behind), and open ground in the same tile
  columns.push({ name, x, house, body, ball, shadowSpot: [x - 1.35, 0.06, -0.6], openSpot: [x + 1.2, 0.06, 1.9] });
});
// a darker ground around the tiles so their edges read
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x6c6a66 }));
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

Object.assign(window, { engine, techTest: { THREE, columns, sun: engine.lights.sun } });
engine.start();
