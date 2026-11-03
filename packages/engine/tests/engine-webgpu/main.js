// The engine's own content on the WebGPU route (tests/specs/engine-webgpu.mjs): terrain, vegetation (wind), water (waves, foam, fresnel),
// sky, particles and post (bloom) all on, drawn once by a WebGL engine and once by a renderer: 'webgpu' engine, with time and weather held
// still. Why this page: before, the engine's materials were plain three.js materials whose GLSL patches WebGPURenderer never runs, so on
// WebGPU every effect was missing without a word and no test drew engine content there. The comparison is per pixel, so a missing effect
// (no sway, no season tint, flat water) shows even when the mean stays close. Plus fallback: 'webgl' must start and draw with all of it rebuilt.
import * as THREE from 'three';
import 'threedog/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { createEngine, terrain, vegetation, water, sky, particles, weather, mergeColored, applyEffects } from '../../index.js';
import { bloom } from '@threedog/post-effects';
import { materialPatches } from '../../render/patches.js';

const W = 160, H = 120;
const STYLE = { materials: { default: { type: 'lambert' }, water: { type: 'phong', shininess: 60 } }, plugins: { 'bloom.js': { default: bloom({ strength: 0.4, threshold: 0.9 }) } } };

/** One engine with every engine part on; time / weather fixed so both routes draw the same moment */
async function make(extra, { parts = true, more = [], before = null, ground = {} } = {}) {
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const e = createEngine({ canvas, pixelRatio: 1, adaptiveResolution: false, antialias: false, ui: { loading: false }, urlState: false,
    saveKey: 'test-engine-webgpu', style: STYLE, ...extra });
  e.use(terrain({ height: (x, z) => Math.sin(x * 0.15) * 1.5 + Math.cos(z * 0.12) * 1.2, viewChunks: 1, ...ground }), vegetation(), water({ sea: true, level: -0.4 }), sky({ time: 0.4 }), ...(parts ? [particles()] : []), ...more);
  const cone = new THREE.ConeGeometry(0.8, 3, 6).translate(0, 1.5, 0);
  e.vegetation.define('tree', { geometry: mergeColored([[cone, 0x3c7a34]]), wind: 0.08, rule: { perChunk: 60 } });
  // near-only tufts: their distance fade (nearFade patch) is a second position patch after the wind one
  e.vegetation.define('tuft', { geometry: mergeColored([[new THREE.ConeGeometry(0.3, 0.9, 5).translate(0, 0.45, 0), 0xa8b848]]), nearOnly: true, wind: 0.05, rule: { perChunk: 150 } });
  if (parts) e.particles.define('puff', { rate: 0, max: 60, color: [0xffffff, 0xffeeaa], size: [0.6, 0.6], lifetime: [100, 100], speed: [0, 0] });
  before?.(e);
  await e.start();
  e.pause();
  if (parts) e.particles.emit('puff', { x: 0, y: 3, z: 0 }, { count: 40 });
  e.camera.position.set(0, 9, 16); e.camera.lookAt(0, 0, 0); e.camera.updateMatrixWorld();
  return e;
}

const read = c => { const x = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d', { willReadFrequently: true });
  x.drawImage(c, 0, 0, W, H); return x.getImageData(0, 0, W, H).data; };
/** one frame drawn and read in the same task (no preserveDrawingBuffer needed) */
const shot = e => { e.step(1 / 60); return read(e.renderer.domElement); };
/** share of pixels (%) whose largest channel differs by more than tol */
const differ = (a, b, tol = 24) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > tol) n++; return +(100 * n / (W * H)).toFixed(2); };
const mean = a => { let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] + a[i + 1] + a[i + 2]; return +(s / (W * H * 3)).toFixed(2); };

/** The engine materials in the scene: how many, whether each one's node twin got its patches (WebGPU), and their patch names */
function engineMaterials(e) {
  const out = [];
  e.scene.traverse(o => { for (const m of [o.material].flat()) if (m && materialPatches(m).length && !out.some(x => x.m === m)) out.push({ m, o }); });
  return out.map(({ m, o }) => ({ type: m.type, object: o.name || o.type, patches: materialPatches(m), position: !!m.positionNode }));
}

// the WebGL engine is made at load: the test runner waits for window.engine
const gl = window.engine = await make({});

