// Uniform refresh page (tests/specs/uniform-refresh.mjs): values the engine's TSL nodes read back every render must still reach the GPU many
// frames after the first draw, on a material that has no node property of its own.
// Why: three 0.187's NodeMaterialObserver refreshes a render object's object-group uniforms only while the material has a node property
// (colorNode...) or the object changed; a plain MeshBasicNodeMaterial with a 'color' / 'output' / 'lighting' patch (code inside three's setup
// methods, not a property) is refreshed for its shared groups only after the first draw. A value read back in the object group then freezes:
// the GLSL side moves, the WebGPU side keeps the first frame's picture.
// Each case: the same patch on a WebGL material and on its NodeMaterial twin, a few frames drawn, the value changed, a few more frames drawn;
// both pictures must have moved, and agree with each other.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';
import { createEngine, sky } from '../../index.js';
import { patchMaterial } from '../../render/patches.js';
import { bindUniforms } from '../../render/engineUniforms.js';
import { makeDome } from '../../modules/sky/shader.js';
import { DOME_FOG } from '../../modules/sky/fog.js';

const W = 64, H = 48;
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), lights: false, pixelRatio: 1, adaptiveResolution: false,
  ui: { loading: false }, saveKey: 'test-uniform-refresh', urlState: false });
engine.use(sky({ time: 0.4 }));
await engine.start();
engine.haltLoop();
const U = engine.uniforms;

const canvas = () => Object.assign(document.createElement('canvas'), { width: W, height: H });
const look = r => { r.setPixelRatio(1); r.setSize(W, H, false); r.toneMapping = THREE.NoToneMapping; r.outputColorSpace = THREE.LinearSRGBColorSpace; return r; };
const gl = look(new THREE.WebGLRenderer({ canvas: canvas(), antialias: false }));
bindUniforms(gl, U);
const gpu = look(new TG.WebGPURenderer({ canvas: canvas(), antialias: false, forceWebGL: true }));
await gpu.init();
bindUniforms(gpu, U);
const glRT = new THREE.WebGLRenderTarget(W, H), gpuRT = new TG.RenderTarget(W, H);
const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 100); cam.position.set(0, 0, 3); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();

const shot = async (r, scene) => {
  if (r === gl) { gl.setRenderTarget(glRT); gl.setClearColor(0, 1); gl.render(scene, cam); const b = new Uint8Array(W * H * 4);
    gl.readRenderTargetPixels(glRT, 0, 0, W, H, b); gl.setRenderTarget(null); return b; }
  gpu.setRenderTarget(gpuRT); gpu.setClearColor(0, 1); gpu.render(scene, cam);
  const b = new Uint8Array(await gpu.readRenderTargetPixelsAsync(gpuRT, 0, 0, W, H)); gpu.setRenderTarget(null); return b;
};
const mean = b => { let s = 0; for (let i = 0; i < b.length; i += 4) s += (b[i] + b[i + 1] + b[i + 2]) / 3; return s / (W * H); };
/** n frames, the last one read back */
const frames = async (r, scene, n) => { let b; for (let i = 0; i < n; i++) b = await shot(r, scene); return mean(b); };
const quad = m => { const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.PlaneGeometry(4, 4), m)); return s; };

