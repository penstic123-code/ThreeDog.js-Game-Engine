// Particles / weather on both renderers (tests/specs/fx-particles.mjs): the real engine code (modules/particles Effect, modules/weather makeSystem)
// built once against WebGLRenderer (ShaderMaterial + Points / LineSegments) and once against WebGPURenderer on its WebGL2 backend (sprite quads +
// node materials from render/fx/particles.tsl.js), same seed, same camera, same moment.
// Why compare means, not pixels: a point sprite and an instanced quad rasterize their edges differently, so per-pixel equality is not expected;
// the data (count, positions) must match exactly and the pictures must agree in brightness and in where the particles are (lit-pixel centroid).
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';
import { createEngine } from '../../index.js';
import { bindUniforms } from '../../render/engineUniforms.js';
import { swapWebGPUPart } from '../../render/backend.js';
import { Particles } from '../../modules/particles/Particles.js';
import { makeSystem, updateSystem, RAIN, SNOW } from '../../modules/weather/particles.js';

const W = 200, H = 150;
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), lights: false, pixelRatio: 1, adaptiveResolution: false,
  ui: { loading: false }, saveKey: 'test-fx-particles', urlState: false });
await engine.start();
engine.haltLoop();

const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 200); cam.position.set(0, 2, 7); cam.lookAt(0, 1.5, 0); cam.updateMatrixWorld();
const canvas = () => Object.assign(document.createElement('canvas'), { width: W, height: H });
const gl = new THREE.WebGLRenderer({ canvas: canvas(), antialias: false });
gl.setPixelRatio(1); gl.setSize(W, H, false); gl.toneMapping = THREE.NoToneMapping; gl.outputColorSpace = THREE.LinearSRGBColorSpace;
const gpu = new TG.WebGPURenderer({ canvas: canvas(), antialias: false, forceWebGL: true });
gpu.setPixelRatio(1); gpu.setSize(W, H, false); gpu.toneMapping = THREE.NoToneMapping; gpu.outputColorSpace = THREE.LinearSRGBColorSpace;
await gpu.init();
bindUniforms(gpu, engine.uniforms);   // what the engine will do for its own WebGPURenderer (step 2); a hand-made one stands in here
const glRT = new THREE.WebGLRenderTarget(W, H), gpuRT = new TG.RenderTarget(W, H);

/** A stand-in engine around one renderer and its own scene: what Effect / makeSystem read (renderer, camera, scene, add / remove, tier, uniforms) */
const host = renderer => {
  const scene = new THREE.Scene();
  return { renderer, scene, camera: cam, tier: 'high', uniforms: engine.uniforms, assets: engine.assets,
    add(o) { scene.add(o); return o; }, remove(o) { scene.remove(o); o.geometry?.dispose(); o.material?.dispose(); } };
};
const HGL = host(gl), HGPU = host(gpu);

const shot = async h => {
  if (h.renderer === gl) { gl.setRenderTarget(glRT); gl.setClearColor(0, 1); gl.render(h.scene, cam); const b = new Uint8Array(W * H * 4);
    gl.readRenderTargetPixels(glRT, 0, 0, W, H, b); gl.setRenderTarget(null); return b; }
  gpu.setRenderTarget(gpuRT); gpu.setClearColor(0, 1); gpu.render(h.scene, cam);
  const b = new Uint8Array(await gpu.readRenderTargetPixelsAsync(gpuRT, 0, 0, W, H)); gpu.setRenderTarget(null); return b;
};
/** mean brightness (0..255), lit share, lit-pixel centroid */
const stats = b => {
  let sum = 0, n = 0, cx = 0, cy = 0, ws = 0;
  for (let i = 0; i < W * H; i++) { const v = (b[i * 4] + b[i * 4 + 1] + b[i * 4 + 2]) / 3; sum += v; if (v > 8) { n++; ws += v; cx += (i % W) * v; cy += Math.floor(i / W) * v; } }
  const wsum = Math.max(1e-6, ws);
  return { mean: sum / (W * H), lit: n / (W * H), cx: cx / wsum, cy: cy / wsum };
};
/** the two pictures compared: relative mean difference (%), mean absolute pixel difference (% of 255), centroid distance (px) */
const compare = (a, b) => {
  const A = stats(a), B = stats(b);
  let abs = 0; for (let i = 0; i < a.length; i += 4) abs += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return { meanDiff: +(100 * Math.abs(A.mean - B.mean) / Math.max(1e-6, A.mean)).toFixed(2), absDiff: +(100 * abs / (W * H * 3 * 255)).toFixed(3),
    centroid: +Math.hypot(A.cx - B.cx, A.cy - B.cy).toFixed(2), mean: +A.mean.toFixed(2), lit: +A.lit.toFixed(3) };
};
/** share of pixels that changed between two shots of one renderer, in % */
const moved = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++; return +(100 * n / (W * H)).toFixed(2); };