// terrain({ shading: 'texture' }): the per-chunk color map patch (terrainTexture.js) drawn by both routes
window.textureShading = async () => {
  const opts = { parts: false, ground: { shading: 'texture', colorResolution: 32 } };
  const a = await make({ saveKey: 'test-engine-webgpu-tex' }, opts), b = await make({ renderer: 'webgpu', saveKey: 'test-engine-webgpu-tex' }, opts);
  const A = shot(a), B = shot(b);
  const out = { mean: { gl: mean(A), gpu: mean(B) }, differ: differ(A, B), differFine: differ(A, B, 8),
    patched: engineMaterials(b).some(m => m.patches.includes('terrainColorMap')), errors: [a.error, b.error].filter(Boolean).map(x => String(x.message).slice(0, 300)) };
  a.dispose(); b.dispose();
  return out;
};

window.engineWebGPU = async () => {
  const gpu = await make({ renderer: 'webgpu' });
  const out = { backend: gpu.describe().renderer.backend, errors: [] };
  const a = shot(gl), b = shot(gpu);
  out.mean = { gl: mean(a), gpu: mean(b) };
  out.differ = differ(a, b);
  out.differFine = differ(a, b, 8);
  out.materials = engineMaterials(gpu);
  // each effect really moves on WebGPU: wind 0 -> 3 sways the trees, the foliage / ground tint recolors, waves move with time
  const U = gpu.uniforms, step = (fn, back) => { const before = shot(gpu); fn(); const after = shot(gpu); back(); return differ(before, after, 8); };
  out.sway = step(() => { U.uWind.value = 3; U.uTime.value = 7.3; }, () => { U.uWind.value = 1; U.uTime.value = 0; });
  out.tint = step(() => { U.uFoliageTint.value.set(1.6, 0.6, 0.2); U.uGroundTint.value.set(1.5, 1.2, 0.5); }, () => { U.uFoliageTint.value.set(1, 1, 1); U.uGroundTint.value.set(1, 1, 1); });
  out.errors = [gl.error, gpu.error].filter(Boolean).map(x => String(x.message).slice(0, 300));   // a frozen world (an error in a frame) fails here
  out.swayGL = (() => { const G = gl.uniforms, before = shot(gl); G.uWind.value = 3; G.uTime.value = 7.3; const after = shot(gl); G.uWind.value = 1; G.uTime.value = 0; return differ(before, after, 8); })();
  gpu.dispose();
  return out;
};

/**
 * The three routes added on 2026-11-03 (tests/specs/look-routes.mjs), on the WebGL engine and on a WebGPU one: the game's own cloud-shadow term
 * (look.cloudShadow.replace), its own season tint (look.season.replace), a color hook on the plants (look.vegetation.patch('color')).
 * Each goes through the verb (describe().look names the owner), reaches materials already built, and removing it gives the engine's back.
 */
