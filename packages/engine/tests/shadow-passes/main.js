// Shadow passes per frame with a post effect that draws the scene again (tests/specs/shadow-passes.mjs). three redraws every shadow map in each
// renderer.render() while shadow autoUpdate is on, and on WebGL ao (GTAOPass) renders the scene once more for its normals: that was two redraws a
// frame until render/postWebGL.js turned redraws off after the scene pass. Counted on both renderers with ao off / on, plus a redraw every third
// frame (needsUpdate, as sky's shadow.updateEvery asks) with ao on, which must still happen. Frame times are software rendering: relative only.
import * as THREE from 'three';
import 'threedog/tsl';
import { ao } from '@threedog/post-effects';
import { createEngine } from '../../index.js';
import { setShadowUpdate } from '../../render/backend.js';

const W = 320, H = 240, FRAMES = 12;
const base = { pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, urlState: false };
const canvas = () => { const c = Object.assign(document.createElement('canvas'), { width: W, height: H }); c.style.cssText = `width:${W}px;height:${H}px`; document.body.appendChild(c); return c; };
const engine = window.engine = createEngine({ canvas: canvas(), ...base, lights: false, saveKey: 'test-shadow-passes' });
await engine.start();
engine.pause();

/** Ground and a grid of casting boxes under the baseline sun, shadows on */
function fill(e) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb0b0b0 }));
  ground.receiveShadow = true; e.scene.add(ground);
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1 + ((x + z) & 3), 0.8), new THREE.MeshStandardMaterial({ color: 0x8090a0 }));
    b.position.set(x * 2, 0.5, z * 2); b.castShadow = b.receiveShadow = true; e.scene.add(b);
  }
  e.lights.sun.castShadow = true;
  e.camera.position.set(0, 12, 18); e.camera.lookAt(0, 0, 0);
}

/** Shadow-map redraws per frame: WebGL counts WebGLShadowMap.render calls that draw (enabled, an update due, a caster light);
 *  WebGPU counts renderer.render calls whose camera is a light's shadow camera (ShadowNode.updateShadow draws that way) */
function counter(r, scene) {
  const c = { n: 0 };
  if (!r.isWebGPURenderer) {
    const sm = r.shadowMap, orig = sm.render;
    sm.render = function (lights, ...rest) { if (sm.enabled && (sm.autoUpdate || sm.needsUpdate) && lights.length) c.n++; return orig.call(this, lights, ...rest); };
    c.undo = () => { sm.render = orig; };
    return c;
  }
  const orig = r.render;
  r.render = function (s, cam) {
    let shadowCam = false;
    scene.traverse(o => { if (o.isLight && o.shadow && (o.shadow.camera === cam || o.shadow.shadowNode?.lights?.some(l => l.shadow.camera === cam))) shadowCam = true; });
    if (shadowCam) c.n++;
    return orig.apply(this, arguments);
  };
  c.undo = () => { r.render = orig; };
  return c;
}

// one canvas pixel read after each frame waits for the GPU (software rasterizer here), so the time holds the drawing, not only its submission
const sink = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
const settle = e => { sink.drawImage(e.renderer.domElement, 0, 0, 1, 1); sink.getImageData(0, 0, 1, 1); };
/** FRAMES engine frames: shadow redraws per frame and ms per frame including the GPU (after two warm-up frames) */
function measure(e) {
  for (let i = 0; i < 2; i++) { e.step(1 / 60, { describe: false }); settle(e); }
  const c = counter(e.renderer, e.scene), t0 = performance.now();
  for (let i = 0; i < FRAMES; i++) { e.step(1 / 60, { describe: false }); settle(e); }
  const ms = (performance.now() - t0) / FRAMES;
  c.undo();
  return { perFrame: +(c.n / FRAMES).toFixed(2), ms: +ms.toFixed(1) };
}

async function run(opts) {
  const e = createEngine({ canvas: canvas(), ...base, saveKey: `test-shadow-passes-${opts.renderer ?? 'webgl'}`, ...opts });
  fill(e);
  await e.start();
  e.pause();
  const out = { backend: e.describe().renderer.backend };
  out.off = measure(e);
  e.post.add(ao({ enabled: true }));
  out.ao = measure(e);
  // every third frame on request: the scene pass must still use up the request although the passes after it hold redraws
  setShadowUpdate(e.renderer, e.scene, { auto: false });
  const c = counter(e.renderer, e.scene);
  for (let i = 0; i < FRAMES; i++) { if (i % 3 === 0) setShadowUpdate(e.renderer, e.scene, { now: true }); e.step(1 / 60, { describe: false }); }
  c.undo();
  out.every3 = { redraws: c.n, frames: FRAMES };
  setShadowUpdate(e.renderer, e.scene, { auto: true });
  out.autoAfter = e.renderer.isWebGPURenderer ? null : e.renderer.shadowMap.autoUpdate;
  e.dispose();
  return out;
}

window.shadowPasses = async () => ({ webgl: await run({}), webgpu: await run({ renderer: 'webgpu' }) });