/** Run fn with Math.random replaced by a seeded generator (mulberry32): both sides get the same scatter */
function seeded(seed, fn) {
  const r = Math.random; let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = r; }
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

window.fxParticles = async () => {
  const out = { particles: {}, weather: {}, errors: {} };
  // ---- particles: one effect per blending, emitted from the same seed, aged the same, then aged again (the "time" of a particle system)
  const PGL = new Particles(HGL), PGPU = new Particles(HGPU);
  const DEFS = {
    puff: { max: 80, lifetime: [3, 4], speed: [0.6, 1.4], spread: Math.PI, gravity: 0.3, drag: 0.3, size: [0.5, 1.1], color: [0xffcc88, 0x8899ff], opacity: [0.9, 0.2] },
    sparks: { max: 60, lifetime: [3, 4], speed: [1, 2], spread: 1.2, gravity: -0.4, size: [0.25, 0.15], color: [0xffaa33, 0xff3300], opacity: [1, 0.4], blending: 'additive', spin: 2 },
  };
  for (const [name, def] of Object.entries(DEFS)) {
    for (const P of [PGL, PGPU]) { P.define(name, def); seeded(7, () => P.emit(name, [0, 1.5, 0], { count: 50 })); P.update(0.4); }
    const a = await shot(HGL), b = await shot(HGPU);
    const fa = PGL.effects.get(name), fb = PGPU.effects.get(name);
    const r = { count: [PGL.count(name), PGPU.count(name)], samePos: same(fa.aPos.array, fb.aPos.array) && same(fa.aSize.array, fb.aSize.array) && same(fa.aAlpha.array, fb.aAlpha.array),
      kinds: [fa.points.type, fb.points.type, fb.material.type], instances: fb.points.count, ...compare(a, b) };
    for (const P of [PGL, PGPU]) P.update(0.5);
    const a2 = await shot(HGL), b2 = await shot(HGPU);
    r.later = { moved: [moved(a, a2), moved(b, b2)], samePos: same(fa.aPos.array, fb.aPos.array), ...compare(a2, b2) };
    out.particles[name] = r;
    for (const P of [PGL, PGPU]) P.clear(name);
  }
  // ---- fog on, both blendings, into a linear target (where the engine draws whenever post is on): the WebGL shader mixes the fog after its
  // tone-mapping / color-space chunks, which do nothing in a linear target, so both sides mix in linear and must agree.
  // Logged only, the canvas with a tone curve + sRGB output (no post): there WebGL blends transparent pixels on the sRGB-encoded canvas and
  // WebGPU in its linear frame buffer, a difference of every transparent material and present without fog (canvasNoFog), so it is no fog parity bound
  const canvasShot = h => {
    const r = h.renderer, tm = r.toneMapping, cs = r.outputColorSpace;
    r.toneMapping = THREE.AgXToneMapping; r.outputColorSpace = THREE.SRGBColorSpace; r.setClearColor(0, 1);
    r.render(h.scene, cam);
    const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(r.domElement, 0, 0);
    r.toneMapping = tm; r.outputColorSpace = cs;
    return x.getImageData(0, 0, W, H).data;
  };
  out.fog = {};
  for (const name of Object.keys(DEFS)) {
    for (const P of [PGL, PGPU]) { seeded(7, () => P.emit(name, [0, 1.5, 0], { count: 50 })); P.update(0.4); }
    const plainGL = stats(await shot(HGL)).mean;
    for (const h of [HGL, HGPU]) h.scene.fog = new THREE.Fog(0x8899aa, 2, 10);   // the puff sits 7 m away: about 60% fog
    const a = await shot(HGL), b = await shot(HGPU), A = stats(a), B = stats(b);
    out.fog[name] = { ...compare(a, b), fogGL: +(100 * Math.abs(A.mean - plainGL) / Math.max(1e-6, plainGL)).toFixed(2), gpuMean: +B.mean.toFixed(2),
      canvas: compare(canvasShot(HGL), canvasShot(HGPU)).meanDiff };
    for (const h of [HGL, HGPU]) h.scene.fog = null;
    out.fog[name].canvasNoFog = compare(canvasShot(HGL), canvasShot(HGPU)).meanDiff;
    for (const P of [PGL, PGPU]) P.clear(name);
  }
  // ---- weather: built-in rain (lines) and snow (sprites), same scatter seed, then time moved on (uFallOff / uSway from t)
  for (const [field, base] of [['rain', RAIN], ['snow', SNOW]]) {
    const [sa, sb] = [HGL, HGPU].map(h => seeded(11, () => makeSystem(h, field, {}, { area: 14, count: 600, base })));
    const step = t => { for (const s of [sa, sb]) updateSystem(s, 1, cam, t, 0.6); };
    step(3.2);
    const a = await shot(HGL), b = await shot(HGPU);
    const pa = sa.object.geometry.getAttribute('position').array, pb = sb.line ? sb.object.geometry.getAttribute('position').array : sb.object.geometry.getAttribute('aPos').array;
    const r = { kinds: [sa.object.type, sb.object.type, sb.object.material.type], samePos: same(pa, pb),
      drawn: [sa.line ? sa.object.geometry.drawRange.count / 2 : sa.object.geometry.drawRange.count, sb.line ? sb.object.geometry.drawRange.count / 2 : sb.object.count], ...compare(a, b) };
    step(3.9);
    const a2 = await shot(HGL), b2 = await shot(HGPU);
    r.later = { moved: [moved(a, a2), moved(b, b2)], ...compare(a2, b2) };
    out.weather[field] = r;
    for (const [h, s] of [[HGL, sa], [HGPU, sb]]) h.remove(s.object);
  }
  // ---- errors by name: a game's own GLSL on WebGPU, and the TSL side not loaded
  const tryIt = fn => { try { fn(); return 'no error'; } catch (e) { return String(e.message); } };
  const glsl = { vertex: 'void main(){ gl_Position = vec4(0.0); }', fragment: 'void main(){ gl_FragColor = vec4(1.0); }' };
  out.errors.glslGpu = tryIt(() => makeSystem(HGPU, 'ash', { glsl }, { area: 14, count: 10 }));
  out.errors.glslGl = tryIt(() => { const s = makeSystem(HGL, 'ash', { glsl }, { area: 14, count: 10 }); HGL.remove(s.object); });
  const keep = swapWebGPUPart('particles', null);
  try {
    out.errors.noTslParticles = tryIt(() => PGPU.define('lost', {}));
    out.errors.noTslWeather = tryIt(() => makeSystem(HGPU, 'snow', {}, { area: 14, count: 10, base: SNOW }));
  } finally { swapWebGPUPart('particles', keep); }
  return out;
};
