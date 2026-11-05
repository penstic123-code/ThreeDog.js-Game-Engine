// Swarm against one Mesh per object (docs/testing/perf.md "Swarm"): the same bouncing objects, the same lit box. ?mode=swarm|mesh&n=10000&renderer=webgpu
// Numbers come from window.measure(); run on a real GPU with:
//   node packages/tools/real-webgpu.mjs --urls="/tests/swarm-perf/index.html?mode=swarm&n=10000&renderer=webgpu" --eval=<file holding: window.measure()>
//   add --webgl and drop renderer=webgpu for the WebGL renderer.
// Frame time as in the stress scripts: CPU plus waiting for the GPU, not overlapped, so an upper bound; step() and not rAF, so the display rate does not cap it.
import * as THREE from 'three';
import 'threedog/tsl';
import { createEngine, swarm } from '../../index.js';

const q = new URLSearchParams(location.search), mode = q.get('mode') ?? 'swarm', n = +(q.get('n') ?? 1000), DT = 1 / 60, HALF = 100;
const canvas = document.createElement('canvas');
canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
document.body.appendChild(canvas);
const engine = window.engine = createEngine({ canvas, pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, urlState: false, saveKey: 'test-swarm-perf', renderer: q.get('renderer') ?? undefined });
engine.use(swarm());
await engine.start();
engine.haltLoop();
engine.camera.position.set(0, 120, 150);
engine.camera.lookAt(0, 0, 0);
engine.camera.far = 1000;
engine.camera.updateProjectionMatrix();

let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6), material = new THREE.MeshLambertMaterial({ color: 0xb0b0b0 });
const pos = () => (rnd() - 0.5) * 2 * HALF, vel = () => (rnd() - 0.5) * 20;

/** Queries of radius 3 around random points: the same question both ways */
let query;
if (mode === 'swarm') {
  const s = engine.swarm({ name: 'perf', capacity: n, geometry, material, fields: ['vx', 'vz'] }), o = { x: 0, y: 0.3, z: 0, vx: 0, vz: 0 };
  for (let i = 0; i < n; i++) { o.x = pos(); o.z = pos(); o.vx = vel(); o.vz = vel(); s.spawn(o); }
  s.onStep((d, i, dt) => {
    const x = d.x[i] += d.vx[i] * dt, z = d.z[i] += d.vz[i] * dt;
    if (x > HALF || x < -HALF) d.vx[i] = -d.vx[i];
    if (z > HALF || z < -HALF) d.vz[i] = -d.vz[i];
  });
  let hits = 0;
  const count = () => { hits++; };
  query = (x, z) => { s.near(x, z, 3, count); return hits; };
} else {
  // the usual hand-written game: one Mesh per object, geometry and material shared
  const list = [];
  for (let i = 0; i < n; i++) { const m = new THREE.Mesh(geometry, material); m.position.set(pos(), 0.3, pos()); engine.scene.add(m); list.push({ m, vx: vel(), vz: vel() }); }
  engine.onFixed(dt => {
    for (const b of list) {
      const p = b.m.position;
      p.x += b.vx * dt; p.z += b.vz * dt;
      if (p.x > HALF || p.x < -HALF) b.vx = -b.vx;
      if (p.z > HALF || p.z < -HALF) b.vz = -b.vz;
    }
  });
  let hits = 0;
  query = (x, z) => { for (const b of list) { const dx = b.m.position.x - x, dz = b.m.position.z - z; if (dx * dx + dz * dz <= 9) hits++; } return hits; };
}

const median = a => { const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(3); };
const p95 = a => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length * 0.95)].toFixed(3); };
const r = engine.renderer, gl = r.isWebGLRenderer ? r.getContext() : null, px = new Uint8Array(4);
const idle = async () => { if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); else await r.backend.device?.queue.onSubmittedWorkDone(); };

window.measure = async (frames = n >= 50000 && mode === 'mesh' ? 40 : 120) => {
  for (let i = 0; i < 20; i++) { engine.step(DT, { describe: false }); await idle(); }
  const fixed = [], cpu = [], frame = [];
  for (let i = 0; i < frames; i++) {
    let t = performance.now();   // measure
    engine.step(DT, { render: false, describe: false });
    fixed.push(performance.now() - t);   // measure
    await idle();
    t = performance.now();   // measure
    engine.step(DT, { describe: false });
    const c = performance.now();   // measure
    await idle();
    cpu.push(c - t); frame.push(performance.now() - t);   // measure
  }
  // 100 queries in a step, grid rebuild included: the real cost of near
  const qs = [];
  for (let i = 0; i < 30; i++) {
    engine.step(DT, { render: false, describe: false });
    const t = performance.now();   // measure
    for (let k = 0; k < 100; k++) query(pos(), pos());
    qs.push(performance.now() - t);   // measure
  }
  return { mode, n, backend: engine.describe().renderer.backend, fixedStep: median(fixed), cpu: median(cpu), frame: median(frame), frameP95: p95(frame), query100: median(qs), calls: engine.describe().perf.drawCalls };
};
