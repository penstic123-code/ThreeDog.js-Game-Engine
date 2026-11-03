// Sky dome and sky fog on both renderers (tests/specs/sky-tsl.mjs): the real engine sky (engine.use(sky())) drives one set of uniforms; the dome
// is built from them twice with the real makeDome, once for WebGLRenderer (ShaderMaterial) and once for WebGPURenderer on its WebGL2 backend
// (render/fx/sky.tsl.js node material), then both are drawn from the same camera at the same moment.
// Why compare means, not pixels: the two backends compile different shader text, so sin-hash noise can land a cloud edge one pixel apart;
// the pictures must agree in mean brightness and per-pixel on average.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';
import { createEngine, sky } from '../../index.js';
import { bindUniforms } from '../../render/engineUniforms.js';
import { swapWebGPUPart } from '../../render/backend.js';
import { makeDome, makeSkyUniforms } from '../../modules/sky/shader.js';
import { cloudUniforms } from '../../modules/sky/clouds.js';
import { DOME_FOG, resolveFog, fogPatch, setFogPatch, fogMaterials } from '../../modules/sky/fog.js';
import { patchMaterial } from '../../render/patches.js';
import { renderOnce } from '../../render/backend.js';

const W = 200, H = 150;
// colored keyframes (the neutral ones are grey): a warm sunrise horizon and a blue noon, so a hue mistake shows in the mean
const KF = [[0, 0x101830, 0x203050, 0x8090c0, 0.4, 0.3], [0.2, 0x101830, 0x203050, 0x8090c0, 0.4, 0.3], [0.25, 0x4060a0, 0xf0a070, 0xffc080, 1.5, 0.6],
  [0.5, 0x3a78d8, 0xb8d8f0, 0xffffff, 3, 1], [0.75, 0x4060a0, 0xf0a070, 0xffc080, 1.5, 0.6], [0.8, 0x101830, 0x203050, 0x8090c0, 0.4, 0.3], [1, 0x101830, 0x203050, 0x8090c0, 0.4, 0.3]];
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), pixelRatio: 1, adaptiveResolution: false,
  ui: { loading: false }, saveKey: 'test-sky-tsl', urlState: false, style: { sky: { keyframes: KF, clouds: { coverage: 1 } } } });
engine.use(sky({ time: 0.27 }));
await engine.start();
engine.pause();
engine.uniforms.uCloud.value = 0.55;   // weather's cloud amount (no weather module here): clouds on

const canvas = () => Object.assign(document.createElement('canvas'), { width: W, height: H });
const gl = new THREE.WebGLRenderer({ canvas: canvas(), antialias: false });
gl.setPixelRatio(1); gl.setSize(W, H, false); gl.toneMapping = THREE.NoToneMapping;
const gpu = new TG.WebGPURenderer({ canvas: canvas(), antialias: false, forceWebGL: true });
gpu.setPixelRatio(1); gpu.setSize(W, H, false); gpu.toneMapping = THREE.NoToneMapping;
await gpu.init();
bindUniforms(gpu, engine.uniforms);   // what the engine does for its own WebGPURenderer; a hand-made one stands in here
// sRGB targets: the bytes compared are the encoded colors a screen shows (both materials end in three's color space conversion)
const glRT = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace }), gpuRT = new TG.RenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace });

const S = engine.sky;
const gpuHost = { renderer: gpu, uniforms: engine.uniforms };
const st = { clouds: { coverage: 1 } };
const sceneOf = o => { const s = new THREE.Scene(); s.add(o); return s; };
const pair = (U, stl) => ({ gl: sceneOf(makeDome(U, stl, DOME_FOG)), gpu: sceneOf(makeDome(U, stl, DOME_FOG, gpuHost)) });
const PLANE = pair(S.uniforms, st);
// cumulus: the same sky uniforms with the cumulus defaults for the cloud shape ones
const UC = { ...S.uniforms, ...cloudUniforms({ kind: 'cumulus' }, 'cumulus') };
const CUMULUS = pair(UC, { clouds: { kind: 'cumulus', coverage: 1 } });

