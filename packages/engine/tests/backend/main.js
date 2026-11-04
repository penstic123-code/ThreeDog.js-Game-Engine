// Renderer backend page (tests/specs/backend.mjs): createEngine({ renderer: 'webgpu' }) and a game's own WebGPURenderer, the three fallbacks with
// WebGPU taken away (navigator.gpu missing, requestDevice failing), the loud line and describe().renderer, and a small WebGPU-route scene
// (ground + swaying trees through the engine's own patches) that must draw and sway. Why stub navigator.gpu: headless browsers differ in
// whether they offer WebGPU at all, and the fallback paths must be tested the same way on every machine.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';   // what a WebGPU game imports first: it brings three/webgpu for renderer: 'webgpu'
import { createEngine, applyEffects } from '../../index.js';
import { renderOnce, stats } from '../../render/backend.js';

const W = 160, H = 120;
const base = { lights: false, pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, urlState: false };
// the default engine (WebGL): describe / perf / tier stay what they were before the WebGPU entry
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), ...base, saveKey: 'test-backend' });
await engine.start();
engine.pause();

const canvas = () => { const c = Object.assign(document.createElement('canvas'), { width: W, height: H }); c.style.cssText = `width:${W}px;height:${H}px`; document.body.appendChild(c); return c; };
let n = 0;
const make = opts => createEngine({ canvas: canvas(), ...base, saveKey: `test-backend-${++n}`, ...opts });

/** Run fn with navigator.gpu replaced (undefined = missing), collecting console.warn lines */
async function withGpu(gpu, fn) {
  const warns = [], warn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); warn(...a); };
  Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true });
  try { return { ...(await fn()), warns: warns.filter(w => w.startsWith('[threedog]') || /WebGPU/.test(w)) }; }
  finally { delete navigator.gpu; console.warn = warn; }
}
const failingDevice = { requestAdapter: async () => ({ features: new Set(), limits: {}, requestDevice: async () => { throw new Error('test: no device'); } }) };
const message = async p => { try { await p; return ''; } catch (e) { return String(e?.message ?? e).split('\n')[0]; } };
const trees = (node) => {
  const mat = node ? new TG.MeshLambertNodeMaterial({ color: 0x9ad070 }) : new THREE.MeshLambertMaterial({ color: 0x9ad070 });
  return new THREE.Mesh(new THREE.BoxGeometry(0.6, 3, 0.6, 1, 10, 1).translate(0, 1.5, 0), mat);
};

/** Pixels of one render of e's scene into a target (WebGPU: async read-back) */
async function shot(e, cam) {
  const r = e.renderer;
  if (r.isWebGPURenderer) {
    const rt = new TG.RenderTarget(W, H); r.setClearColor(0x000000, 1); renderOnce(r, e.scene, cam, rt);
    const b = new Uint8Array(await r.readRenderTargetPixelsAsync(rt, 0, 0, W, H)); rt.dispose(); return b;
  }
  const rt = new THREE.WebGLRenderTarget(W, H); renderOnce(r, e.scene, cam, rt);
  const b = new Uint8Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, b); rt.dispose(); return b;
}
const mean = a => { let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2]; return +(s / (W * H * 3)).toFixed(2); };
const changed = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) d++; return +(100 * d / (W * H)).toFixed(2); };

