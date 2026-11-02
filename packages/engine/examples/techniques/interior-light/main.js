// @ts-check
// Technique example: interior light (page /interior-light.html, README.md next to this file). A neutral gray room (8 x 6 m, 3 m high) with a
// window in the west wall and a door in the south wall. One skill: lighting a room from outside (sun through the opening, sky light through the
// window), filling the shadowed side with bounce, the exposure change between outside and inside, and lamps at night.
// (time and view are the engine's own URL scenario keys, see core/UrlState.js: page params use other names)
// URL: ?night=1  ?cam=inside|doorway|outside  ?fill=probes|light|none  ?area=0 (no window area light)  ?leak=1 (keep outdoor ambient indoors)
// Test page for tests/specs/techniques-light.mjs: window.interiorTest = { THREE, ready, points, zone }.
import { createEngine, sky, fixedCamera, THREE } from 'threedog';
import { exposureZones, windowLight } from './interiorLight.js';

// ---- parameters: change these ----------------------------------------------------------------------------------------------------------
const ROOM = { min: [-4, 0, -3], max: [4, 3, 3], wall: 0.2 };
const WINDOW = { z: [-1.1, 1.1], y: [0.8, 2.4] };          // opening in the west wall (x = -4)
const DOOR = { x: [1.4, 2.5], y: [0, 2.2] };               // opening in the south wall (z = +3)
const SUN = { elevation: 32, azimuth: -90 + 12, intensity: 3.2, color: '#fff0dc' };   // azimuth: compass degrees from north (-Z), -90 = from the west
// outdoor ambient (hemisphere + room environment) is not blocked by walls: indoors it is turned down and the fill comes from bounce instead
const AMBIENT = { outside: { hemi: 1.0, env: 0.3 }, inside: { hemi: 0.06, env: 0.04 } };
const WINDOW_LIGHT = { color: '#cfe0ff', intensity: 2.2 };   // RectAreaLight: the sky seen through the window (nits-like units, Standard / Physical only)
const BOUNCE_LIGHT = { color: '#ffe2c0', intensity: 1.2, distance: 7 };   // ?fill=light: one unshadowed point light standing in for the sun patch's bounce
// exposure per zone, eased over EASE seconds when the camera crosses the doorway (an eye adapting)
const EXPOSURE = { day: { outside: 1, inside: 1.9 }, night: { outside: 1.6, inside: 1 }, ease: 1.2 };
const LAMPS = [{ at: [2.6, 1.55, -2.2], intensity: 5, color: '#ffc58a', shadow: true }, { at: [-2.8, 1.0, 2.2], intensity: 2.5, color: '#ffb874', shadow: false }];
const VIEWS = {
  inside: { position: [3.4, 1.65, 2.4], lookAt: [-3, 0.8, -0.6] },
  doorway: { position: [1.95, 1.65, 5.2], lookAt: [0.6, 1.1, -3] },
  outside: { position: [6, 1.7, 12], lookAt: [0, 1.2, 0] },
};
// ------------------------------------------------------------------------------------------------------------------------------------------

const url = new URLSearchParams(location.search);
const night = url.get('night') === '1', fill = url.get('fill') ?? 'probes', view = /** @type {keyof typeof VIEWS} */ (url.get('cam') ?? 'inside');
if (!VIEWS[view]) throw new Error(`?cam=${view}: use one of ${Object.keys(VIEWS).join(', ')}`);

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), ui: { loading: false }, saveKey: 'threedog-interior' });
engine.use(sky({ time: night ? '22:30' : '15:00' }));
engine.use(fixedCamera({ shots: VIEWS, start: view }));

// ---- the sun through the window: aimed by hand, shadow box fitted to the room (8 m wide: 0.6 cm texels at 2048) ----
const sun = engine.lights.sun;
if (!night) {
  engine.look.lights.manual('sun.direction');
  const az = THREE.MathUtils.degToRad(SUN.azimuth), el = THREE.MathUtils.degToRad(SUN.elevation);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  sun.target.position.set(0, 0, 0);
  sun.position.copy(dir).multiplyScalar(160);
  engine.look.lights.set({ sun: { intensity: SUN.intensity, color: SUN.color } }, { owner: 'technique' });
}
// thin walls need a small normal bias, or light leaks along the wall's inner edge; the bias is ~1 cm (shadow depth 0-1 x the camera's depth range)
engine.look.shadow.set({ follow: false, extent: 9, normalBias: 0.01, bias: -0.01 / (sun.shadow.camera.far - sun.shadow.camera.near), type: 'pcf', radius: 2 }, { owner: 'technique' });

