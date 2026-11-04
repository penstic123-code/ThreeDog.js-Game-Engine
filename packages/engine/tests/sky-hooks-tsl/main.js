// The sky's two hooks in their tsl form (tests/specs/sky-hooks-tsl.mjs): engine.sky.clouds(), dome layers
// (engine.sky.layer('<name>')), each given { glsl, tsl } and drawn by two real engines with one style: a WebGL one
// (the GLSL form) and a WebGPU one on its WebGL2 backend (the tsl form). Per hook: on vs off moves both pictures, and the two agree in mean.
// ctx's "value so far" (clouds) returned unchanged must draw exactly the hook-less picture. A missing form throws by name on each renderer.
// Why means, not pixels: the two backends compile different shader text (see tests/sky-tsl/main.js).
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';
import { createEngine, sky } from '../../index.js';
import { renderOnce } from '../../render/backend.js';

const W = 200, H = 150;
const KF = [[0, 0x101830, 0x203050, 0x8090c0, 0.3], [0.2, 0x101830, 0x203050, 0x8090c0, 0.3], [0.25, 0x4060a0, 0xf0a070, 0xffc080, 0.6],
  [0.5, 0x3a78d8, 0xb8d8f0, 0xffffff, 1], [0.75, 0x4060a0, 0xf0a070, 0xffc080, 0.6], [0.8, 0x101830, 0x203050, 0x8090c0, 0.3], [1, 0x101830, 0x203050, 0x8090c0, 0.3]];

// a layer with both forms and a uniform of its own (uBandK 0 = off): a warm band low over the horizon, added
const bandK = 0;
const STYLE_LAYER = { name: 'band', blend: 'add', uniforms: { uBandK: bandK },
  glsl: 'vec4 threedogSkyLayer(vec3 d, float t, vec3 s, float n){ return vec4(0.9, 0.5, 0.2, uBandK * (1.0 - smoothstep(0.0, 0.4, abs(d.y - 0.15)))); }',
  tsl: ({ dir, uniforms, tsl }) => tsl.vec4(0.9, 0.5, 0.2, uniforms.uBandK.mul(tsl.smoothstep(0, 0.4, dir.y.sub(0.15).abs()).oneMinus())) };

const canvas = () => { const c = Object.assign(document.createElement('canvas'), { width: W, height: H }); c.style.cssText = `width:${W}px;height:${H}px`; document.body.appendChild(c); return c; };
async function make(kind) {
  const e = createEngine({ canvas: canvas(), ...(kind === 'webgpu' ? { renderer: kind } : {}), pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, saveKey: 'test-sky-hooks-' + kind, urlState: false });
  e.use(sky({ time: 0.33, keyframes: KF, clouds: { coverage: 1 } }));
  e.scene.fog = new THREE.FogExp2(0xcccccc, 0.01); e.sky.layer('band', STYLE_LAYER);
  await e.start(); e.pause();
  e.renderer.toneMapping = THREE.NoToneMapping;
  e.uniforms.uCloud.value = 0.55; e.uniforms.uTime.value = 12;
  // a ground and a tall box towards the sun: the fog shows on them, the clouds and the band above
  const M = kind === 'webgpu' ? TG.MeshBasicNodeMaterial : THREE.MeshBasicMaterial, m = new M({ color: 0x3a7a3a });
  e.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2), m));
  return e;
}
const gl = window.engine = await make('webgl');
// navigator.gpu taken away so the WebGPURenderer runs on its WebGL2 backend on every machine (tests/backend does the same)
Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
let gpu;
try { gpu = await make('webgpu'); } finally { delete navigator.gpu; }
const both = [gl, gpu];

const S = gl.sky;
S.fixedTime = 0.33; S.update(gl.focus);
const az = Math.atan2(S.sunDir.x, S.sunDir.z);
const cam = new THREE.PerspectiveCamera(80, W / H, 0.1, 500); cam.position.set(0, 2, 0);
cam.lookAt(Math.sin(az) * 10, 2 + 10 * Math.tan(0.12), Math.cos(az) * 10); cam.updateMatrixWorld();