window.backendCases = async () => {
  const out = {};
  out.webglDefault = { renderer: engine.describe().renderer, isWebGL: !!engine.renderer.isWebGLRenderer, perf: Object.keys(engine.describe().perf), tier: engine.tier,
    stats: stats(engine.renderer), counts: Object.keys(engine.counts()) };

  // fallback 'webgl2' (default), navigator.gpu missing: same WebGPURenderer, WebGL2 backend
  out.webgl2 = await withGpu(undefined, async () => {
    const e = make({ renderer: 'webgpu' }); await e.start();
    const r = { renderer: e.describe().renderer, isGPU: !!e.renderer.isWebGPURenderer, drawCalls: typeof stats(e.renderer).drawCalls };
    e.dispose(); return r;
  });
  // fallback 'webgl', requestDevice failing: a WebGLRenderer on the same canvas
  out.webgl = await withGpu(failingDevice, async () => {
    const c = canvas(), e = createEngine({ canvas: c, ...base, saveKey: 'test-backend-gl', renderer: 'webgpu', fallback: 'webgl' }); await e.start();
    const r = { renderer: e.describe().renderer, isWebGL: !!e.renderer.isWebGLRenderer, sameCanvas: e.renderer.domElement === c };
    e.dispose(); return r;
  });
  // fallback 'webgl' with a NodeMaterial in the scene: start() fails naming fallback 'webgl2'
  out.webglNode = await withGpu(undefined, async () => {
    const e = make({ renderer: 'webgpu', fallback: 'webgl' }); e.scene.add(trees(true));
    const r = { error: await message(e.start()) }; e.dispose(); return r;
  });
  // fallback 'error': start() rejects
  out.error = await withGpu(failingDevice, async () => {
    const e = make({ renderer: 'webgpu', fallback: 'error' });
    const r = { error: await message(e.start()) }; e.dispose(); return r;
  });
  // a game's own WebGPURenderer asking for WebGL2 itself: not a fallback, no loud line
  out.own = await withGpu(undefined, async () => {
    const r0 = new TG.WebGPURenderer({ canvas: canvas(), antialias: false, forceWebGL: true });
    const e = make({ renderer: r0 }); await e.start();
    const r = { renderer: e.describe().renderer, same: e.renderer === r0, initialized: r0.initialized }; e.dispose(); return r;
  });
  // WebGL-only material on the WebGPU route: start() names it
  const sm = make({ renderer: 'webgpu' }), bad = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShaderMaterial({ name: 'myGlow' })); bad.name = 'glow';
  sm.scene.add(bad);
  out.shaderMaterial = { error: await message(sm.start()) }; sm.dispose();
  // a game's onBeforeCompile (WebGPURenderer never runs it): named at start(), also when it sits under the engine's patch wrapper;
  // an engine-patched material with no hook of the game's (applyEffects wind: GLSL patches under the wrapper) is not
  const hookStart = async (mat, name) => { const e = make({ renderer: 'webgpu' }), m = new THREE.Mesh(new THREE.BoxGeometry(), mat); m.name = name; e.scene.add(m);
    const err = await message(e.start()); e.dispose(); return err; };
  const bend = new THREE.MeshStandardMaterial({ name: 'myBend' }); bend.onBeforeCompile = s => { s.vertexShader = '// bend\n' + s.vertexShader; };
  const patchedOnly = applyEffects(new THREE.MeshLambertMaterial({ name: 'enginePatched' }), { clouds: false, wind: 0.3 });
  const patchedThenHook = applyEffects(new THREE.MeshLambertMaterial({ name: 'patchedThenHook' }), { clouds: false, wind: 0.3 });
  patchedThenHook.onBeforeCompile = () => {};
  out.hook = { game: await hookStart(bend, 'bent'), engine: await hookStart(patchedOnly, 'swaying'), under: await hookStart(patchedThenHook, 'both') };
  // a ShaderMaterial added after start(): named on the next frame through the scene-entry visitor (sceneDelta), with no full scene walk per frame
  {
    const e = make({ renderer: 'webgpu' }); await e.start(); e.pause();
    const errs = [], error = console.error; console.error = (...a) => errs.push(a.map(String).join(' '));
    try {
      e.step(1 / 60, { describe: false }); e.step(1 / 60, { describe: false });
      const walks = e._webglOnlyView.walks;
      const late = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.RawShaderMaterial({ name: 'lateRaw' })); late.name = 'late';
      const holder = new THREE.Group(); e.scene.add(holder); holder.add(late);   // nested add: still seen
      e.step(1 / 60, { describe: false });
      out.late = { error: e.error?.message ?? '', logged: errs.some(l => l.includes("'lateRaw'")), walks: e._webglOnlyView.walks - walks };
    } finally { console.error = error; e.dispose(); }
  }
  // option mistakes
  out.badName = (() => { try { make({ renderer: 'vulkan' }); return ''; } catch (e) { return e.message; } })();
  out.fallbackOnWebGL = (() => { try { make({ fallback: 'webgl' }); return ''; } catch (e) { return e.message; } })();
  // 'webgl' names the default: the engine builds and owns a WebGLRenderer, as with the option left out
  out.webglName = (() => { const w = make({ renderer: 'webgl' }); try { return !!w.renderer.isWebGLRenderer && w._ownsRenderer; } finally { w.dispose(); } })();

  // the WebGPU route draws: ground + trees with the engine's wind patch (tsl field), real navigator.gpu (webgpu or its webgl2 fallback)
  const g = make({ renderer: 'webgpu', lights: true });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), applyEffects(new TG.MeshLambertNodeMaterial({ color: 0xc8d0a0 }), { clouds: false }));
  const tree = trees(true); applyEffects(tree.material, { clouds: false, wind: 0.3 }); tree.castShadow = true; ground.receiveShadow = true;
  g.scene.add(ground, tree);
  await g.start();
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 200); cam.position.set(0, 3, 8); cam.lookAt(0, 1.5, 0); cam.updateMatrixWorld();
  const U = g.uniforms;
  U.uTime.value = 1.7; U.uWindFreq.value = 1; U.uWindAmp.value = 1; U.uWind.value = 0;
  const still = await shot(g, cam);
  U.uWind.value = 2;
  const sway = await shot(g, cam);
  out.scene = { renderer: g.describe().renderer, mean: mean(still), sway: changed(still, sway) };
  g.dispose();
  return out;
};

