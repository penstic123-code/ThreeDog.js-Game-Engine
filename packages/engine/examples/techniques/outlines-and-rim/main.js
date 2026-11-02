// @ts-check
// Outlines and rim demo (page /technique-outlines.html): gray objects in front of a gray wall on gray ground, values deliberately close,
// so the silhouette is the problem. Five columns: nothing, post outline, inverted hull in world units, inverted hull in screen pixels,
// rim light. A second capsule far behind each column shows the difference between world and screen line widths.
// The post outline runs for the whole frame; every object of the other columns is on OUTLINE_OFF_LAYER so it gets no lines.
// Test page for tests/specs/technique-looks.mjs: window.techTest = { THREE, columns }.
import { createEngine, fixedCamera, THREE } from 'threedog';
import { outline, OUTLINE_OFF_LAYER } from '@threedog/post-effects';
import { addHull, rimPatch, trackResolution } from './outlines.js';
import { applyEffects } from 'threedog';

// ---------- parameters: change these first ----------
const PARAMS = {
  sun: [40, 38, 16], sunIntensity: 3.2, hemi: 0.35,   // sun offset from its target (direction only); key / fill strengths: the fill sets how dark shade gets
  line: 0x24242c,          // one line color for every route, so only the method differs
  post: { thickness: 1.5, strength: 0.9 },
  hullWorld: 0.035,        // meters
  hullScreen: 2.5,         // device pixels
  rim: { color: 0xe4ecff, strength: 1.2, power: 2.5, shadowSide: 0.5 },
  colors: { object: 0xb3b0aa, wall: 0xa9a7a2, ground: 0xa4a29d, roof: 0x9a958e },
};

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), ui: { loading: false }, saveKey: 'threedog-technique-outlines' });
const sky = new THREE.Color(0xa3acb6);
engine.scene.background = sky;
engine.scene.fog = new THREE.Fog(sky, 30, 90);
// no sky drives the sun here, so its position is a plain write (with a sky: look.lights.manual('sun.direction') first). From the right, lower than the default, so every model shows a lit side, a turn and a shaded side
engine.lights.sun.position.copy(engine.lights.sun.target.position).add(new THREE.Vector3(...PARAMS.sun));
engine.lights.sun.intensity = PARAMS.sunIntensity;   // plain three.js writes: with no sky nothing else drives these
engine.lights.hemi.intensity = PARAMS.hemi;
engine.use(fixedCamera({ shots: { main: { position: [0, 4.2, 13], lookAt: [0, 1.0, -1], fov: 45 } }, start: 'main' }));
engine.look.post.add(outline({ enabled: true, color: PARAMS.line, ...PARAMS.post, offLayer: OUTLINE_OFF_LAYER }));
trackResolution(engine);

const lit = (/** @type {number} */ color, rim = false) => {
  const m = new THREE.MeshLambertMaterial({ color });
  return rim ? applyEffects(m, { patches: [rimPatch(PARAMS.rim)] }) : m;
};
const geo = { body: new THREE.CapsuleGeometry(0.32, 1.1, 8, 24), ball: new THREE.SphereGeometry(0.42, 40, 20), house: new THREE.BoxGeometry(1.8, 1.6, 1.6) };
/** @type {Record<string, (mesh: THREE.Mesh) => void>} */
const routes = {
  none: () => {},
  'post outline': () => {},
  'hull, world units': mesh => { addHull(mesh, { thickness: PARAMS.hullWorld, units: 'world', color: PARAMS.line }); },
  'hull, screen px': mesh => { addHull(mesh, { thickness: PARAMS.hullScreen, units: 'screen', color: PARAMS.line }); },
  'rim light': () => {},
};
const off = (/** @type {THREE.Object3D} */ o) => o.traverse(c => c.layers.enable(OUTLINE_OFF_LAYER));   // no post lines on this one
const names = Object.keys(routes), columns = [];
names.forEach((name, i) => {
  const x = (i - 2) * 3.2, rim = name === 'rim light';
  const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {number[]} */ at, color = PARAMS.colors.object) => {
    const m = new THREE.Mesh(g, lit(color, rim));
    m.position.set(at[0], at[1], at[2]); m.castShadow = m.receiveShadow = true;
    engine.scene.add(m);
    routes[name](m);
    if (name !== 'post outline') off(m);
    return m;
  };
  const body = add(geo.body, [x - 0.5, 0.87, 1.2]);
  add(geo.ball, [x + 0.6, 0.42, 1.4]);
  add(geo.house, [x, 0.8, -1.4], PARAMS.colors.roof);
  const far = add(geo.body, [x + 0.3, 0.87, -7.5]);
  columns.push({ name, x, body: { at: body.position.toArray(), radius: 0.32 }, far: { at: far.position.toArray(), radius: 0.32 } });
});
const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 5, 0.4), lit(PARAMS.colors.wall));
wall.position.set(0, 2.5, -9.5); wall.receiveShadow = true;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), lit(PARAMS.colors.ground));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
// wall and ground stay ON the outline layer: the pass skips any pixel next to an off object, so an off ground would also erase the
// post column's lines where its objects meet the ground. The cost: the post outline also draws the wall's foot and top, as it would in a game
for (const o of [wall, ground]) engine.scene.add(o);

const labels = document.getElementById('labels');
if (labels) {
  const tags = columns.map(c => labels.appendChild(Object.assign(document.createElement('div'), { textContent: c.name })));
  engine.onFrame(() => columns.forEach((c, i) => {
    const v = new THREE.Vector3(c.x, 0, 2.6).project(engine.camera);
    tags[i].style.cssText = `position:fixed;left:${(v.x + 1) / 2 * innerWidth}px;top:${(1 - v.y) / 2 * innerHeight}px;transform:translateX(-50%)`;
  }));
}

Object.assign(window, { engine, techTest: { THREE, columns } });
engine.start();