window.lookRoutes = async () => {
  const gpu = await make({ renderer: 'webgpu' }, { parts: false });
  const run = e => {
    const L = e.look, out = {};
    const still = L.wind.set({ amplitude: 0 }, { owner: 'still' });   // no sway: each frame steps time, so "back to the same picture" needs a still one
    const base = shot(e), now = () => differ(base, shot(e), 8);
    const has = n => engineMaterials(e).filter(m => m.patches.includes(n)).length;
    const writer = (part, key) => e.describe().look[part]?.[key]?.writer;
    // (c) cloud shadow: the game's own term in place of the engine's (here a flat darkening), then none at all, then the engine's again
    const hc = L.cloudShadow.replace({ glsl: 'reflectedLight.directDiffuse *= 0.25;', tsl: c => ({ directDiffuse: c.directDiffuse.mul(0.25) }) }, { owner: 'mine' });
    out.cloud = { moved: now(), writer: writer('cloudShadow', '@replace'), on: has('clouds') };
    hc.remove();
    const ho = L.cloudShadow.replace(false, { owner: 'mine' });
    out.cloudOff = has('clouds');
    ho.remove();
    out.cloudBack = { on: has('clouds'), moved: now() };
    // (c) season tint: kind => spec, ground red and foliage blue, reading the signals still bound (uCover)
    const hs = L.season.replace(kind => ({ glsl: `diffuseColor.rgb = mix(vec3(${kind === 'ground' ? '1.0, 0.0, 0.0' : '0.0, 0.0, 1.0'}), vec3(1.0), uCover.y);`,
      tsl: c => c.tsl.vec4(kind === 'ground' ? c.tsl.vec3(1, 0, 0) : c.tsl.vec3(0, 0, 1), c.color.a) }), { owner: 'mine' });
    out.season = { moved: now(), writer: writer('season', '@replace'), on: has('season') };
    hs.remove();
    out.seasonBack = now();
    // (b) vegetation color hook, live on the planted trees
    const hv = L.vegetation.patch('color', { glsl: 'diffuseColor.rgb = vec3(1.0, 0.0, 1.0);', tsl: c => c.tsl.vec4(1, 0, 1, c.color.a) }, { owner: 'mine' });
    out.veg = { moved: now(), writer: writer('vegetation', 'hook:color'), on: has('vegetationColor') };
    hv.remove();
    out.vegBack = { moved: now(), on: has('vegetationColor') };
    // the form this renderer needs, when missing, is named instead of drawing nothing
    const gpuSide = !!e.renderer.isWebGPURenderer, half = gpuSide ? { glsl: 'diffuseColor.rgb *= 0.5;' } : { tsl: c => c.color };
    const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
    out.named = [err(() => L.cloudShadow.replace(half)), err(() => L.season.replace(half)), err(() => L.vegetation.patch('color', half))];
    still.remove();
    return out;
  };
  const out = { gl: run(gl), gpu: run(gpu) };
  gpu.dispose();
  return out;
};

// a cloud function with both forms and a marker number in its GLSL: after the swap the WebGL dome must still carry it
const CLOUDS = { glsl: 'vec4 threedogClouds(vec3 d, float t, vec3 s, float n, vec3 lit, vec3 shade, float c){ return vec4(lit, 0.4321 * c * step(0.0, d.y)); }',
  tsl: ({ dir, lit, cover, tsl }) => tsl.vec4(lit, cover.mul(0.4321).mul(tsl.step(0, dir.y))) };

/**
 * fallback 'webgl': everything built before start() for the WebGPURenderer start() then replaced is built again for WebGL: post (bloom),
 * the sky dome with a look.sky.patch('clouds') made before start, the exp fog (scene fog node -> per-material patch), cascaded shadows
 * (CSMShadowNode -> extra lights), particles and rain / snow. start() must not crash and the picture is drawn.
 */
window.fallbackWebGL = async () => {
  const keep = Object.getOwnPropertyDescriptor(navigator, 'gpu');
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
  try {
    // low: { cascades }: the page's software GPU is low tier from the start (render/backend.js tierBeforeRenderer), which keeps one shadow map
    const style = { ...STYLE, sky: { clouds: { coverage: 1 }, fog: { kind: 'exp' }, shadow: { cascades: 3, low: { cascades: 3 } } } };
    const e = await make({ renderer: 'webgpu', fallback: 'webgl', style }, { more: [weather({ types: { wet: { rain: 1 }, white: { snow: 1 } } })],
      before: g => g.look.sky.patch('clouds', CLOUDS) });
    e.weather.set('wet', { seconds: 0.01 }); e.step(0.1);
    const px = shot(e), d = e.describe().renderer;
    const nodeMats = [];
    e.scene.traverse(o => { for (const m of [o.material].flat()) if (m?.isNodeMaterial) nodeMats.push(`${o.type} ${o.name}`); });
    const fx = e.particles.effects.get('puff');
    const r = { backend: d.backend, isWebGL: !!e.renderer.isWebGLRenderer, dome: e.sky.dome.material.type, domeNode: !!e.sky.dome.material.isNodeMaterial, mean: mean(px), post: e.post.active,
      cloudHook: e.sky.dome.material.fragmentShader?.includes('0.4321') ?? false, nodeMats,
      particles: fx.points.type + ' ' + fx.material.type, rain: e.weatherLook.systems.get('rain')?.object.material.type, snow: e.weatherLook.systems.get('snow')?.object.material.type,
      rainShown: e.weatherLook.systems.get('rain')?.object.visible, fogNode: !!e.scene.fogNode, fogPatch: !!e.sky._fogWalk?.patch, csm: e.sky.csm ? (e.sky.csm.isSkyCascadeNode ? 'node' : 'lights') : null };
    e.dispose();
    return r;
  } catch (err) { return { error: String(err?.stack ?? err) }; }
  finally { if (keep) Object.defineProperty(navigator, 'gpu', keep); else delete navigator.gpu; }
};

