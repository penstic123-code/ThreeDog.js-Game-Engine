// @ts-check
// Three looks demo (page /technique-looks.html?look=cartoon|comic|cinematic): the same models in one of three separate scenes, each scene's whole picture
// in picture/, on the WebGPU route. Shapes only here. A look is chosen by the page address, so each scene builds from nothing and shares no state.
// Test page for tests/specs/technique-looks.mjs: window.techTest = { look, measure }.
import 'threedog/tsl';   // first: the WebGPU route's node versions of the engine's post chain and shadows register here
import { createEngine, fixedCamera, THREE } from 'threedog';
import { createPicture } from './picture/index.js';

const look = new URLSearchParams(location.search).get('look') ?? 'cartoon';
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), renderer: 'webgpu', lights: false, ui: { loading: false },
  saveKey: 'threedog-technique-looks' });
engine.use(fixedCamera({ shots: { main: { position: [7, 4.6, 10.5], lookAt: [0, 1.1, 0], fov: 42 } }, start: 'main' }));
const { materials } = createPicture(engine, look);

/** @param {THREE.BufferGeometry} g @param {THREE.Material} m @param {number[]} at */
function place(g, m, at) {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(at[0], at[1], at[2]);
  mesh.castShadow = mesh.receiveShadow = true;
  engine.scene.add(mesh);
  return mesh;
}
const roof = new THREE.ConeGeometry(2.2, 1.5, 4).rotateY(Math.PI / 4);
place(new THREE.BoxGeometry(3, 2, 2.6), materials.wall, [-1.6, 1, -1.4]);
place(roof, materials.roof, [-1.6, 2.75, -1.4]);
place(new THREE.BoxGeometry(0.6, 1.1, 0.06), materials.door, [-1.0, 0.55, -0.08]);
// tree crowns stand on their own origin: wind sways a vertex by its height over the object's origin
const crown = new THREE.IcosahedronGeometry(1.15, 1).translate(0, 2.5, 0), trunk = new THREE.CylinderGeometry(0.16, 0.24, 1.6, 7).translate(0, 0.8, 0);
for (const [x, z, s] of [[3, -1.8, 1], [4.6, 1, 0.75], [-5, 0.6, 0.9]]) {
  place(trunk, materials.trunk, [x, 0, z]).scale.setScalar(s);
  place(crown, materials.leaves, [x, 0, z]).scale.setScalar(s);
}
place(new THREE.CapsuleGeometry(0.34, 0.9, 6, 16), materials.body, [1.1, 0.8, 1.8]);
place(new THREE.SphereGeometry(0.34, 24, 16), materials.head, [1.1, 1.95, 1.8]);
place(new THREE.SphereGeometry(0.6, 32, 20), materials.ball, [2.8, 0.6, 3.2]);
place(new THREE.DodecahedronGeometry(0.55, 0), materials.rock, [-2.2, 0.35, 3]);
place(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), materials.ground, [0, 0, 0]).castShadow = false;

/** Pixel numbers of the frame just drawn: what differs between the looks, for the spec and the report */
function measure() {
  engine.step(0.05);
  const src = engine.renderer.domElement, c = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height });
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d', { willReadFrequently: true }));
  x.drawImage(src, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data, n = d.length / 4, seen = new Map();
  let sat = 0, lum = 0, lum2 = 0, warm = 0, grayish = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    sat += hi ? (hi - lo) / hi : 0; lum += l; lum2 += l * l; warm += r - b; if (hi - lo <= 2) grayish++;
    const k = (r >> 2 << 12) | (g >> 2 << 6) | (b >> 2);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const counts = [...seen.values()].sort((a, b) => b - a), top = k => counts.slice(0, k).reduce((s, v) => s + v, 0) / n, m = lum / n, f = (/** @type {number} */ v) => +v.toFixed(3);
  return { pixels: n, saturation: f(sat / n), meanLum: f(m), lumStd: f(Math.sqrt(Math.max(0, lum2 / n - m * m))), warmth: f(warm / n / 255), grayShare: f(grayish / n), colors: seen.size, top3: f(top(3)), top8: f(top(8)) };
}

Object.assign(window, { engine, techTest: { look, measure } });
engine.start();
