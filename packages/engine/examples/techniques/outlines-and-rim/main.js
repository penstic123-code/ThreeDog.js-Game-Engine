// @ts-check
// Outlines and rim demo (page /technique-outlines.html): gray objects in front of a gray wall on gray ground, values deliberately close,
// so the silhouette is the problem. Five columns: nothing, post outline, inverted hull in world units, inverted hull in screen pixels,
// rim light. A second capsule far behind each column shows the difference between world and screen line widths.
// The post outline runs for the whole frame; every object of the other columns is on the off layer so it gets no lines.
// Shapes only here; the whole picture is picture/. Test page for tests/specs/technique-pictures.mjs: window.techTest = { THREE, columns, picture }.
import { createEngine, fixedCamera, THREE } from 'threedog';
import { addHull, trackResolution } from './outlines.js';
import { createPicture } from './picture/index.js';

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: false }, saveKey: 'threedog-technique-outlines' });
engine.use(fixedCamera({ shots: { main: { position: [0, 4.2, 13], lookAt: [0, 1.0, -1], fov: 45 } }, start: 'main' }));
const picture = createPicture(engine), { mat } = picture;
trackResolution(engine);

const geo = { body: new THREE.CapsuleGeometry(0.32, 1.1, 8, 24), ball: new THREE.SphereGeometry(0.42, 40, 20), house: new THREE.BoxGeometry(1.8, 1.6, 1.6) };
/** @type {Record<string, (mesh: THREE.Mesh) => void>} */
const routes = {
  none: () => {},
  'post outline': () => {},
  'hull, world units': mesh => { addHull(mesh, picture.hull.world); },
  'hull, screen px': mesh => { addHull(mesh, picture.hull.screen); },
  'rim light': () => {},
};
const off = (/** @type {THREE.Object3D} */ o) => o.traverse(c => c.layers.enable(picture.offLayer));   // no post lines on this one
const names = Object.keys(routes), columns = [];
names.forEach((name, i) => {
  const x = (i - 2) * 3.2, rim = name === 'rim light';
  const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {number[]} */ at, material = rim ? mat.rimObject : mat.object) => {
    const m = new THREE.Mesh(g, material);
    m.position.set(at[0], at[1], at[2]); m.castShadow = m.receiveShadow = true;
    engine.scene.add(m);
    routes[name](m);
    if (name !== 'post outline') off(m);
    return m;
  };
  const body = add(geo.body, [x - 0.5, 0.87, 1.2]);
  add(geo.ball, [x + 0.6, 0.42, 1.4]);
  add(geo.house, [x, 0.8, -1.4], rim ? mat.rimRoof : mat.roof);
  const far = add(geo.body, [x + 0.3, 0.87, -7.5]);
  columns.push({ name, x, body: { at: body.position.toArray(), radius: 0.32 }, far: { at: far.position.toArray(), radius: 0.32 } });
});
const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 5, 0.4), mat.wall);
wall.position.set(0, 2.5, -9.5); wall.receiveShadow = true;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat.ground);
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

Object.assign(window, { engine, techTest: { THREE, columns, picture } });
engine.start();
