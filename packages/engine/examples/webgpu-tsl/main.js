// @ts-check
// WebGPU + TSL demo (page /webgpu-tsl.html): the scene of tslScene.js with the engine's sky, written the way a game's main.js would be
// (imports from 'threedog', not engine-internal paths), so what runs here is what runs after `threedog examples pull webgpu-tsl`.
// URL: ?time=0..1 (fixed time of day, default 0.72: late afternoon, the lantern starting to glow) &webgl2 (the game's own WebGPURenderer on
// its WebGL2 backend: how the test runs it, the same on every machine) &scanlines=0 (no post effect).
// Test page for tests/specs/webgpu-tsl.mjs: window.webgpuTslTest = { parts, THREE }.
import 'threedog/tsl';   // first: the WebGPU route's node versions of the engine's sky, post chain and patches register here
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { createEngine, sky, fixedCamera } from 'threedog';
import { createTslScene } from './tslScene.js';

const url = new URLSearchParams(location.search), canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
// 'webgpu': the engine builds the WebGPURenderer and falls back to its WebGL2 backend when the browser has no WebGPU (said once in the console)
const renderer = url.has('webgl2') ? new WebGPURenderer({ canvas, antialias: true, forceWebGL: true }) : 'webgpu';
const engine = createEngine({ canvas, renderer, ui: { loading: false }, saveKey: 'threedog-webgpu-tsl' });
engine.use(sky({ time: Number(url.get('time') ?? 0.72) }),
  fixedCamera({ shots: { field: { position: [6, 2.2, 9], lookAt: [0, 0.8, 0] } }, start: 'field' }));
const parts = createTslScene(engine, url.get('scanlines') === '0' ? { scanlines: 0 } : {});
Object.assign(window, { engine, webgpuTslTest: { parts, THREE } });   // the dev bridge and the test find the engine here
await engine.start();