// engine.debug.view on the WebGPU route: every built-in mode draws something of its own, swayed meshes keep their sway inside the
// scene-wide views, shaderCost ranks the node programs, 'off' gives back the exact real picture. Console errors are collected per mode.
window.debugViewCases = async () => {
  const g = make({ renderer: 'webgpu', lights: true });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), applyEffects(new TG.MeshLambertNodeMaterial({ color: 0xc8d0a0 }), { clouds: false }));
  const tree = trees(true); applyEffects(tree.material, { clouds: false, wind: 0.3 }); tree.position.x = 1.5;
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xd02020, roughness: 0.6 })); box.position.set(-1.5, 0.6, 0);
  const glass = new THREE.MeshBasicMaterial({ color: 0x4060ff, transparent: true, opacity: 0.4 });
  const panes = [0, 1].map(i => { const p = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.5), glass); p.position.set(0, 1.5, 2 + i * 0.3); return p; });
  g.scene.add(ground, tree, box, ...panes);
  await g.start(); g.pause();
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 200); cam.position.set(0, 3, 8); cam.lookAt(0, 1, 0); cam.updateMatrixWorld();
  const U = g.uniforms; U.uTime.value = 1.7; U.uWindFreq.value = 1; U.uWindAmp.value = 1; U.uWind.value = 0;
  const errs = [], orig = console.error;
  console.error = (...a) => { errs.push(a.map(String).join(' ').slice(0, 200)); orig(...a); };
  const share = (b, f) => { let n = 0; for (let i = 0; i < b.length; i += 4) if (f(b[i], b[i + 1], b[i + 2])) n++; return +(100 * n / (W * H)).toFixed(2); };
  const red = b => share(b, (r, gg, bb) => r > gg + 60 && r > bb + 60);
  const res = { backend: g.describe().renderer.backend, modes: g.debug.viewModes(), views: {} };
  try {
    const off = await shot(g, cam);
    res.off = { mean: mean(off), red: red(off), green: share(off, (r, gg) => gg > r + 30) };
    for (const mode of ['albedo', 'lighting', 'shadow', 'normals', 'overdraw', 'shaderCost']) {
      const n0 = errs.length, st = g.debug.view(mode);
      const a = await shot(g, cam);
      const v = res.views[mode] = { mode: st.mode, mean: mean(a), changed: changed(off, a), red: red(a), green: share(a, (r, gg) => gg > r + 30), levels: new Set(Array.from({ length: W * H }, (_, i) => a[i * 4])).size };
      if (mode === 'lighting' || mode === 'albedo') { U.uWind.value = 2; v.sway = changed(a, await shot(g, cam)); U.uWind.value = 0; }
      if (mode === 'shaderCost') { const cols = new Set(); g.scene.traverse(o => { if (o.isMesh) cols.add(o.material.color?.getHex()); }); v.colors = [...cols]; }
      v.override = g.scene.overrideMaterial ? { type: g.scene.overrideMaterial.type, node: !!g.scene.overrideMaterial.isNodeMaterial } : null;
      v.errors = errs.slice(n0);
    }
    g.debug.view('off');
    const back = await shot(g, cam);
    res.restored = { changed: changed(off, back), override: g.scene.overrideMaterial, materials: [ground, tree, box, ...panes].every(o => !o.material.userData._dbgOf) };
  } finally { console.error = orig; g.dispose(); }
  return res;
};

