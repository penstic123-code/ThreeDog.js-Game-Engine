// Pure-visual bulk on the GPU (recipes/65-swarm.md "Pure picture: GPU compute"): 100k snowflakes in a TSL compute shader, no engine API, no CPU array.
// The middle of this file is the recipe's example (only COUNT comes from the URL). window.snowCheck() reads the buffer back to prove the GPU moved every flake
// (tests/specs/compute-snow.mjs). 100k on real WebGPU: node packages/tools/real-webgpu.mjs --urls=/tests/compute-snow/index.html --eval=<file holding: window.snowCheck()>
import 'threedog/tsl';
import { Sprite, SpriteNodeMaterial } from 'three/webgpu';
import { Fn, If, float, hash, instanceIndex, instancedArray, uniform, vec3 } from 'three/tsl';
import { createEngine } from '../../index.js';

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const engine = window.engine = createEngine({ canvas, renderer: 'webgpu', pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, urlState: false, saveKey: 'test-compute-snow' });
await engine.start();
engine.camera.position.set(0, 12, 50);
engine.camera.lookAt(0, 12, 0);

const COUNT = Number(new URLSearchParams(location.search).get('count') ?? 100000), HALF = 40, TOP = 30;   // the recipe: 100000. ?count= keeps the suite's software run short
const flakes = instancedArray(COUNT, 'vec3'), dt = uniform(0);

const seed = Fn(() => {
  const p = flakes.element(instanceIndex), i = float(instanceIndex);
  p.assign(vec3(hash(i).sub(0.5).mul(HALF * 2), hash(i.add(0.31)).mul(TOP), hash(i.add(0.67)).sub(0.5).mul(HALF * 2)));
})().compute(COUNT);

const fall = Fn(() => {
  const p = flakes.element(instanceIndex), speed = hash(float(instanceIndex)).mul(2).add(1);
  p.y.subAssign(speed.mul(dt));
  If(p.y.lessThan(0), () => { p.y.addAssign(TOP); });
})().compute(COUNT);

const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
material.positionNode = flakes.toAttribute();
material.scaleNode = float(0.08);
material.colorNode = vec3(1);
const snow = new Sprite(material);
snow.count = COUNT;
snow.frustumCulled = false;   // the sprite's own bounds know nothing of the flakes
engine.scene.add(snow);

const gpu = /** @type {any} */ (engine.renderer);   // a WebGPURenderer: the engine's type also covers WebGL
await gpu.computeAsync(seed);
engine.onFrame(d => { dt.value = engine.frozen ? 0 : d; });
engine.onRender(() => { gpu.compute(fall); });

/** Flake heights straight from the GPU buffer */
async function heights() {
  const a = new Float32Array(await gpu.getArrayBufferAsync(flakes.value)), stride = a.length / COUNT, out = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) out[i] = a[i * stride + 1];
  return out;
}
window.snowCheck = async () => {
  const a = await heights();
  await window.__t.frames(30);
  const b = await heights(), queue = gpu.backend.isWebGPUBackend ? gpu.backend.device.queue : null;
  let moved = 0, inside = 0;
  for (let i = 0; i < COUNT; i++) { if (a[i] !== b[i]) moved++; if (b[i] >= 0 && b[i] <= TOP) inside++; }
  const frozen = engine.freeze('test');
  await window.__t.frames(3);
  const c = await heights();
  await window.__t.frames(10);
  const d = await heights();
  let still = 0;
  for (let i = 0; i < COUNT; i++) if (c[i] === d[i]) still++;
  frozen.remove?.(); engine.unfreeze?.('test');
  // cost of a frame: draw plus compute, waiting for the GPU
  engine.haltLoop();
  const ms = [];
  for (let i = 0; i < 60; i++) { const t = performance.now(); engine.step(1 / 60, { describe: false }); await queue?.onSubmittedWorkDone(); ms.push(performance.now() - t); }   // measure
  ms.sort((x, y) => x - y);
  return { backend: engine.describe().renderer.backend, count: COUNT, moved, inside, still, frameMs: +ms[30].toFixed(2) };
};
