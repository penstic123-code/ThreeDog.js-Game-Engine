// @ts-check
// Technique example: interior light (page /interior-light.html, README.md next to this file). A neutral gray room (8 x 6 m, 3 m high) with a
// window in the west wall and a door in the south wall. One skill: lighting a room from outside (sun through the opening, sky light through the
// window), filling the shadowed side with bounce, the exposure change between outside and inside, and lamps at night.
// (time and view are the engine's own URL scenario keys, see core/inspect/UrlState.js: page params use other names)
// URL: ?night=1  ?cam=inside|doorway|outside  ?fill=probes|light|none  ?area=0 (no window area light)  ?leak=1 (keep outdoor ambient indoors)
// Test page for tests/specs/techniques-light.mjs: window.interiorTest = { THREE, ready, points, picture }. Shapes only here; the whole picture is picture/.
import { createEngine, sky, fixedCamera, THREE } from 'threedog';
import { createPicture } from './picture/index.js';

// ---- parameters: change these ----------------------------------------------------------------------------------------------------------
const ROOM = { min: [-4, 0, -3], max: [4, 3, 3], wall: 0.2 };
const WINDOW = { z: [-1.1, 1.1], y: [0.8, 2.4] };          // opening in the west wall (x = -4)
const DOOR = { x: [1.4, 2.5], y: [0, 2.2] };               // opening in the south wall (z = +3)
const LAMPS = /** @type {{ at: number[], kind: 'main' | 'side' }[]} */ ([{ at: [2.6, 1.55, -2.2], kind: 'main' }, { at: [-2.8, 1.0, 2.2], kind: 'side' }]);
const VIEWS = {
  inside: { position: [3.4, 1.65, 2.4], lookAt: [-3, 0.8, -0.6] },
  doorway: { position: [1.95, 1.65, 5.2], lookAt: [0.6, 1.1, -3] },
  outside: { position: [6, 1.7, 12], lookAt: [0, 1.2, 0] },
};
// ------------------------------------------------------------------------------------------------------------------------------------------

const url = new URLSearchParams(location.search);
const night = url.get('night') === '1', fill = url.get('fill') ?? 'probes', view = /** @type {keyof typeof VIEWS} */ (url.get('cam') ?? 'inside');
if (!VIEWS[view]) throw new Error(`?cam=${view}: use one of ${Object.keys(VIEWS).join(', ')}`);

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: false }, saveKey: 'threedog-interior' });
engine.use(sky({ time: night ? '22:30' : '15:00' }));
engine.use(fixedCamera({ shots: VIEWS, start: view }));

const [x0, , z0] = ROOM.min, [x1, h, z1] = ROOM.max, t = ROOM.wall, windowY = (WINDOW.y[0] + WINDOW.y[1]) / 2;
// the camera inside this box gets indoor ambient and indoor exposure, eased
const inside = (/** @type {THREE.Vector3} */ p) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 + 0.5 && p.y < h;
const picture = createPicture(engine, { night, fill, isInside: inside, leak: url.get('leak') === '1',
  // the window as a light: a RectAreaLight in the opening, facing in
  windowOpening: url.get('area') === '0' ? null : { position: [x0 - 0.02, windowY, 0], lookAt: [0, windowY, 0], width: WINDOW.z[1] - WINDOW.z[0], height: WINDOW.y[1] - WINDOW.y[0] } });
const { mat } = picture;

// ---- the neutral gray room ----
const box = (/** @type {number[]} */ min, /** @type {number[]} */ max, m = mat.wall) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), m);
  mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  mesh.castShadow = mesh.receiveShadow = true;
  engine.scene.add(mesh);
  return mesh;
};
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat.ground);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
ground.receiveShadow = true;
engine.scene.add(ground);
box([x0, -0.01, z0], [x1, 0.02, z1], mat.floor);                   // the floor
box([x0 - t, h, z0 - t], [x1 + t, h + t, z1 + t]);                // the ceiling
box([x0 - t, 0, z0 - t], [x1 + t, h, z0]);                        // north wall
box([x1, 0, z0], [x1 + t, h, z1]);                                // east wall
// west wall with the window: four pieces around the opening
box([x0 - t, 0, z0], [x0, h, WINDOW.z[0]]); box([x0 - t, 0, WINDOW.z[1]], [x0, h, z1]);
box([x0 - t, 0, WINDOW.z[0]], [x0, WINDOW.y[0], WINDOW.z[1]]); box([x0 - t, WINDOW.y[1], WINDOW.z[0]], [x0, h, WINDOW.z[1]]);
// south wall with the door
box([x0 - t, 0, z1], [DOOR.x[0], h, z1 + t]); box([DOOR.x[1], 0, z1], [x1 + t, h, z1 + t]); box([DOOR.x[0], DOOR.y[1], z1], [DOOR.x[1], h, z1 + t]);
// furniture-sized blocks: a table, a cabinet against the east wall, a sofa-sized block in the corner
box([-1.2, 0, -0.5], [0.4, 0.75, 0.5], mat.table); box([3.2, 0, -1.4], [3.95, 1.9, 0.6], mat.cabinet); box([-3.9, 0, 1.4], [-2.2, 0.8, 2.9], mat.sofa);

// ---- night: lamps. The bulb hides inside a shade; the light lands on surfaces, the visible emitter stays dim ----
if (night) {
  for (const { at, kind } of LAMPS) {
    picture.addLamp(kind, at);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.28, 24, 1, true), mat.shade[kind]);
    shade.position.set(at[0], at[1], at[2]);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, at[1] - 0.14, 8), mat.stand);
    stand.position.set(at[0], (at[1] - 0.14) / 2, at[2]);
    engine.scene.add(shade, stand);
  }
}

// ---- fill: bounce baked into light probes; ?fill=light is one cheap point light in picture/lights.js ----
async function setupFill() {
  picture.snapZone();   // bake with indoor ambient, as the room is meant to be seen
  if (fill !== 'probes') return;
  // bounds = the room's air
  await engine.bakeProbes({ bounds: { min: [x0 + 0.5, 0.4, z0 + 0.5], max: [x1 - 0.5, h - 0.4, z1 - 0.5] }, spacing: 2.5 });
}
// spots the spec reads: the floor along the north wall and the north wall's lower part, both out of the sun patch
const points = { corner: [-0.5, 0.03, -2.5], northWall: [1.5, 0.6, -2.98] };
// the bake renders cubes between frames, so it runs after start; tracked in engine.loading so screenshots and tests wait for it
const ready = engine.start().then(() => engine.loading.track('fill', setupFill));
Object.assign(window, { engine, interiorTest: { THREE, ready, points, picture, fill, night } });