/**
 * Two patch meanings that once differed between the routes, each drawn by a WebGL and a WebGPU engine:
 * position: an offset in object space on turned instances (GLSL adds it before instanceMatrix; WebGPU used to add it after, so it pointed
 * the wrong way); lighting order: 'dim' (after: scales direct light) then 'glow' (direct: adds light). On WebGL glow comes after dim and is
 * not dimmed; WebGPU's direct hooks used to add inside three's light loop, so dim scaled them too.
 */
window.patchMeanings = async () => {
  const draw = async extra => {
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const e = createEngine({ canvas, pixelRatio: 1, adaptiveResolution: false, antialias: false, ui: { loading: false }, urlState: false,
      saveKey: 'test-engine-webgpu-meanings', style: {}, ...extra });
    await e.start(); e.pause();
    const lit = applyEffects(new THREE.MeshLambertMaterial({ color: 0x808080 }), { clouds: false, patches: [
      { name: 'dim', slot: 'lighting', glsl: 'reflectedLight.directDiffuse *= 0.2;', tsl: { after: c => ({ directDiffuse: c.directDiffuse.mul(0.2) }) } },
      { name: 'glow', slot: 'lighting', glsl: '#if NUM_DIR_LIGHTS > 0\n  reflectedLight.directDiffuse += vec3(0.0, 0.0, 0.4);\n#endif',
        tsl: { direct: (L, c) => { if (L.directional) c.directDiffuse.addAssign(c.tsl.vec3(0, 0, 0.4)); } } },
    ] });
    e.add(new THREE.Mesh(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), lit));
    const moved = applyEffects(new THREE.MeshBasicMaterial({ color: 0xff3020 }), { clouds: false, patches: [
      { name: 'push', slot: 'position', glsl: 'transformed.x += 2.0;', tsl: c => c.position.add(c.tsl.vec3(2, 0, 0)) },
    ] });
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), moved, 3), m = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) boxes.setMatrixAt(i, m.makeRotationY(Math.PI / 2 * (i + 1)).setPosition(-4 + 4 * i, 1, 0));
    e.add(boxes);
    e.camera.position.set(0, 10, 9); e.camera.lookAt(0, 0, 0); e.camera.updateMatrixWorld();
    const px = shot(e);
    e.dispose();
    return px;
  };
  const a = await draw({}), b = await draw({ renderer: 'webgpu' });
  return { differ: differ(a, b), differFine: differ(a, b, 8), mean: { gl: mean(a), gpu: mean(b) } };
};

// Plugins composed on both routes (tests/specs/plugin-composition.mjs): two post plugins with no order of their own whose result depends on
// their order (halve, then lift), each switched off and on. The chain order and the picture must come back exactly
window.pluginOrderRoutes = async () => {
  const gpu = await make({ renderer: 'webgpu', saveKey: 'test-engine-webgpu-plugins' }, { parts: false });
  const fx = (name, glsl, tsl) => ({ name, slot: 'ldr', fuse: { glsl, tsl: (c, uv, { tsl: T }) => T.vec4(tsl(c.rgb), c.a) } });
  const run = e => {
    const still = e.look.wind.set({ amplitude: 0 }, { owner: 'still' }), hold = e.freeze('plugin-order', { ambient: true });
    e.plugins.add({ './plugins/60-half.js': { default: fx('half', 'color.rgb *= 0.5;', c => c.mul(0.5)) },
      './plugins/61-lift.js': { default: fx('lift', 'color.rgb += 0.2;', c => c.add(0.2)) } });
    shot(e);
    const base = shot(e), order = () => e.post.list().map(x => x.name).filter(n => n === 'half' || n === 'lift').join(), o0 = order(), out = { order: o0, still: differ(base, shot(e), 1) };   // still: what two frames with no change differ by (the WebGL engine here has live particles)
    for (const n of ['60-half', '61-lift']) {
      e.plugins.off(n); shot(e); const off = shot(e); e.plugins.on(n); shot(e); const on = shot(e);
      out[n] = { changed: differ(base, off, 4), back: differ(base, on, 1), order: order() === o0 };
    }
    e.plugins.off('60-half'); e.plugins.off('61-lift'); still.remove(); hold.remove();
    return out;
  };
  const out = { gl: run(gl), gpu: run(gpu) };
  gpu.dispose();
  return out;
};