const shot = async e => {
  e.sky.fixedTime = 0.33; e.sky.update(e.focus);   // the sky's per-frame work
  if (e === gl) {
    const rt = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace }); renderOnce(e.renderer, e.scene, cam, rt);
    const b = new Uint8Array(W * H * 4); e.renderer.readRenderTargetPixels(rt, 0, 0, W, H, b); rt.dispose(); return b;
  }
  const rt = new TG.RenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace });
  renderOnce(e.renderer, e.scene, cam, rt); renderOnce(e.renderer, e.scene, cam, rt);   // a second frame: values read back after the first draw
  const b = new Uint8Array(await e.renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H)); rt.dispose(); return b;
};
const mean = b => { let s = 0; for (let i = 0; i < b.length; i += 4) s += (b[i] + b[i + 1] + b[i + 2]) / 3; return s / (W * H); };
/** mean absolute difference between two pictures, % of 255 */
const change = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) s += Math.abs(a[i] - b[i]); return +(100 * s / (W * H * 3 * 255)).toFixed(3); };
const shots = async () => [await shot(gl), await shot(gpu)];
/** off / on pictures on both engines -> { meanDiff (%, WebGL vs WebGPU, on), moved: [WebGL, WebGPU] (% of 255, on vs off) } */
const pairOf = (off, on) => ({ meanDiff: +(100 * Math.abs(mean(on[0]) - mean(on[1])) / Math.max(1e-6, mean(on[0]))).toFixed(2),
  offDiff: +(100 * Math.abs(mean(off[0]) - mean(off[1])) / Math.max(1e-6, mean(off[0]))).toFixed(2), moved: [change(off[0], on[0]), change(off[1], on[1])] });
const tryIt = fn => { try { fn(); return 'no error'; } catch (err) { return String(err.message); } };

const CLOUDS = { glsl: `vec4 threedogClouds(vec3 d, float t, vec3 s, float n, vec3 lit, vec3 shade, float c){
  float k = smoothstep(0.35, 0.65, threedogNoise(d.xz / (d.y + 0.2) * 2.0 + t * 0.01));
  return vec4(mix(shade, vec3(1.0, 0.35, 0.3), k), k * c * smoothstep(0.0, 0.2, d.y)); }`,
tsl: ({ dir, time, shade, cover, fx, tsl }) => {
  const k = tsl.smoothstep(0.35, 0.65, fx.noise(dir.xz.div(dir.y.add(0.2)).mul(2).add(time.mul(0.01))));
  return tsl.vec4(tsl.mix(shade, tsl.vec3(1, 0.35, 0.3), k), k.mul(cover).mul(tsl.smoothstep(0, 0.2, dir.y)));
} };
const LAYER = { blend: 'mix', glsl: 'vec4 threedogSkyLayer(vec3 d, float t, vec3 s, float n){ return vec4(0.2, 0.9, 0.4, 0.6 * smoothstep(0.3, 0.8, d.y)); }',
  tsl: ({ dir, tsl }) => tsl.vec4(0.2, 0.9, 0.4, tsl.smoothstep(0.3, 0.8, dir.y).mul(0.6)) };

window.skyHooksTsl = async () => {
  const out = { kinds: both.map(e => e.sky.dome.material.type), hooks: {}, same: {}, errors: {} };
  const base = await shots();

  // a layer with { glsl, tsl, uniforms }: its own uniform switches it on on both
  for (const e of both) e.sky.uniforms.uBandK.value = 1;
  out.hooks.styleLayer = pairOf(base, await shots());
  for (const e of both) e.sky.uniforms.uBandK.value = 0;

  // sky.clouds({ glsl, tsl })
  for (const e of both) e.sky.clouds(CLOUDS);
  out.hooks.clouds = pairOf(base, await shots());
  for (const e of both) e.sky.clouds(null);
  out.same.cloudsBack = change(base[1], await shot(gpu));
  // ctx.clouds (the built-in kind's result) handed back unchanged = the hook-less dome
  gpu.sky.clouds({ tsl: c => c.clouds });
  out.same.cloudsSoFar = change(base[1], await shot(gpu));
  gpu.sky.clouds(null);

  // engine.sky.layer(name, { glsl, tsl, blend })
  for (const e of both) e.sky.layer('aurora', LAYER);
  out.hooks.layer = pairOf(base, await shots());
  for (const e of both) e.sky.layer('aurora', null);
  out.same.layerBack = change(base[1], await shot(gpu));

  // ---- each renderer needs its own form, and says so by name
  const G = 'vec4 threedogClouds(vec3 d, float t, vec3 s, float n, vec3 l, vec3 h, float c){ return vec4(1.0); }';
  out.errors.cloudsGlslOnGpu = tryIt(() => gpu.sky.clouds(G));
  out.errors.layerGlslOnGpu = tryIt(() => gpu.sky.layer('x', { glsl: LAYER.glsl }));
  out.errors.cloudsTslOnGl = tryIt(() => gl.sky.clouds({ tsl: CLOUDS.tsl }));
  out.errors.layerTslOnGl = tryIt(() => gl.sky.layer('x', { tsl: LAYER.tsl }));
  out.errors.badTsl = tryIt(() => gpu.sky.clouds({ tsl: c => c.nope.mul(2) }));
  // a failed hook leaves the dome as it was
  out.same.afterErrors = change(base[1], await shot(gpu));
  for (const e of both) e.sky.clouds(null);
  return out;
};
