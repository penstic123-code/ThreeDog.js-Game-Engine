// The one copy of what the two `threedog stress` pages share: stress-page.js (a game's own page) and the neutral page packages/engine/tests/stress/main.js. The loads, freeing
// them, and the measure. Two copies drifted before: a fix to the measure or to what a step frees has to reach both, or one table is wrong while the other looks fine.
import * as THREE from 'three';

/** Positions spread over a field of x ±40, z ±30, deterministic @param {number} i @param {number} n @returns {[number, number]} */
export const field = (i, n) => { const side = Math.ceil(Math.sqrt(n)), u = (i % side + 0.5) / side, v = (Math.floor(i / side) + 0.5) / side; return [u * 80 - 40, v * 60 - 30]; };

/** n meshes, one draw call each @param {THREE.Object3D} to @param {number} n @param {THREE.BufferGeometry} geometry @param {THREE.Material} material @param {boolean} [shadows] */
export function boxes(to, n, geometry, material, shadows = false) {
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(geometry, material), [x, z] = field(i, n); m.position.set(x, 0.5, z); m.castShadow = m.receiveShadow = shadows; to.add(m); }
}

/** n triangles as 1M-triangle tiles sharing one geometry (memory stays flat); small on screen so vertex work dominates, not pixels @param {THREE.Object3D} to @param {number} n @param {THREE.Material} material */
export function tiles(to, n, material) {
  const count = Math.max(1, Math.round(n / 1e6)), s = Math.max(1, Math.round(Math.sqrt(n / count / 2))), g = new THREE.PlaneGeometry(3, 3, s, s).rotateX(-Math.PI / 2);
  for (let i = 0; i < count; i++) { const t = new THREE.Mesh(g, material), [x, z] = field(i, count); t.position.set(x, 0.05, z); to.add(t); }
  return { triangles: count * 2 * s * s, drawCalls: count };
}

/** n instances in one draw @param {THREE.Object3D} to @param {number} n @param {THREE.BufferGeometry} geometry @param {THREE.Material} material */
export function instances(to, n, geometry, material) {
  const im = new THREE.InstancedMesh(geometry, material, n), m = new THREE.Matrix4(), side = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) { const [x, z] = field(i, n); m.makeScale(60 / side, 60 / side, 60 / side).setPosition(x, 0.3, z); im.setMatrixAt(i, m); }
  im.frustumCulled = false;   // the field is in view by design, and bounds over millions of instances would cost more than the step they would save
  to.add(im);
  return { instances: n, triangles: n * geometry.index.count / 3 };
}

/** n lights over the field: point lights, every second one a spot with `spots`, all spots casting with `shadow` @param {THREE.Object3D} to @param {number} n @param {{ spots?: boolean, shadow?: boolean }} [opt] */
export function lights(to, n, { spots = false, shadow = false } = {}) {
  for (let i = 0; i < n; i++) {
    const [x, z] = field(i, n), spot = shadow || spots && i % 2 === 1;
    const l = spot ? new THREE.SpotLight(0xffffff, 40, 25, 0.7, 0.4) : new THREE.PointLight(0xffffff, 30, 15);
    l.position.set(x, 6, z);
    if (spot) { l.target.position.set(x, 0, z); to.add(l.target); }
    if (shadow) { l.castShadow = true; l.shadow.mapSize.set(1024, 1024); }
    to.add(l);
  }
}

/**
 * Give back everything a step holds on the GPU. Every kind of load has to be here: the steps double, so a step left behind is as big as the load being measured, and the axis would
 * stop on the memory of the steps before it.
 * @param {THREE.Object3D} load @param {THREE.BufferGeometry} shared  a geometry the next step uses again
 */
export function freeLoad(load, shared) {
  load.traverse(o => {
    if (o.geometry && o.geometry !== shared) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
    if (o.isLight) o.shadow?.map?.dispose();
    if (o.isSkinnedMesh) o.skeleton.dispose();
  });
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const r2 = x => x === null ? null : Math.round(x * 100) / 100;

/**
 * The measure of one page, on either renderer. Per frame:
 *   cpu    main-thread time of the step (JS and graphics calls issued; the GPU may still be working)
 *   gpu    GPU time of the step from EXT_disjoint_timer_query_webgl2 (null without the extension, on a disjoint event, and on WebGPU, which has no timer that works the same)
 *   frame  cpu + waiting for the GPU to finish: no CPU/GPU overlap, so a conservative upper bound of the frame
 * error is sticky for the page. A lost device or a buffer too large draws nothing, so frame times fall: without this the ramp would carry on to the cap and call that spare
 * capacity. Sticky because the caller throws away the first measure of a page, and an out-of-memory error comes only once. It asks the device itself: both pages run headless,
 * and engine.page watches nothing there.
 * @param {any} engine
 * @returns {(frames?: number, warm?: number) => Promise<{ cpu: number, gpu: number | null, frame: number, drawCalls: number, triangles: number, timer: boolean, error: string | null }>}
 */
export function meter(engine) {
  const r = engine.renderer, device = r.backend?.isWebGPUBackend ? r.backend.device : null, gl = device ? null : r.backend?.gl ?? r.getContext();
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2'), px = new Uint8Array(4), DT = 1 / 60;
  let failed = null;
  if (r.debug) r.debug.onShaderError = () => { failed = 'shader failed to compile (driver limit)'; };
  device?.addEventListener('uncapturederror', e => { failed ??= `GPU error: ${e.error?.message ?? e.error}`; });
  device?.lost.then(info => { failed ??= `WebGPU device lost${info?.message ? `: ${info.message}` : ''}`; });
  const finish = () => device ? device.queue.onSubmittedWorkDone() : gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return async function measure(frames = 30, warm = 6) {
    for (let i = 0; i < warm; i++) { engine.step(DT, { render: true, describe: false }); await finish(); }
    const cpu = [], wall = [], qs = [];
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now(), q = ext && gl.createQuery();
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      engine.step(DT, { render: true, describe: false });
      if (q) gl.endQuery(ext.TIME_ELAPSED_EXT);
      const t1 = performance.now();
      await finish();
      cpu.push(t1 - t0); wall.push(performance.now() - t0); if (q) qs.push(q);
    }
    const gpu = [], end = performance.now() + 3000;
    while (qs.length && performance.now() < end && !gl.getQueryParameter(qs.at(-1), gl.QUERY_RESULT_AVAILABLE)) await new Promise(go => setTimeout(go, 5));
    const disjoint = ext && gl.getParameter(ext.GPU_DISJOINT_EXT);
    for (const q of qs) { if (!disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(q); }
    const info = r.info.render;
    return { cpu: r2(median(cpu)), gpu: gpu.length ? r2(median(gpu)) : null, frame: r2(median(wall)), drawCalls: info.drawCalls ?? info.calls, triangles: info.triangles,
      timer: !!ext, error: failed ?? (gl?.isContextLost?.() ? 'WebGL context lost' : null) };
  };
}