/**
 * Program sharing on WebGPU: N materials of one role (style.materials spec with lighting and detail) each made by makeMaterial, so each is its
 * own material object. three builds a node program per distinct key, and the key holds the identity of each patch uniform object
 * (threedogNodeKey, render/patches.js), so the engine must hand same-spec materials the same patch objects. Counts the node builds three
 * creates for those materials (renderer.debug.onNodeBuilderCreated) while one frame draws them.
 */
window.programSharing = async () => {
  const N = 8;
  const style = { ...STYLE, plugins: null, materials: { ...STYLE.materials,
    stone: { type: 'lambert', lighting: { wrap: 0.4, shadowTint: { color: 0x4455aa }, rim: { color: 0xffffff } }, detail: { noise: 'paper' } } } };
  const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const e = createEngine({ canvas, pixelRatio: 1, adaptiveResolution: false, antialias: false, ui: { loading: false }, urlState: false,
    saveKey: 'test-engine-webgpu-share', style, renderer: 'webgpu' });
  await e.start(); e.pause();
  const mats = new Set(), g = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < N; i++) {
    const m = e.makeMaterial('stone', { color: 0x808080 + i * 0x101010 });
    mats.add(m);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(i * 1.5 - 5, 0.5, 0); e.add(mesh);
  }
  e.camera.position.set(0, 4, 9); e.camera.lookAt(0, 0, 0); e.camera.updateMatrixWorld();
  let builds = 0;
  const d = e.renderer.debug, prev = d.onNodeBuilderCreated;
  d.onNodeBuilderCreated = (b, ro) => { if (mats.has(ro?.material)) builds++; prev?.(b, ro); };
  try { shot(e); } finally { d.onNodeBuilderCreated = prev; }
  const keys = new Set([...mats].map(m => m.threedogNodeKey));
  const out = { materials: N, builds, nodeKeys: keys.size, colors: new Set([...mats].map(m => m.color.getHex())).size };
  e.dispose();
  return out;
};

/**
 * Two small spots where the routes once disagreed (2026-11 notes: 9-15% and ~6% of pixels): half-transparent meshes in fog in front of an
 * opaque one, and an sRGB texture as scene.background. Each drawn by a WebGL engine and a WebGPU one without modules or post, compared per pixel.
 */
window.colorSpots = async () => {
  const bg = (() => {   // an sRGB gradient through mid tones: a missing or doubled sRGB decode shows most there
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 64, 64); g.addColorStop(0, '#203060'); g.addColorStop(0.5, '#c08040'); g.addColorStop(1, '#80c0a0');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const scene = async (renderer, kind, tone = true) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const e = createEngine({ canvas, pixelRatio: 1, adaptiveResolution: false, antialias: false, ui: { loading: false }, urlState: false,
      saveKey: 'test-engine-webgpu-spots', ...(renderer && { renderer }) });
    await e.start(); e.pause();
    if (!tone) e.renderer.toneMapping = THREE.NoToneMapping;
    if (kind === 'fog') {
      e.scene.background = new THREE.Color(0x8fa8c0);
      e.scene.fog = new THREE.Fog(0x8fa8c0, 4, 30);
      e.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 6, 4); e.scene.add(sun);
      for (const [z, op, col] of [[-14, 1, 0xd04020], [-8, 0.5, 0x2060e0], [-3, 0.35, 0x30c060]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 0.5), new THREE.MeshStandardMaterial({ color: col, transparent: op < 1, opacity: op, roughness: 0.8 }));
        m.position.set(z * 0.15, 1.5, z); e.scene.add(m);
      }
    } else e.scene.background = bg;
    e.camera.position.set(0, 2, 6); e.camera.lookAt(0, 1.5, -10); e.camera.updateMatrixWorld();
    return e;
  };
  const out = {};
  // background twice: with the engine's tone mapping and without. Why: plain WebGLRenderer leaves an sRGB background out of tone mapping
  // (WebGLBackground: toneMapped = false for sRGB transfer), WebGPURenderer tone-maps the whole frame once at output, background included;
  // the engine's WebGL straight path tone-maps it too (render/postWebGL.js toneBackground), so all three agree with tone mapping on
  for (const [kind, tone] of [['fog', true], ['background', true], ['backgroundFlat', false]]) {
    const a = await scene(null, kind.replace('Flat', ''), tone), b = await scene('webgpu', kind.replace('Flat', ''), tone);
    const pa = shot(a), pb = shot(b);
    out[kind] = { differ: differ(pa, pb), differFine: differ(pa, pb, 8), mean: { gl: mean(pa), gpu: mean(pb) }, px: { gl: [...pa.slice(0, 4)], gpu: [...pb.slice(0, 4)] } };
    if (kind === 'background') {
      // WebGL's two paths: straight to the canvas, then through the composer (a pass-through effect on), then straight again
      const direct = { active: a.post.active, px: pa };
      const h = a.look.post.add({ name: 'through', slot: 'ldr', fuse: { glsl: '', tsl: c => c } }), pc = shot(a), composer = a.post.active;
      h.remove(); const again = shot(a);
      out.backgroundComposer = { direct: direct.active, composer, differ: differ(pa, pc), differFine: differ(pa, pc, 8), back: differ(pa, again, 2), mean: { direct: mean(pa), composer: mean(pc) } };
    }
    a.dispose(); b.dispose();
  }
  return out;
};

