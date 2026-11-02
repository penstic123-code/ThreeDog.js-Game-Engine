// Load-ramp page for `threedog stress` (packages/tools/stress.mjs) and the slowdown alarm spec (tests/specs/perf-alarm.mjs).
// A neutral scene (gray ground, a camera looking down at a 80×60 m field, the engine's default lights with the sun shadow off) inside createEngine
// (headless, pixel ratio 1, adaptive resolution off), so the numbers are the engine's real render path, not a bare renderer.
//   window.stress.set(axis, n)    replace the load with n units of one axis (AXES below); returns what was built
//   window.stress.measure(frames) median per-frame cpu / gpu / frame ms, see measure()
//   ?axis=reference               the fixed mixed scene of the alarm spec (stress.reference())
// Plain three.js materials on purpose: this page measures the GPU and the engine loop, not a style.
import * as THREE from 'three';
import { createEngine } from '../../index.js';
import * as postEffects from '@threedog/post-effects';

const canvas = document.getElementById('view');
const mixers = [];
const engine = window.engine = createEngine({ canvas, headless: true, ui: { loading: false }, pixelRatio: 1, adaptiveResolution: false, saveKey: 'stress' });
engine.use({ name: 'stressAnim', frame(dt) { for (const m of mixers) m.update(dt); } });   // skinned axis: one mixer per character, like a crowd of NPCs
engine.camera.position.set(0, 32, 52); engine.camera.lookAt(0, 0, -4);
const sun = engine.lights.sun;
sun.castShadow = false;
sun.position.set(30, 60, 20);
Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 200 }); sun.shadow.camera.updateProjectionMatrix();
const gray = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), gray(0x8a8a8a));
ground.receiveShadow = true; engine.scene.add(ground);

let load = new THREE.Group(), undo = [];
engine.scene.add(load);
/** Positions spread over the visible field (x ±40, z ±30), deterministic */
const field = (i, n) => { const side = Math.ceil(Math.sqrt(n)), u = (i % side + 0.5) / side, v = (Math.floor(i / side) + 0.5) / side; return [u * 80 - 40, v * 60 - 30]; };
const boxGeo = new THREE.BoxGeometry(1, 1, 1), boxMat = gray(0xa0a0a0);
function boxes(n, to = load) {
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(boxGeo, boxMat), [x, z] = field(i, n); m.position.set(x, 0.5, z); m.castShadow = m.receiveShadow = true; to.add(m); }
}
function clear() {
  for (const f of undo) f();
  undo = [];
  mixers.length = 0;
  load.traverse(o => { if (o.geometry && o.geometry !== boxGeo) o.geometry.dispose(); if (o.isLight) o.shadow?.map?.dispose(); if (o.isSkinnedMesh) o.skeleton.dispose(); });
  engine.scene.remove(load);
  load = new THREE.Group(); engine.scene.add(load);
}

// A skinned "character": a 24-bone chain inside a 2.3k-triangle tube, a looping sway clip; geometry shared, skeleton and mixer per character
const BONES = 24, H = 1.8;
const tube = (() => {
  const g = new THREE.CylinderGeometry(0.3, 0.3, H, 24, 48).translate(0, H / 2, 0), pos = g.attributes.position, idx = [], wt = [];
  for (let i = 0; i < pos.count; i++) { const f = pos.getY(i) / H * (BONES - 1), b = Math.min(BONES - 2, Math.floor(f)), w = f - b; idx.push(b, b + 1, 0, 0); wt.push(1 - w, w, 0, 0); }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
  return g;
})();
const sway = new THREE.AnimationClip('sway', 1, Array.from({ length: BONES }, (_, b) => new THREE.QuaternionKeyframeTrack(`b${b}.quaternion`, [0, 0.5, 1],
  [...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.06)).toArray(), ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.06)).toArray(),
    ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.06)).toArray()])));
