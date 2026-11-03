// Cascaded shadows on WebGPURenderer page (tests/specs/cascades-webgpu.mjs): the sky's look.shadow.set({ cascades: 3 }) on the WebGPU route
// becomes three's CSMShadowNode on the sun (modules/sky/cascades.tsl.js). A game's MeshStandardMaterial and a MeshStandardNodeMaterial stand
// side by side on the ground with a box casting onto both. Why both kinds: WebGPURenderer turns the plain material into a node material
// itself, and either one must be lit by the sun once (the WebGL design lights an unpatched material once per cascade light).
// Why a module that takes the dome out: the sky dome is still a GLSL ShaderMaterial (its TSL version is a separate step), and the WebGPU
// route refuses that by name at start(); the shadows do not need the dome.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';   // what a WebGPU game imports first (registers cascades.tsl.js among others)
import { createEngine, sky } from '../../index.js';
import { renderOnce } from '../../render/backend.js';
import { materialPatches } from '../../render/patches.js';

const W = 200, H = 150;
const renderer = new TG.WebGPURenderer({ canvas: document.getElementById('view'), antialias: false, forceWebGL: true });
renderer.shadowMap.enabled = true;   // a game's own renderer is configured by the game (the engine sets up only renderers it built)
const noDome = { name: 'test-no-dome', type: 'rules', install(e) { e.sky.dome.removeFromParent(); return {}; } };
const engine = window.engine = createEngine({ renderer, pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, saveKey: 'test-cascades-webgpu', urlState: false });
engine.use(sky({ time: '10:00' }), noDome);

// the game's own materials: a plain one (three converts it) and a node one, the same color; a box casts onto both
const std = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.9 });
const node = new TG.MeshStandardNodeMaterial({ color: 0xc8c8c8, roughness: 0.9 });
const half = new THREE.PlaneGeometry(8, 16).rotateX(-Math.PI / 2);
const left = new THREE.Mesh(half, std), right = new THREE.Mesh(half, node);
left.position.set(-4, 0, 0); right.position.set(4, 0, 0);
left.receiveShadow = right.receiveShadow = true;
const box = new THREE.Mesh(new THREE.BoxGeometry(2, 5, 2), new THREE.MeshStandardMaterial({ color: 0x808080 }));
box.position.set(0, 2.5, 0); box.castShadow = true; box.userData.budgetTag = 'caster';
engine.scene.add(left, right, box);
await engine.start();
engine.pause();

const cam = engine.camera;
const rt = new TG.RenderTarget(W, H);
/** one engine frame (sky places the sun / cascades), then the scene drawn into rt and read back */
async function shot() {
  cam.position.set(0, 7, 11); cam.lookAt(0, 0, 0); cam.aspect = W / H; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  engine.step(1 / 30, { describe: false });
  renderOnce(renderer, engine.scene, cam, rt);
  return new Uint8Array(await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H));
}
/** mean brightness (0-255) of the screen spot where world point p lands */
const spot = (b, p) => {
  const v = new THREE.Vector3(...p).project(cam), cx = Math.round((v.x + 1) / 2 * W), cy = Math.round((v.y + 1) / 2 * H);
  let s = 0, n = 0;
  for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) { const k = (y * W + x) * 4; s += b[k] + b[k + 1] + b[k + 2]; n += 3; }
  return +(s / n).toFixed(2);
};
const changed = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) d++; return +(100 * d / (W * H)).toFixed(2); };
// lit ground away from the box's shadow: one spot on each material (near the camera, so cascade 0)
const LIT_STD = [-3, 0, 4], LIT_NODE = [3, 0, 4];
const lights = () => { let n = 0; engine.scene.traverse(o => { if (o.isLight && o.isDirectionalLight) n++; }); return n; };

