// @ts-check
// WebGPU + TSL demo (page /webgpu-tsl.html): a field with grass and a lantern, every material a three.js NodeMaterial written in TSL, written the
// way a game's main.js would be (imports from 'threedog', not engine-internal paths). Shapes only here; the whole picture is picture/.
// URL: ?time=0..1 (fixed time of day, default 0.72: late afternoon, the lantern starting to glow) &webgl2 (the game's own WebGPURenderer on
// its WebGL2 backend: how the test runs it, the same on every machine) &scanlines=0 (no post effect).
// Test page for tests/specs/webgpu-tsl.mjs: window.webgpuTslTest = { parts, picture, THREE }.
import 'threedog/tsl';   // first: the WebGPU route's node versions of the engine's sky, post chain and patches register here
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createEngine, sky, fixedCamera } from 'threedog';
import { createPicture } from './picture/index.js';

const SIZE = 40;      // m, side of the square ground
const BLADES = 1500;  // one InstancedMesh: one draw call however many

const url = new URLSearchParams(location.search), canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
// 'webgpu': the engine builds the WebGPURenderer and falls back to its WebGL2 backend when the browser has no WebGPU (said once in the console)
const renderer = url.has('webgl2') ? new WebGPURenderer({ canvas, antialias: true, forceWebGL: true }) : 'webgpu';
const engine = createEngine({ canvas, renderer, lights: false, ui: { loading: false }, saveKey: 'threedog-webgpu-tsl' });
engine.use(sky({ time: Number(url.get('time') ?? 0.72) }),
  fixedCamera({ shots: { field: { position: [6, 2.2, 9], lookAt: [0, 0.8, 0] } }, start: 'field' }));
const picture = createPicture(engine), { mat } = picture;
if (url.get('scanlines') === '0') picture.scanlines.value = 0;

const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2), mat.ground);
ground.receiveShadow = true;
ground.name = 'ground';

// one blade shape drawn many times; instances are only moved, which is what the grass material's wind offset expects
const blade = new THREE.PlaneGeometry(0.07, 0.5, 1, 3).translate(0, 0.25, 0);
const grass = new THREE.InstancedMesh(blade, mat.grass, BLADES);
const m = new THREE.Matrix4(), r = engine.random, half = SIZE * 0.45;
for (let i = 0; i < BLADES; i++) grass.setMatrixAt(i, m.makeTranslation(r.range(-half, half), 0, r.range(-half, half)));
grass.castShadow = true;
grass.name = 'grass';

const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 1), mat.lantern);
lantern.position.set(0, 1.2, 0);
lantern.castShadow = true;
lantern.name = 'lantern';

engine.scene.add(ground, grass, lantern);
Object.assign(window, { engine, webgpuTslTest: { parts: { ground, grass, lantern }, picture, THREE } });   // the dev bridge and the test find the engine here
await engine.start();