function characters(n) {
  const mat = gray(0xb0a090);
  for (let i = 0; i < n; i++) {
    const bones = Array.from({ length: BONES }, (_, b) => { const o = new THREE.Bone(); o.name = 'b' + b; o.position.y = b ? H / (BONES - 1) : 0; return o; });
    for (let b = 1; b < BONES; b++) bones[b - 1].add(bones[b]);
    const m = new THREE.SkinnedMesh(tube, mat), [x, z] = field(i, n);
    m.add(bones[0]); m.bind(new THREE.Skeleton(bones)); m.position.set(x, 0, z); m.castShadow = true; m.frustumCulled = false;
    load.add(m);
    const mx = new THREE.AnimationMixer(m); mx.clipAction(sway).play(); mx.setTime(i * 0.37 % 1); mixers.push(mx);
  }
}
function lights(n, { shadow = false } = {}) {
  for (let i = 0; i < n; i++) {
    const [x, z] = field(i, n), spot = shadow || i % 2 === 1;
    const l = spot ? new THREE.SpotLight(0xffffff, 40, 25, 0.7, 0.4) : new THREE.PointLight(0xffffff, 30, 15);
    l.position.set(x, 6, z);
    if (spot) { l.target.position.set(x, 0, z); load.add(l.target); }
    if (shadow) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); }
    load.add(l);
  }
}
const ALL_POST = () => [postEffects.bloom({ enabled: true }), postEffects.vignette({ enabled: true }), postEffects.grain({ enabled: true }),
  postEffects.lut({ enabled: true, saturation: 1.1 }), postEffects.chromatic({ enabled: true }), postEffects.outline({ enabled: true }),
  postEffects.ao({ enabled: true }), postEffects.dof({ enabled: true })];

/**
 * The axes: start, growth per step, cap, and build(n). `unit` names what n counts.
 * Every axis except triangles / draw calls / instances sits on 400 shadow-receiving boxes so lights and pixels have something to shade.
 */
export const AXES = {
  triangles: { unit: 'triangles', start: 1e6, cap: 128e6, build(n) {
    // 1M-triangle tiles sharing one geometry (memory stays flat); small on screen so vertex work dominates, not pixels
    const tiles = Math.max(1, Math.round(n / 1e6)), per = n / tiles, s = Math.max(1, Math.round(Math.sqrt(per / 2)));
    const g = new THREE.PlaneGeometry(3, 3, s, s).rotateX(-Math.PI / 2), m = gray(0x9a9a9a);
    for (let i = 0; i < tiles; i++) { const t = new THREE.Mesh(g, m), [x, z] = field(i, tiles); t.position.set(x, 0.05, z); load.add(t); }
    return { triangles: tiles * 2 * s * s, drawCalls: tiles };
  } },
  drawCalls: { unit: 'meshes', start: 1000, cap: 256000, build(n) { boxes(n); return { meshes: n }; } },
  instances: { unit: 'instances', start: 50000, cap: 12.8e6, build(n) {
    const im = new THREE.InstancedMesh(boxGeo, boxMat, n), m = new THREE.Matrix4(), side = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) { const [x, z] = field(i, n); m.makeScale(60 / side, 60 / side, 60 / side).setPosition(x, 0.3, z); im.setMatrixAt(i, m); }
    load.add(im); return { instances: n, triangles: n * 12 };
  } },
  lights: { unit: 'point + spot lights', start: 2, cap: 512, build(n) { boxes(400); lights(n); return { lights: n }; } },
  shadowLights: { unit: 'shadow-casting spot lights (1024²)', start: 1, cap: 32, build(n) { boxes(400); lights(n, { shadow: true }); return { lights: n }; } },
  shadowMapSize: { unit: 'sun shadow map size', start: 512, cap: 16384, build(n) {
    boxes(400); sun.castShadow = true; sun.shadow.map?.dispose(); sun.shadow.map = null; sun.shadow.mapSize.set(n, n);
    undo.push(() => { sun.castShadow = false; sun.shadow.map?.dispose(); sun.shadow.map = null; });
    return { mapSize: n };
  } },
  transparent: { unit: 'overlapping full-view transparent quads', start: 8, cap: 4096, build(n) {
    const g = new THREE.PlaneGeometry(90, 60), m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.02, depthWrite: false });
    for (let i = 0; i < n; i++) { const q = new THREE.Mesh(g, m); q.position.set(0, 8, 30 - i * 40 / n); q.lookAt(engine.camera.position); load.add(q); }
    return { quads: n };
  } },
  particles: { unit: 'point particles (4 px, additive)', start: 100000, cap: 25.6e6, build(n) {
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const [x, z] = field(i, n); p[i * 3] = x; p[i * 3 + 1] = 1 + (i * 0.618 % 1) * 8; p[i * 3 + 2] = z; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    load.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false })));
    return { particles: n };
  } },
  // A ladder, not a doubling: n = how many effects of @threedog/post-effects are on, in a fixed order (bloom first, the costly ao / dof last)
  post: { unit: 'post effects on', start: 0, cap: 8, next: n => n + 1, build(n) {
    boxes(400); const list = ALL_POST().slice(0, n);
    if (list.length) { engine.look.post.replace(list); undo.push(() => engine.look.post.replace(null)); }
    return { effects: list.map(e => e.name) };
  } },
  skinned: { unit: `skinned characters (${BONES} bones, ${tube.index.count / 3} triangles, own mixer)`, start: 8, cap: 4096, build(n) { characters(n); return { characters: n }; } },
};