// ---- the neutral gray room (plain three.js) ----
const mat = (/** @type {number} */ c, roughness = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness });
const wallMat = mat(0xb5b5b5), floorMat = mat(0x8f8f8f);
const box = (/** @type {number[]} */ min, /** @type {number[]} */ max, m = wallMat) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]), m);
  mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  mesh.castShadow = mesh.receiveShadow = true;
  engine.scene.add(mesh);
  return mesh;
};
const [x0, , z0] = ROOM.min, [x1, h, z1] = ROOM.max, t = ROOM.wall;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat(0x8a8a8a, 0.95));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
ground.receiveShadow = true;
engine.scene.add(ground);
box([x0, -0.01, z0], [x1, 0.02, z1], floorMat);                   // the floor
box([x0 - t, h, z0 - t], [x1 + t, h + t, z1 + t]);                // the ceiling
box([x0 - t, 0, z0 - t], [x1 + t, h, z0]);                        // north wall
box([x1, 0, z0], [x1 + t, h, z1]);                                // east wall
// west wall with the window: four pieces around the opening
box([x0 - t, 0, z0], [x0, h, WINDOW.z[0]]); box([x0 - t, 0, WINDOW.z[1]], [x0, h, z1]);
box([x0 - t, 0, WINDOW.z[0]], [x0, WINDOW.y[0], WINDOW.z[1]]); box([x0 - t, WINDOW.y[1], WINDOW.z[0]], [x0, h, WINDOW.z[1]]);
// south wall with the door
box([x0 - t, 0, z1], [DOOR.x[0], h, z1 + t]); box([DOOR.x[1], 0, z1], [x1 + t, h, z1 + t]); box([DOOR.x[0], DOOR.y[1], z1], [DOOR.x[1], h, z1 + t]);
// furniture-sized blocks: a table, a cabinet against the east wall, a sofa-sized block in the corner
box([-1.2, 0, -0.5], [0.4, 0.75, 0.5], mat(0xa0a0a0)); box([3.2, 0, -1.4], [3.95, 1.9, 0.6], mat(0x9c9c9c)); box([-3.9, 0, 1.4], [-2.2, 0.8, 2.9], mat(0xa6a6a6));

// ---- the window as a light: a RectAreaLight in the opening, facing in. Soft and shaped like the window, but it casts no shadow ----
if (url.get('area') !== '0' && !night) {
  windowLight(engine, { position: [x0 - 0.02, (WINDOW.y[0] + WINDOW.y[1]) / 2, 0], lookAt: [0, (WINDOW.y[0] + WINDOW.y[1]) / 2, 0],
    width: WINDOW.z[1] - WINDOW.z[0], height: WINDOW.y[1] - WINDOW.y[0], ...WINDOW_LIGHT });
}

// ---- night: lamps. The bulb hides inside a shade; the light lands on surfaces, the visible emitter stays dim (no glare without bloom) ----
if (night) {
  for (const l of LAMPS) {
    const p = new THREE.PointLight(l.color, l.intensity, 0, 2);   // physical falloff (decay 2); intensity in candela
    p.position.set(l.at[0], l.at[1], l.at[2]);
    p.castShadow = l.shadow;
    if (l.shadow) { p.shadow.mapSize.set(512, 512); p.shadow.bias = -0.002; p.shadow.radius = 4; }
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.28, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xe8dccb, emissive: l.color, emissiveIntensity: 0.35, side: THREE.DoubleSide, roughness: 1 }));
    shade.position.copy(p.position);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, l.at[1] - 0.14, 8), mat(0x777777));
    stand.position.set(l.at[0], (l.at[1] - 0.14) / 2, l.at[2]);
    engine.scene.add(p, shade, stand);
  }
}

// ---- zones: the camera inside the room gets indoor ambient and indoor exposure, eased. Presentation, so it runs per frame ----
const inside = (/** @type {THREE.Vector3} */ p) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 + 0.5 && p.y < h;
const leak = url.get('leak') === '1';
const { zone, apply: applyZone } = exposureZones(engine, { isInside: inside, exposure: EXPOSURE[night ? 'night' : 'day'], ease: EXPOSURE.ease,
  ambient: leak ? { inside: AMBIENT.outside, outside: AMBIENT.outside } : AMBIENT });

// ---- fill: bounce baked into light probes, one cheap point light, or nothing ----
async function setupFill() {
  applyZone(true);   // bake with indoor ambient, as the room is meant to be seen
  if (fill === 'probes') {
    // bounds = the room's air; the probe light follows a fixed point in the room (one SH for the whole scene at a time)
    const center = new THREE.Vector3(0, 1.2, 0);
    await engine.bakeProbes({ bounds: { min: [x0 + 0.5, 0.4, z0 + 0.5], max: [x1 - 0.5, h - 0.4, z1 - 0.5] }, spacing: 2.5, follow: () => center });
  } else if (fill === 'light' && !night) {
    const bounce = new THREE.PointLight(BOUNCE_LIGHT.color, BOUNCE_LIGHT.intensity, BOUNCE_LIGHT.distance, 1);
    bounce.position.set(-1.6, 0.4, 0.2);   // just above where the sun patch lands
    engine.scene.add(bounce);
  }
}
// spots the spec reads: the floor along the north wall and the north wall's lower part, both out of the sun patch
const points = { corner: [-0.5, 0.03, -2.5], northWall: [1.5, 0.6, -2.98] };
// the bake renders cubes between frames, so it runs after start; tracked in engine.loading so screenshots and tests wait for it
const ready = engine.start().then(() => engine.loading.track('fill', setupFill));
Object.assign(window, { engine, interiorTest: { THREE, ready, points, zone, fill, night } });