// debug.view('shadow') with an environment map (both renderers): scene.environment lights every standard material from all sides, so it lifted
// the shadows the view is meant to show black. Shadow area = ground pixels the sun's shadow darkens (castShadow on vs off, both in the view);
// level = their brightness in shadow over lit. Then 'off' must give back the real picture byte for byte and leave nothing on the scene.
window.shadowViewEnvCases = async (renderer) => {
  const g = make({ ...(renderer === 'webgpu' ? { renderer } : {}), lights: true });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.8 }));
  ground.receiveShadow = true;
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2, 1.5), new THREE.MeshStandardMaterial({ color: 0xd02020 })); box.position.set(0, 1, 0); box.castShadow = true;
  g.scene.add(ground, box);
  await g.start(); g.pause();
  const sun = g.lights.sun; sun.castShadow = true; sun.position.set(4, 6, 2); sun.target.position.set(0, 0, 0);
  const step = () => g.step(1 / 60, { describe: false });
  step();
  if (!g.scene.environment) {   // no map by default; this check needs one
    const pm = new (renderer === 'webgpu' ? TG.PMREMGenerator : THREE.PMREMGenerator)(g.renderer);
    g.scene.environment = pm.fromScene(new THREE.Scene().add(new THREE.HemisphereLight(0xffffff, 0xffffff, 3)), 0.04).texture;
  }
  const env = g.scene.environment, warns = [], warn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); warn(...a); };
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 200); cam.position.set(-2, 4, 4.5); cam.lookAt(-1, 0, -0.5); cam.updateMatrixWorld();
  try {
    step(); const off = await shot(g, cam);
    g.debug.view('shadow'); step();
    sun.castShadow = false; step();
    const lit = await shot(g, cam);
    sun.castShadow = true; step();
    const dark = await shot(g, cam);
    let n = 0, sd = 0, sl = 0;
    for (let i = 0; i < dark.length; i += 4) {
      const a = dark[i] + dark[i + 1] + dark[i + 2], b = lit[i] + lit[i + 1] + lit[i + 2];
      if (b - a > 60) { n++; sd += a; sl += b; }
    }
    const envInView = g.scene.environment === env;   // between renders the scene keeps its real map (nothing for an ownership check to see)
    g.debug.view('off'); step();
    const back = await shot(g, cam);
    let diff = 0; for (let i = 0; i < back.length; i++) if (back[i] !== off[i]) diff++;
    return { backend: g.describe().renderer.backend, env: !!env, area: +(100 * n / (W * H)).toFixed(2), level: n ? +(sd / sl).toFixed(3) : null,
      envInView, restored: { bytes: diff, env: g.scene.environment === env, hooks: Object.hasOwn(g.scene, 'onBeforeRender') || Object.hasOwn(g.scene, 'onAfterRender'),
        override: g.scene.overrideMaterial }, ownedWarns: warns.filter(w => /owned-prop|stopped writing/.test(w)) };
  } finally { console.warn = warn; g.dispose(); }
};

