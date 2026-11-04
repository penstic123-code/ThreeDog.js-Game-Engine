// @ts-check
// Technique example: sun and key light (page /sun-and-key-light.html, README.md next to this file). A neutral gray yard: a cube, a sphere, a
// cylinder, a 3 m pole, a figure-sized capsule and two small objects on the ground. One skill: where the sun stands, how strong it is against the
// fill light, what color each has, and how its shadow is filtered. The calls that do it are in keyLight.js (the file a game copies).
// URL: ?route=noon|overcast|golden   one of the three lighting routes (default golden)
//      &sun=front|side|back|low|top   override the route's sun direction (relative to the camera)
//      &tint=0..1.5                   how far key and fill are pushed apart in color (warm key / cool shadows); default per route
//      &shadow=basic|pcf|vsm &radius=N &extent=M &bias=cm &cascades=1..4   shadow filter, softness, box half size, depth bias in cm, cascades
// Test page for tests/specs/techniques-light.mjs: window.sunTest = { THREE, route, picture, points }. Shapes only here; the whole picture is picture/.
import { createEngine, fixedCamera, THREE } from 'threedog';
import { createPicture } from './picture/index.js';
import { DIRECTIONS, ROUTES, SHADOW_FIT } from './picture/palette.js';

const CAMERA = { position: [5.5, 3.6, 7.2], lookAt: [0, 0.8, 0] };
const url = new URLSearchParams(location.search);
const routeName = url.get('route') ?? 'golden';
const route = ROUTES[routeName];
if (!route) throw new Error(`?route=${routeName}: use one of ${Object.keys(ROUTES).join(', ')}`);
const num = (/** @type {string} */ k, /** @type {number} */ d) => (url.has(k) ? Number(url.get(k)) : d);
const [elevation, azimuth] = url.has('sun') ? DIRECTIONS[/** @type {keyof typeof DIRECTIONS} */ (url.get('sun'))] ?? [route.elevation, route.azimuth] : [route.elevation, route.azimuth];

// no sky module: a route fixes the sun, so nothing here needs the time of day
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), lights: false, ui: { loading: false }, saveKey: 'threedog-sun-key' });
engine.use(fixedCamera({ position: CAMERA.position, lookAt: CAMERA.lookAt }));
const picture = createPicture(engine, { route, tint: num('tint', route.tint), elevation, azimuth, camera: CAMERA.position, shadow: {
  type: url.get('shadow') ?? route.shadow.type, radius: num('radius', route.shadow.radius), extent: num('extent', SHADOW_FIT.extent), biasCm: num('bias', SHADOW_FIT.bias),
  normalBias: SHADOW_FIT.normalBias, mapSize: SHADOW_FIT.mapSize, cascades: num('cascades', 1), ...(route.shadow.blurSamples ? { blurSamples: route.shadow.blurSamples } : {}),
} }), { mat } = picture;

const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ m, /** @type {number[]} */ [x, y, z]) => {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  engine.scene.add(mesh);
  return mesh;
};
const ground = add(new THREE.PlaneGeometry(160, 160), mat.ground, [0, 0, 0]);
ground.rotation.x = -Math.PI / 2;
ground.castShadow = false;
add(new THREE.BoxGeometry(2, 2, 2), mat.cube, [-2.6, 1, -1.2]);                  // three faces: top / sun side / shade side read the form
add(new THREE.SphereGeometry(1, 48, 32), mat.ball, [0.6, 1, -2.4]);              // a terminator: hard or soft depends on the route
add(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 40), mat.drum, [2.8, 0.7, -0.6]);
add(new THREE.CylinderGeometry(0.08, 0.08, 3, 12), mat.pole, [0, 1.5, 1.6]);     // the pole: its shadow length is the sun elevation
add(new THREE.CapsuleGeometry(0.28, 1.2, 8, 20), mat.figure, [-0.4, 0.88, 3.2]); // figure height (1.76 m)
add(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat.small, [1.6, 0.05, 2.6]);          // small objects: lose their contact shadow when the bias is too large
add(new THREE.SphereGeometry(0.12, 24, 16), mat.small, [2.1, 0.12, 2.2]);

// the pole base: the spec walks from it away from the sun to measure the shadow length
const points = { poleBase: [0, 0, 1.6] };
Object.assign(window, { engine, sunTest: { THREE, route: routeName, elevation, azimuth, picture, points } });
engine.start();