/**
 * Plain three.js materials the game adds take the engine's cloud shadow (render/terms.js syncPlainTerms; tests/specs/plain-three-adoption.mjs):
 * a MeshStandardMaterial box put in with scene.add darkens when the cloud shadow deepens, on both renderers; one with
 * userData.cloudShadow = false does not; six plain materials of one type keep one program; describe().owned names them.
 */
window.plainClouds = async () => {
  const gpu = await make({ renderer: 'webgpu' }, { parts: false });
  const run = e => {
    const U = e.uniforms, g = new THREE.BoxGeometry(40, 0.2, 40);
    // a wide slab over the ground (the camera at (0, 9, 16) looks down at its sunlit top): the center of the view reads only the slab
    const center = px => { let s = 0, n = 0; for (let y = 45; y < 75; y++) for (let x = 65; x < 95; x++) { const i = (y * W + x) * 4; s += px[i] + px[i + 1] + px[i + 2]; n++; } return s / (n * 3); };
    const dim = box => {
      e.scene.add(box); box.position.set(0, 2.5, 0); box.updateMatrixWorld();
      // full cover and small clouds (scale 0.5: many cells inside the region, so the noise near the world origin, about 0, cannot hide them),
      // set through the cloud look's own verb
      U.uCloud.value = 1;
      const lit = dim.lit = center(shot(e));
      const h = e.look.cloudShadow.set({ shadow: 0.9, scale: 0.5 }, { owner: 'test' });
      const shade = center(shot(e));
      h.remove(); box.removeFromParent();
      return +(100 * (1 - shade / Math.max(lit, 1e-3))).toFixed(1);   // % darker under the clouds
    };
    const plain = new THREE.MeshStandardMaterial({ color: 0xd0c8b0, roughness: 0.9, name: 'plainCrate' });
    const off = new THREE.MeshStandardMaterial({ color: 0xd0c8b0, roughness: 0.9, name: 'noClouds' }); off.userData.cloudShadow = false;
    const out = { plain: dim(new THREE.Mesh(g, plain)), off: dim(new THREE.Mesh(g, off)), patches: materialPatches(plain), offPatches: materialPatches(off) };
    // the shadow going 0 -> 0.9 builds no program: the off state is a branch on the uniform, not a different shader
    {
      const box = new THREE.Mesh(g, plain), dbg = e.renderer.debug, prev = dbg?.onNodeBuilderCreated, gpuSide = !!e.renderer.isWebGPURenderer;
      let builds = 0;
      e.scene.add(box); box.position.set(0, 2.5, 0); shot(e);
      const before = gpuSide ? 0 : e.renderer.info.programs.length;
      if (gpuSide) dbg.onNodeBuilderCreated = (b, ro) => { if (ro?.material === plain) builds++; prev?.(b, ro); };
      const h = e.look.cloudShadow.set({ shadow: 0.9 }, { owner: 'test' });
      try { shot(e); h.remove(); shot(e); } finally { if (gpuSide) dbg.onNodeBuilderCreated = prev; }
      out.newPrograms = gpuSide ? builds : e.renderer.info.programs.length - before;
      box.removeFromParent();
    }
    // a lamp, not the sun: with the sun and sky light off, a PointLight over the slab lights it and the clouds leave it alone
    const lights = e.look.lights.set({ sun: { intensity: 0 }, hemi: { intensity: 0 } }, { owner: 'test' });
    const lamp = new THREE.PointLight(0xffffff, 300, 0, 2); lamp.position.set(0, 6, 0); e.scene.add(lamp);
    out.lamp = dim(new THREE.Mesh(g, plain)); out.lampLit = +dim.lit.toFixed(1);
    lamp.removeFromParent(); lights.remove();
    // late opt-out: the flag set on the line after scene.add takes the term off on the next frame, clearing it puts it back
    const late = new THREE.MeshStandardMaterial({ color: 0xd0c8b0, roughness: 0.9, name: 'lateOut' }), lm = new THREE.Mesh(g, late);
    e.scene.add(lm); e.step(1 / 60);
    out.lateBefore = materialPatches(late).includes('clouds');
    late.userData.cloudShadow = false; e.step(1 / 60);
    out.latePatches = materialPatches(late);
    out.lateOwned = e.describe().owned?.['cloudShadow.plain']?.optedOut ?? [];
    lm.removeFromParent();
    out.late = dim(lm);
    delete late.userData.cloudShadow; e.scene.add(lm); e.step(1 / 60);
    out.lateBack = materialPatches(late).includes('clouds');
    lm.removeFromParent();
    // a NodeMaterial (WebGPU) is not adopted, and describe says so
    if (e.renderer.isWebGPURenderer) {
      const nm = new MeshStandardNodeMaterial({ name: 'myNodeMat' }), nmesh = new THREE.Mesh(g, nm);
      e.scene.add(nmesh); e.step(1 / 60);
      const row = e.describe().owned?.['cloudShadow.plain'];
      out.node = { patches: materialPatches(nm), notAdopted: row?.notAdopted ?? [], whyNot: row?.whyNot ?? '' };
      nmesh.removeFromParent();
    }
    // six plain materials of one type: one program (the patch objects are shared, the cache key is the same)
    const mats = [], meshes = [];
    for (let i = 0; i < 6; i++) { const m = new THREE.MeshStandardMaterial({ color: 0x406080 + i * 0x101010 }); mats.push(m); const o = new THREE.Mesh(g, m); o.position.set(i * 7 - 18, 3, -20); e.scene.add(o); meshes.push(o); }
    let builds = 0;
    const d = e.renderer.debug, prev = d?.onNodeBuilderCreated, gpuSide = !!e.renderer.isWebGPURenderer;
    if (gpuSide) d.onNodeBuilderCreated = (b, ro) => { if (mats.includes(ro?.material)) builds++; prev?.(b, ro); };
    try { shot(e); } finally { if (gpuSide) d.onNodeBuilderCreated = prev; }
    out.share = gpuSide ? { builds, keys: new Set(mats.map(m => m.threedogNodeKey)).size } : { keys: new Set(mats.map(m => m.customProgramCacheKey())).size };
    out.allPatched = mats.every(m => materialPatches(m).includes('clouds'));
    // describe lists what is in the scene now: both test boxes back in (one more frame shows them), then all out again -> the row is gone
    const pa = new THREE.Mesh(g, plain), pb = new THREE.Mesh(g, off); pa.name = 'a'; pb.name = 'b';
    e.scene.add(pa, pb); e.step(1 / 60);
    out.owned = e.describe().owned?.['cloudShadow.plain'];
    for (const o of [...meshes, pa, pb]) o.removeFromParent();
    e.step(1 / 60);
    out.ownedAfter = e.describe().owned?.['cloudShadow.plain'] ?? null;
    return out;
  };
  const out = { gl: run(gl), gpu: run(gpu) };
  gpu.dispose();
  return out;
};