/** The fixed mixed scene of the slowdown alarm: a bit of every axis, small enough for software rendering */
function reference() {
  clear(); boxes(400); lights(4); characters(6); AXES.transparent.build(3); AXES.particles.build(5000);
  sun.castShadow = true; sun.shadow.mapSize.set(512, 512); sun.shadow.map?.dispose(); sun.shadow.map = null;
}

let shaderError = null;
engine.renderer.debug.onShaderError = (gl, program) => { shaderError = 'shader failed to compile (driver limit)'; };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const r2 = x => x === null ? null : Math.round(x * 100) / 100;

/**
 * Run warm frames, then `frames` measured frames of engine.step (fixed step + frame hooks + render). Per frame:
 *   cpu    main-thread time of the step (JS + WebGL calls issued; the GPU process may still be working)
 *   gpu    GPU time of the step from EXT_disjoint_timer_query_webgl2 (null without the extension or on a disjoint event)
 *   frame  cpu + waiting for the GPU to finish (a 1-pixel readPixels): no CPU/GPU overlap, so a conservative upper bound of the frame
 * Returns medians plus draw calls / triangles of the last frame.
 */
async function measure(frames = 30, warm = 6) {
  const gl = engine.renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2'), px = new Uint8Array(4), DT = 1 / 60;
  shaderError = null;
  for (let i = 0; i < warm; i++) { engine.step(DT, { render: true, describe: false }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  const cpu = [], wall = [], qs = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now(), q = ext && gl.createQuery();
    if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    engine.step(DT, { render: true, describe: false });
    if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
    const t1 = performance.now();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    cpu.push(t1 - t0); wall.push(performance.now() - t0); if (q) qs.push(q);
  }
  const gpu = [];
  const end = performance.now() + 3000;
  while (qs.length && performance.now() < end && !gl.getQueryParameter(qs.at(-1), gl.QUERY_RESULT_AVAILABLE)) await new Promise(r => setTimeout(r, 5));
  const disjoint = ext && gl.getParameter(ext.GPU_DISJOINT_EXT);
  for (const q of qs) { if (!disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
  const info = engine.renderer.info.render;
  return { cpu: r2(median(cpu)), gpu: gpu.length ? r2(median(gpu)) : null, frame: r2(median(wall)), drawCalls: info.calls, triangles: info.triangles,
    timer: !!ext, error: shaderError ?? (gl.isContextLost() ? 'WebGL context lost' : null) };
}

/** A fixed single-thread JS workload (ms), timed in the same page: the alarm divides frame cost by it so a slower or busier machine does not trip it */
function calibrate() {
  const t0 = performance.now(); let x = 0;
  for (let i = 0; i < 4e6; i++) x += Math.sqrt(i) * 1.0000001;
  return { ms: r2(performance.now() - t0), x };
}

window.stress = {
  axes: Object.fromEntries(Object.entries(AXES).map(([k, a]) => [k, { unit: a.unit, start: a.start, cap: a.cap, ladder: !!a.next }])),
  set(axis, n) { clear(); const r = AXES[axis].build(n); return r; },
  next: (axis, n) => AXES[axis].next ? AXES[axis].next(n) : n * 2,
  measure, reference, calibrate, clear,
  maxTexture: () => engine.renderer.capabilities.maxTextureSize,
};
await engine.start();
if (new URLSearchParams(location.search).get('axis') === 'reference') reference();
window.stress.ready = true;   // the tool and the alarm spec wait for this, not engine.ready (the reference scene is built after start)