// camera towards the sunrise azimuth, a little above the horizon: horizon band, sun disc and clouds are all in frame
S.fixedTime = 0.27; S.update(engine.focus);
const az = Math.atan2(S.sunDir.x, S.sunDir.z);
const cam = new THREE.PerspectiveCamera(80, W / H, 0.1, 500); cam.position.set(0, 2, 0);
cam.lookAt(Math.sin(az) * 10, 2 + 10 * Math.tan(0.35), Math.cos(az) * 10); cam.updateMatrixWorld();

const shot = async (r, scene, c = cam) => {
  if (r === gl) { gl.setRenderTarget(glRT); gl.setClearColor(0, 1); gl.render(scene, c); const b = new Uint8Array(W * H * 4);
    gl.readRenderTargetPixels(glRT, 0, 0, W, H, b); gl.setRenderTarget(null); return b; }
  gpu.setRenderTarget(gpuRT); gpu.setClearColor(0, 1); gpu.render(scene, c);
  const b = new Uint8Array(await gpu.readRenderTargetPixelsAsync(gpuRT, 0, 0, W, H)); gpu.setRenderTarget(null); return b;
};
const mean = b => { let s = 0; for (let i = 0; i < b.length; i += 4) s += (b[i] + b[i + 1] + b[i + 2]) / 3; return s / (W * H); };
/** relative mean difference (%), mean absolute per-channel difference (% of 255), the WebGL mean */
const compare = (a, b) => {
  const A = mean(a), B = mean(b);
  let abs = 0; for (let i = 0; i < a.length; i += 4) abs += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return { meanDiff: +(100 * Math.abs(A - B) / Math.max(1e-6, A)).toFixed(2), absDiff: +(100 * abs / (W * H * 3 * 255)).toFixed(3), mean: +A.toFixed(2) };
};
/** mean absolute difference between two shots of one renderer, % of 255 */
const change = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) if (i % 4 !== 3) s += Math.abs(a[i] - b[i]); return +(100 * s / (W * H * 3 * 255)).toFixed(3); };

const TIMES = [0.25, 0.28, 0.33, 0.42, 0.5];   // sunrise (06:00) to noon

