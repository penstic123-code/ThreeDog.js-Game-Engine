// @ts-check
// Technique example: sun and key light (page /sun-and-key-light.html, README.md next to this file). A neutral gray yard: a cube, a sphere, a
// cylinder, a 3 m pole, a figure-sized capsule and two small objects on the ground. One skill: where the sun stands, how strong it is against the
// fill light, what color each has, and how its shadow is filtered. The calls that do it are in keyLight.js (the file a game copies).
// URL: ?route=noon|overcast|golden   one of the three lighting routes (default golden)
//      &sun=front|side|back|low|top   override the route's sun direction (relative to the camera)
//      &tint=0..1.5                   how far key and fill are pushed apart in color (warm key / cool shadows); default per route
//      &shadow=basic|pcf|vsm &radius=N &extent=M &bias=cm &cascades=1..4   shadow filter, softness, box half size, depth bias in cm, cascades
// Test page for tests/specs/techniques-light.mjs: window.sunTest = { THREE, route, ratio, points }.
import { createEngine, sky, fixedCamera, THREE } from 'threedog';
import { applyKeyFill, aimSun, fitSunShadow } from './keyLight.js';

// ---- parameters: change these ----------------------------------------------------------------------------------------------------------
// elevation / azimuth in degrees. azimuth is measured around the subject from the camera: 0 = sun behind the camera (front light),
// 90 = from the side, 180 = facing the camera (back light). key = the sun (DirectionalLight), fill = the hemisphere light + the room environment.
/** @type {Record<string, { elevation: number, azimuth: number, key: { intensity: number, color: string }, fill: { intensity: number, color: string, ground: string }, env: number, tint: number, backdrop: string, shadow: { type: 'basic' | 'pcf' | 'vsm', radius: number, blurSamples?: number } }>} */
const ROUTES = {
  // hard noon: a strong high key, a weak blue fill -> short dark shadows, key:fill about 5:1 on the ground. Clear, graphic, a bit harsh.
  noon: { elevation: 72, azimuth: 35, key: { intensity: 2.7, color: '#fff3e2' }, fill: { intensity: 0.35, color: '#9fbfe8', ground: '#6d675e' }, env: 0.1,
    tint: 1, backdrop: '#a8c4e4', shadow: { type: 'pcf', radius: 1 } },
  // soft overcast: the sky is the light. A weak key, a strong near-white fill, a very soft shadow -> key:fill about 1.4:1, forms read by
  // gentle gradients and contact darkening only. Calm, can turn gray-flat if the fill is also dim or colorless.
  overcast: { elevation: 58, azimuth: 40, key: { intensity: 0.9, color: '#f1f0ec' }, fill: { intensity: 1.5, color: '#d9dee6', ground: '#8b8a86' }, env: 0.3,
    tint: 1, backdrop: '#c8cdd4', shadow: { type: 'vsm', radius: 14, blurSamples: 16 } },
  // golden hour: a low warm key from the side, a cool fill -> long shadows, lit faces glow orange, shadows read blue, rims on round tops.
  golden: { elevation: 13, azimuth: 50, key: { intensity: 5, color: '#ffb877' }, fill: { intensity: 0.55, color: '#7f9fdc', ground: '#5c4d40' }, env: 0.1,
    tint: 1, backdrop: '#e6b98f', shadow: { type: 'pcf', radius: 2 } },
};
// sun direction overrides (?sun=...), same units as above
const DIRECTIONS = { front: [35, 0], side: [35, 90], back: [22, 165], low: [9, 60], top: [88, 0] };
// one shadow box fitted to this compact yard: 2048 px over +-12 m = 1.2 cm texels (the engine's open-world default +-70 m is 6.8 cm)
const SHADOW_FIT = { extent: 12, mapSize: 2048, bias: 2, normalBias: 0.02 };   // bias in centimeters here (converted below)
const CAMERA = { position: [5.5, 3.6, 7.2], lookAt: [0, 0.8, 0] };
// ------------------------------------------------------------------------------------------------------------------------------------------