// Shader errors on the WebGPU route (render/shaderErrors.js, render/fx/patchNodes.tsl.js): a tsl patch failing where it runs and inside three's
// build both name the patch and slot with this file on top of the stack; a compile error in a node program and a WebGPU pipeline failure name
// the material, the mesh and the patches on it. console.error is captured, not passed on: these errors are the point of the test.
window.shaderErrorCases = async () => {
  const TSL = await import('three/tsl'), { error: threeError } = await import('three');
  const out = {};
  try { applyEffects(new TG.MeshLambertNodeMaterial(), { clouds: false, patches: [{ name: 'oops', slot: 'position', tsl: c => c.nope.mul(2) }] }); }
  catch (e) { out.sync = { message: String(e.message).split('\n')[0], top: String(e.stack).split('\n')[1] ?? '' }; }
  const g = make({ renderer: 'webgpu', lights: true });
  await g.start(); g.pause();
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 100); cam.position.set(0, 1, 4); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  const errs = [], orig = console.error;
  console.error = (...a) => { errs.push(a.map(x => (x instanceof Error ? `${x.message}\n${x.stack}` : String(x))).join(' ')); };
  const settle = async () => { await shot(g, cam); await new Promise(r => setTimeout(r, 300)); await shot(g, cam); return errs.splice(0).join('\n'); };
  try {
    // a lighting hook object runs only inside three's build (applyEffects keeps it as text): three logs 'TSL:' with the location of the error's stack
    const late = applyEffects(new TG.MeshLambertNodeMaterial({ color: 0x808080 }), { clouds: false, patches: [{ name: 'late', slot: 'lighting', tsl: { after: c => { c.nope.mul(2); } } }] });
    const a = new THREE.Mesh(new THREE.BoxGeometry(), late); a.name = 'lateBox'; g.scene.add(a);
    out.build = await settle();
    a.removeFromParent();
    // code that runs fine but returns a node three cannot build (a null input, like a node made for another slot): the 'TSL:' log names
    // the patch and slot, then the material and mesh that now draw as three's plain stand-in
    const nul = applyEffects(new TG.MeshLambertNodeMaterial({ name: 'nullInput' }), { clouds: false,
      patches: [{ name: 'wetPatch', slot: 'color', tsl: c => { const n = c.tsl.mix(c.color, c.tsl.vec4(1), 0.5); n.cNode = null; return n; } }] });
    const nb = new THREE.Mesh(new THREE.BoxGeometry(), nul); nb.name = 'nullBox'; g.scene.add(nb);
    out.nullPatch = await settle();
    nb.removeFromParent();
    // the same in a post effect's node, and a Loop written outside an Fn (three drops it with no error): both name the effect
    const warns = [], warn = console.warn;
    console.warn = (...a) => { warns.push(a.map(String).join(' ')); };
    try {
      g.post.add({ name: 'nullFog', slot: 'hdr', node: (input, { tsl }) => { const n = tsl.mix(input, tsl.vec4(1), 0.5); n.cNode = null; return n; } });
      g.post.render(0.016); await new Promise(r => setTimeout(r, 300)); g.post.render(0.016);
      out.nullPost = errs.splice(0).join('\n');
      g.post.get('nullFog').enabled = false;
      g.post.add({ name: 'loopFog', slot: 'hdr', node: (input, { tsl }) => {
        const acc = tsl.vec4(0).toVar(); tsl.Loop(3, () => { acc.addAssign(input.mul(0.3)); }); return acc; } });
      g.post.render(0.016);
      out.loop = warns.join('\n');
      g.post.get('loopFog').enabled = false;
    } finally { console.warn = warn; }
    // code three cannot compile, inside a node program with an engine patch on it
    const bad = applyEffects(new TG.MeshLambertNodeMaterial({ name: 'broken' }), { clouds: false, wind: 0.2 });
    out.backend = g.describe().renderer.backend;
    bad.colorNode = out.backend === 'webgpu' ? TSL.wgslFn('fn brokenColor() -> vec4f { return nope; }')() : TSL.glslFn('vec4 brokenColor() { return nope; }')();
    const b = new THREE.Mesh(new THREE.BoxGeometry(), bad); b.name = 'brokenBox'; g.scene.add(b);
    out.compile = await settle();
    // the WebGPU backend's only report path, called the way three's popErrorScope handler calls it (headless runs the WebGL2 backend)
    threeError(`WebGPURenderer: Render pipeline creation failed (renderPipeline_${bad.name}_${bad.id}): test validation error`);
    out.pipeline = errs.splice(0).join('\n');
  } finally { console.error = orig; g.dispose(); }
  return out;
};