// one { value } of the patch's own, one engine number, one engine Color: the three kinds of read-back value the TSL side has
const own = { value: 1 };
const CASES = {
  // 'color' slot: code inside setupDiffuseColor, so the node material has no node property
  ownNumber: { set: v => { own.value = v; }, from: 1, to: 0.3,
    patch: { name: 'k', slot: 'color', uniforms: { uRefreshK: own }, pars: 'uniform float uRefreshK;', glsl: 'diffuseColor.rgb *= uRefreshK;',
      tsl: c => c.tsl.vec4(c.color.rgb.mul(c.fx.patchUniform(own)), c.color.a) } },
  engineNumber: { set: v => { U.uWeatherCloud.value = v; }, from: 1, to: 0.25,
    patch: { name: 'cloud', slot: 'color', uniforms: { uWeatherCloud: U.uWeatherCloud }, pars: 'uniform float uWeatherCloud;', glsl: 'diffuseColor.rgb *= uWeatherCloud;',
      tsl: c => c.tsl.vec4(c.color.rgb.mul(c.fx.uniform('uWeatherCloud')), c.color.a) } },
  engineColor: { set: v => { U.uFoliageTint.value.setScalar(v); }, from: 1, to: 0.2,
    patch: { name: 'tint', slot: 'color', uniforms: { uFoliageTint: U.uFoliageTint }, pars: 'uniform vec3 uFoliageTint;', glsl: 'diffuseColor.rgb *= uFoliageTint;',
      tsl: c => c.tsl.vec4(c.color.rgb.mul(c.fx.uniform('uFoliageTint')), c.color.a) } },
  // 'map' slot: becomes colorNode (a node property), the control case three refreshes anyway
  mapSlot: { set: v => { own.value = v; }, from: 1, to: 0.4,
    patch: { name: 'kmap', slot: 'map', uniforms: { uRefreshK: own }, pars: 'uniform float uRefreshK;', glsl: 'diffuseColor.rgb *= uRefreshK;',
      tsl: c => c.map.mul(c.fx.patchUniform(own)) } },
};

window.uniformRefresh = async () => {
  const out = {};
  for (const [name, c] of Object.entries(CASES)) {
    c.set(c.from);
    const mg = new THREE.MeshBasicMaterial({ color: 0xc0c0c0 }), mw = new TG.MeshBasicNodeMaterial({ color: 0xc0c0c0 });
    patchMaterial(mg, [c.patch]); patchMaterial(mw, [c.patch]);
    const sg = quad(mg), sw = quad(mw);
    const before = [await frames(gl, sg, 3), await frames(gpu, sw, 3)];
    c.set(c.to);
    const after = [await frames(gl, sg, 4), await frames(gpu, sw, 4)];
    c.set(c.from);
    out[name] = { before: before.map(v => +v.toFixed(2)), after: after.map(v => +v.toFixed(2)),
      moved: [+(before[0] - after[0]).toFixed(2), +(before[1] - after[1]).toFixed(2)],
      diff: +(100 * Math.abs(after[0] - after[1]) / Math.max(1e-6, after[0])).toFixed(2) };
  }
  // the sky dome's own uniforms (sky.uniforms, read back each render by render/fx/sky.tsl.js) on its node material, changed after a few frames
  {
    const S = engine.sky, dg = new THREE.Scene(), dw = new THREE.Scene();
    dg.add(makeDome(S.uniforms, {}, DOME_FOG)); dw.add(makeDome(S.uniforms, {}, DOME_FOG, { renderer: gpu, uniforms: U }));
    const top = S.uniforms.uTop.value.clone(), hz = S.uniforms.uHorizon.value.clone();
    S.uniforms.uTop.value.setRGB(0.8, 0.8, 0.8); S.uniforms.uHorizon.value.setRGB(0.8, 0.8, 0.8);
    const before = [await frames(gl, dg, 3), await frames(gpu, dw, 3)];
    S.uniforms.uTop.value.setRGB(0.1, 0.1, 0.1); S.uniforms.uHorizon.value.setRGB(0.1, 0.1, 0.1);
    const after = [await frames(gl, dg, 4), await frames(gpu, dw, 4)];
    S.uniforms.uTop.value.copy(top); S.uniforms.uHorizon.value.copy(hz);
    out.skyDome = { before: before.map(v => +v.toFixed(2)), after: after.map(v => +v.toFixed(2)),
      moved: [+(before[0] - after[0]).toFixed(2), +(before[1] - after[1]).toFixed(2)],
      diff: +(100 * Math.abs(after[0] - after[1]) / Math.max(1e-6, after[0])).toFixed(2) };
  }
  return out;
};