window.skyTsl = async () => {
  const out = { kinds: [PLANE.gl.children[0].material.type, PLANE.gpu.children[0].material.type], times: {}, cumulus: {}, fog: {}, errors: {} };
  let prev = null;
  for (const t of TIMES) {
    S.fixedTime = t; S.update(engine.focus);   // the real sky writes uTop / uHorizon / uSunColor / engine.uniforms.uSunDir ...
    const a = await shot(gl, PLANE.gl), b = await shot(gpu, PLANE.gpu);
    const r = compare(a, b);
    if (prev) r.moved = [change(prev[0], a), change(prev[1], b)];   // the time step moved both pictures
    out.times[t] = r; prev = [a, b];
  }
  // fog band on (a fog color that is not the horizon), and engine.uniforms.uTime moved: clouds drift on both
  for (const [name, set] of [['cumulus', () => {}], ['fogBand', () => { S.uniforms.uFogBand.value = 1; }], ['later', () => { engine.uniforms.uTime.value += 40; }]]) {
    S.fixedTime = 0.33; S.update(engine.focus); set();
    const P = name === 'cumulus' ? CUMULUS : PLANE;
    out.cumulus[name] = compare(await shot(gl, P.gl), await shot(gpu, P.gpu));
  }
  S.uniforms.uFogBand.value = 0;

  // ---- fog kinds: a ground plane under FogExp2, WebGL through the 'fog' patch, WebGPU through the scene fog node (the real setFogPatch path)
  for (const kind of ['exp', 'height']) {
    const f = resolveFog({ kind, height: 0, falloff: 0.08 });
    const mk = (M, renderer) => {
      const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0xd8b090, 0.02);
      const m = new M({ color: 0x3a7a3a });
      const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), m); scene.add(g);
      const box = new THREE.Mesh(new THREE.BoxGeometry(6, 30, 6), m); box.position.set(Math.sin(az) * 40, 0, Math.cos(az) * 40); scene.add(box);
      const fake = { engine: { renderer, scene } };
      if (renderer === gl) patchMaterial(m, [fogPatch(f)]); else { setFogPatch(fake, f); fogMaterials(fake); }
      scene.userData.fake = fake;
      return scene;
    };
    const sg = mk(THREE.MeshBasicMaterial, gl), sw = mk(TG.MeshBasicNodeMaterial, gpu);
    const fcam = cam.clone(); fcam.lookAt(Math.sin(az) * 10, 0, Math.cos(az) * 10); fcam.updateMatrixWorld();
    const a = await shot(gl, sg, fcam), b = await shot(gpu, sw, fcam);
    sw.fog.density = 0; const b0 = await shot(gpu, sw, fcam);   // density read live: no fog = a different picture
    out.fog[kind] = { ...compare(a, b), node: !!sw.fogNode, liveDensity: change(b, b0) };
    // a linear THREE.Fog put in by the game: the node steps aside for three's own fog
    sw.fog = new THREE.Fog(0xffffff, 1, 100); fogMaterials(sw.userData.fake); out.fog[kind].linearYields = sw.fogNode === null;
  }

  const tryIt = fn => { try { fn(); return 'no error'; } catch (e) { return String(e.message); } };
  // ---- the engine entry: createEngine({ renderer: 'webgpu' }) + sky() builds the node dome itself and draws what the WebGL engine draws.
  // navigator.gpu taken away so the WebGPURenderer runs on its WebGL2 backend on every machine (tests/backend does the same)
  Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
  try {
    const c2 = Object.assign(document.createElement('canvas'), { width: W, height: H }); c2.style.cssText = `width:${W}px;height:${H}px`; document.body.appendChild(c2);
    const e2 = createEngine({ canvas: c2, renderer: 'webgpu', pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, saveKey: 'test-sky-tsl-gpu', urlState: false,
      style: { sky: { keyframes: KF, clouds: { coverage: 1 }, fog: { kind: 'exp' } } } });
    e2.use(sky({ time: 0.33 }));
    await e2.start(); e2.pause();
    e2.uniforms.uCloud.value = engine.uniforms.uCloud.value; e2.uniforms.uTime.value = engine.uniforms.uTime.value;
    S.fixedTime = 0.33; S.update(engine.focus); e2.sky.update(e2.focus);
    // the engine's own scene (only the dome draws in it: no ground, no objects) against the WebGL dome over the WebGL engine's uniforms
    const a = await shot(gl, sceneOf(makeDome(S.uniforms, st, DOME_FOG)));
    const rt = new TG.RenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace }); renderOnce(e2.renderer, e2.scene, cam, rt);
    const b = new Uint8Array(await e2.renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H)); rt.dispose();
    // the real look.sky hook path on the WebGPU engine's node dome
    out.errors.cloudsHookGpu = tryIt(() => e2.look.sky.patch('clouds', 'vec4 threedogClouds(vec3 d, float t, vec3 s, float n, vec3 l, vec3 h, float c){ return vec4(1.0); }'));
    out.engine = { isGPU: !!e2.renderer.isWebGPURenderer, dome: e2.sky.dome.material.type, fogNode: !!e2.scene.fogNode, ...compare(a, b) };
    e2.dispose();
  } finally { delete navigator.gpu; }

  // ---- errors by name
  const fakeSky = { engine: { renderer: gpu, scene: new THREE.Scene() } };
  out.errors.layersGpu = tryIt(() => makeDome(S.uniforms, { layers: [{ glsl: 'vec4 threedogSkyLayer(vec3 d, float t, vec3 s, float n){ return vec4(0.0); }' }] }, DOME_FOG, gpuHost));
  out.errors.fogHookGpu = tryIt(() => setFogPatch(fakeSky, resolveFog({ kind: 'exp' }, 'vec4 threedogFog(vec3 c, float d, vec3 w){ return vec4(c, 0.5); }')));
  const keep = swapWebGPUPart('sky', null);
  try {
    out.errors.noTslDome = tryIt(() => makeDome(makeSkyUniforms({}, engine.uniforms), {}, DOME_FOG, gpuHost));
    out.errors.noTslFog = tryIt(() => setFogPatch(fakeSky, resolveFog({ kind: 'height' })));
  } finally { swapWebGPUPart('sky', keep); }
  out.errors.glDome = tryIt(() => makeDome(makeSkyUniforms({}, engine.uniforms), {}, DOME_FOG));
  return out;
};