const url = new URLSearchParams(location.search);
const routeName = url.get('route') ?? 'golden';
const route = ROUTES[routeName];
if (!route) throw new Error(`?route=${routeName}: use one of ${Object.keys(ROUTES).join(', ')}`);
const num = (/** @type {string} */ k, /** @type {number} */ d) => (url.has(k) ? Number(url.get(k)) : d);
const [elevation, azimuth] = url.has('sun') ? DIRECTIONS[/** @type {keyof typeof DIRECTIONS} */ (url.get('sun'))] ?? [route.elevation, route.azimuth] : [route.elevation, route.azimuth];
const tint = num('tint', route.tint);

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), ui: { loading: false }, saveKey: 'threedog-sun-key' });
// sky with a fixed time: it still owns the sun, hemisphere, fog and shadow box; the values below are layers on top of what it drives
engine.use(sky({ time: '12:00' }));
engine.use(fixedCamera({ position: CAMERA.position, lookAt: CAMERA.lookAt }));

// ---- key and fill: the override layer of look.lights (the sun is exactly this, whatever the keyframes say); keyLight.js ----
applyKeyFill(engine, route, { tint, owner: 'technique' });
// a flat backdrop in the fill color and fog that fades the ground into it: no dome gradient or sun disc at the wrong place
engine.look.sky.set({ backdrop: route.backdrop }, { owner: 'technique' });
engine.look.fog.set({ color: route.backdrop, far: 70 }, { owner: 'technique' });

// ---- sun direction: taken from the sky (it would follow the time of day) and aimed for the composition ----
const sunDir = aimSun(engine, { elevation, azimuth, camera: CAMERA.position });
const el = THREE.MathUtils.degToRad(elevation);

// ---- the shadow: one box fitted to the yard, centered on it (follow: false), filter from the route or the URL ----
const biasCm = num('bias', SHADOW_FIT.bias);
fitSunShadow(engine, {
  extent: num('extent', SHADOW_FIT.extent), biasCm, normalBias: SHADOW_FIT.normalBias, mapSize: SHADOW_FIT.mapSize, cascades: num('cascades', 1),
  type: url.get('shadow') ?? route.shadow.type, radius: num('radius', route.shadow.radius),
  ...(route.shadow.blurSamples ? { blurSamples: route.shadow.blurSamples } : {}), owner: 'technique',
});

// ---- the neutral gray scene (plain three.js) ----
const mat = (/** @type {number} */ c, roughness = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness });
const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ m, /** @type {number[]} */ [x, y, z]) => {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  engine.scene.add(mesh);
  return mesh;
};
const ground = add(new THREE.PlaneGeometry(160, 160), mat(0x8e8e8e, 0.95), [0, 0, 0]);
ground.rotation.x = -Math.PI / 2;
ground.castShadow = false;
add(new THREE.BoxGeometry(2, 2, 2), mat(0xb8b8b8), [-2.6, 1, -1.2]);                  // three faces: top / sun side / shade side read the form
add(new THREE.SphereGeometry(1, 48, 32), mat(0xc4c4c4, 0.6), [0.6, 1, -2.4]);          // a terminator: hard or soft depends on the route
add(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 40), mat(0xa8a8a8), [2.8, 0.7, -0.6]);
add(new THREE.CylinderGeometry(0.08, 0.08, 3, 12), mat(0x9a9a9a), [0, 1.5, 1.6]);      // the pole: its shadow length is the sun elevation
add(new THREE.CapsuleGeometry(0.28, 1.2, 8, 20), mat(0xbdbdbd), [-0.4, 0.88, 3.2]);   // figure height (1.76 m)
add(new THREE.BoxGeometry(0.1, 0.1, 0.1), mat(0xd0d0d0), [1.6, 0.05, 2.6]);           // small objects: lose their contact shadow when the bias is too large
add(new THREE.SphereGeometry(0.12, 24, 16), mat(0xd0d0d0), [2.1, 0.12, 2.2]);

// key:fill from the light numbers: a surface facing the sun gets key + fill, one in shadow only fill. The ground gets the key at sin(elevation),
// which is why a low sun darkens the ground and brightens the walls facing it. A rough guide only: the room environment adds more fill than its
// intensity number says, so the measured ratio is lower (README "Measured"); read the real one in a shot
const fillUp = route.fill.intensity + route.env;
const ratio = { ground: +((route.key.intensity * Math.sin(el) + fillUp) / fillUp).toFixed(2), facing: +((route.key.intensity + fillUp) / fillUp).toFixed(2) };
// the pole base: the spec walks from it away from the sun to measure the shadow length
const points = { poleBase: [0, 0, 1.6] };
Object.assign(window, { engine, sunTest: { THREE, route: routeName, elevation, azimuth, sunDir, ratio, points, biasCm } });
engine.start();