window.cascadesWebGPU = async () => {
  const out = { backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2' };
  const S = engine.sky, sun = engine.lights.sun;
  engine.look.shadow.set({ cascades: 1 });
  await shot(); const one = await shot();
  out.one = { std: spot(one, LIT_STD), node: spot(one, LIT_NODE) };
  const casterCalls = () => engine.budget.byTag().find(t => t.tag === 'caster')?.drawCalls;
  out.budget = { one: casterCalls() };
  // the measure can tell "lit twice": a second light like the sun brightens the same spots
  const twin = sun.clone(); twin.castShadow = false; engine.scene.add(twin, twin.target); twin.target.position.copy(sun.target.position);
  const two = await shot(); twin.removeFromParent(); twin.target.removeFromParent();
  out.twice = { std: spot(two, LIT_STD), node: spot(two, LIT_NODE) };

  engine.look.shadow.set({ cascades: 3 });
  await shot(); await shot(); const three = await shot();
  out.three = { std: spot(three, LIT_STD), node: spot(three, LIT_NODE) };
  // the budget counts a shadow pass per cascade map (one light here: counting lights saw one); photo mode's size reaches every cascade
  out.budget.three = casterCalls();
  const size0 = sun.shadow.mapSize.x;
  S.setShadowMapSize(1024); await shot();
  out.mapSize = { cascades: S.csm.lights.map(l => l.shadow.mapSize.x), sun: sun.shadow.mapSize.x, drawn: S.csm.lights.map(l => l.shadow.map?.width ?? null) };
  S.setShadowMapSize(size0); await shot();
  out.mapSize.back = S.csm.lights.map(l => l.shadow.mapSize.x);
  out.ratio = { std: +(out.three.std / out.one.std - 1).toFixed(4), node: +(out.three.node / out.one.node - 1).toFixed(4) };
  out.csm = { node: !!S.csm?.isSkyCascadeNode, onSun: sun.shadow.shadowNode === S.csm, cascades: S.csm?.lights.length, dirLights: lights(),
    far: sun.shadow.camera.far, cascadeFar: S.csm?.lights.map(l => l.shadow.camera.far) };
  // the shadow is really there: the same frame with the box not casting
  box.castShadow = false;
  await shot(); const noCast = await shot();
  box.castShadow = true;
  out.shadow = { changed: changed(three, noCast) };
  // nothing patched, nothing listed as owned
  // plain lit materials take the cloud shadow (render/terms.js: world + clouds); the check is that nothing csm-like is patched on WebGPU
  const notClouds = m => materialPatches(m).filter(n => n !== 'world' && n !== 'clouds').join();
  out.patches = { std: notClouds(std), node: notClouds(node), box: notClouds(box.material) };
  out.owned = Object.keys(engine.describe().owned ?? {}).filter(k => k.includes('csm'));
  // include() is a no-op on WebGPU, with one hint
  const warns = [], warn = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); warn(...a); };
  try { out.include = { same: engine.look.shadow.include(std) === std }; } finally { console.warn = warn; }
  out.include.warned = warns.some(w => w.includes('does nothing on WebGPURenderer'));
  // shadow.updateEvery 3: the per-light switch reaches the cascades, and a request does not stay pending forever (the sun's own map is never drawn)
  engine.look.shadow.set({ updateEvery: 3 });
  await shot();
  // no scene walk per frame: the cascades' early update and the shadow redraw switch read the tracked shadow lights (render/backend.js
  // shadowLights), so the frames below call scene.traverse / traverseVisible zero times (count the scene's own calls, not three's internals)
  const walks = { n: 0 }, tr = engine.scene.traverse, tv = engine.scene.traverseVisible;
  engine.scene.traverse = function (...a) { walks.n++; return tr.apply(this, a); };
  engine.scene.traverseVisible = function (...a) { walks.n++; return tv.apply(this, a); };
  try { await shot(); await shot(); await shot(); } finally { delete engine.scene.traverse; delete engine.scene.traverseVisible; }
  out.every = { auto: S.csm.lights.map(l => l.shadow.autoUpdate), sunAuto: sun.shadow.autoUpdate, walks: walks.n };
  engine.look.shadow.set({ updateEvery: 1 });
  // off again: the plain sun shadow is back, no node, stand-in lights gone
  const standIns = S.csm.lights.slice();
  engine.look.shadow.set({ cascades: 1 });
  await shot(); const back = await shot();
  out.off = { csm: S.csm, node: sun.shadow.shadowNode === undefined, gone: standIns.every(l => !l.parent), far: sun.shadow.camera.far,
    std: spot(back, LIT_STD), sameAsOne: changed(one, back) };
  return out;
};
window.ready = true;
