// Swarm page (tests/specs/swarm.mjs): spawn / free / reuse, the handle rule, capacity, near against brute force, walks that remove and spawn, dispose,
// pause and channels, the save round trip, and drawing (interpolation, rotation, bounds, colour) on the WebGL renderer and on WebGPURenderer.
// The WebGPU case asks for renderer: 'webgpu' with no stub, so the suite's Chromium lands on the WebGL2 backend and real-webgpu.mjs on real WebGPU.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';
import { createEngine, swarm } from '../../index.js';
import { renderOnce } from '../../render/backend.js';

const W = 160, H = 120;
const base = { lights: false, pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, urlState: false };
let n = 0;
const make = async opts => {
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  document.body.appendChild(c);
  const e = createEngine({ canvas: c, ...base, saveKey: `test-swarm-${++n}`, ...opts });
  e.use(swarm());
  await e.start();
  e.pause();
  return e;
};
const code = fn => { try { fn(); return 'no error'; } catch (err) { return err.code ?? String(err.message); } };
const box = () => new THREE.BoxGeometry(1, 1, 1);
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;

function lifeCases(e) {
  const s = e.swarm({ name: 'life', capacity: 8, fields: ['tag', 'scale'] }), d = s.data, out = {};
  const a = s.spawn({ x: 1, tag: 1 }), b = s.spawn({ x: 2, tag: 2 }), c = s.spawn({ x: 3, tag: 3 });
  out.count3 = s.count;
  out.freed = s.free(a);
  out.freedAgain = s.free(a);
  out.count2 = s.count;
  out.staleRow = s.row(a);
  // removing row 0 moves the last row in: same handle, new row
  out.movedHandleFollows = d.tag[s.row(c)] === 3 && s.row(c) === 0 && d.tag[s.row(b)] === 2;
  const r = s.spawn({ x: 9 });   // reuses a's slot: the old handle must not name the new object
  out.reuseSlot = r % 2 ** 20 === a % 2 ** 20;
  out.reuseNewHandle = r !== a && s.row(a) === -1 && s.free(a) === false;
  out.reuseDefaults = d.tag[s.row(r)] === 0 && d.scale[s.row(r)] === 1;
  out.rowToFree = code(() => s.free(0));
  out.minusOne = s.free(-1);
  out.badField = code(() => s.spawn({ tga: 1 }));
  out.noColor = code(() => s.spawn({ color: 0xff0000 }));
  s.clear();
  out.cleared = [s.count, s.row(b)];
  // after much churn each handle still names its own data
  const live = new Map();
  let good = true, tag = 1;
  const big = e.swarm({ name: 'churn', capacity: 512, fields: ['tag'] });
  for (let k = 0; k < 20000; k++) {
    if (live.size && (rnd() < 0.5 || live.size === 512)) { const h = [...live.keys()][Math.floor(rnd() * live.size)]; good &&= big.free(h); live.delete(h); }
    else { const h = big.spawn({ tag }); live.set(h, tag++); }
    if (k % 2000 === 0) for (const [h, t] of live) good &&= big.data.tag[big.row(h)] === t && big.data.id[big.row(h)] === h;
  }
  out.churn = good && big.count === live.size;
  s.dispose(); big.dispose();
  return out;
}

async function capacityCases(e) {
  const s = e.swarm({ name: 'cap', capacity: 3 });
  const warns = (await window.__t.warns(() => { for (let i = 0; i < 5; i++) s.spawn(); })).warns.filter(w => w.includes('swarm-full'));
  const out = { count: s.count, dropped: s.dropped, warns: warns.length, text: warns[0], minus: s.spawn(), describe: e.describe().swarm.cap, explain: e.explain({ swarm: 'cap' }),
    counts: e.counts().swarm, duplicate: code(() => e.swarm({ name: 'cap', capacity: 1 })), badField: code(() => e.swarm({ name: 'b', capacity: 1, fields: ['x'] })),
    half: code(() => e.swarm({ name: 'b', capacity: 1, geometry: box() })), badChannel: code(() => e.swarm({ name: 'b', capacity: 1, channel: 'nope' })) };
  s.dispose();
  out.after = code(() => s.spawn());
  out.again = code(() => e.swarm({ name: 'cap', capacity: 1 }).dispose());
  return out;
}

function nearCases(e) {
  const s = e.swarm({ name: 'near', capacity: 3000, cell: 3 }), d = s.data, handles = [];
  for (let i = 0; i < 2000; i++) handles.push(s.spawn({ x: (rnd() - 0.5) * 200, y: rnd() * 50, z: (rnd() - 0.5) * 200 }));
  const brute = (x, z, r) => { const o = []; for (let i = 0; i < s.count; i++) if ((d.x[i] - x) ** 2 + (d.z[i] - z) ** 2 <= r * r) o.push(d.id[i]); return o.sort((a, b) => a - b).join(); };
  const grid = (x, z, r) => { const o = []; s.near(x, z, r, (dd, i) => { o.push(dd.id[i]); }); return o.sort((a, b) => a - b).join(); };
  const out = { wrong: 0, nonEmpty: 0 };
  const compare = rs => { for (let q = 0; q < 200; q++) { const x = (rnd() - 0.5) * 240, z = (rnd() - 0.5) * 240, r = rs[q % rs.length], a = brute(x, z, r); out.wrong += a !== grid(x, z, r); out.nonEmpty += a !== ''; } };
  compare([0.5, 3, 10, 40, 500]);
  // once the grid is built, free and spawn show at once, not next step
  for (let i = 0; i < 700; i++) s.free(handles[i * 2]);
  for (let i = 0; i < 700; i++) s.spawn({ x: (rnd() - 0.5) * 200, z: (rnd() - 0.5) * 200 });
  compare([0.5, 3, 10]);
  // removed in a callback: this query and the next no longer see it, rows stay right
  let seen = 0;
  const got = s.near(0, 0, 30, (dd, i) => { seen++; s.free(dd.id[i]); });
  out.removedInQuery = [got === seen && seen > 0, s.near(0, 0, 30, () => {})];
  compare([3, 10]);
  let visits = 0;
  out.stop = [s.near(50, 50, 80, () => { visits++; return false; }), visits];
  out.badR = code(() => s.near(0, 0, -1, () => {}));
  // objects sharing a bucket are not repeated (small table, tiny cells)
  const t = e.swarm({ name: 'tiny', capacity: 8, cell: 0.01 }), hs = new Set();
  for (let i = 0; i < 8; i++) t.spawn({ x: i, z: -i });
  t.near(0, 0, 100, (dd, i) => { hs.add(dd.id[i]); });
  let tiny = 0; t.near(3, -3, 0.5, () => { tiny++; });
  out.tiny = [hs.size, tiny];
  s.dispose(); t.dispose();
  return out;
}

function walkCases(e) {
  const s = e.swarm({ name: 'walk', capacity: 64, fields: ['hp', 'seen'] }), d = s.data, out = {};
  for (let i = 0; i < 10; i++) s.spawn({ hp: i });
  // odd hp dies this step; no return (undefined) is not death
  const h1 = s.onStep((dd, i) => { dd.seen[i]++; if (dd.hp[i] % 2) return false; });
  e.step(1 / 60, { render: false });
  out.halfLeft = s.count;
  out.eachOnce = Array.from(d.seen.subarray(0, s.count)).every(v => v === 1);
  out.twice = code(() => s.onStep(() => {}));
  h1.remove();
  // removing other rows and spawning mid-walk: nobody is skipped or walked twice, and the new one does not move this step
  s.clear();
  const hs = []; for (let i = 0; i < 6; i++) hs.push(s.spawn({ hp: i }));
  const h2 = s.onStep((dd, i) => {
    dd.seen[i]++;
    if (dd.hp[i] === 1) { s.free(hs[0]); s.free(hs[4]); s.spawn({ hp: 100 }); out.midCount = s.count; }
  });
  e.step(1 / 60, { render: false });
  out.after = [s.count, s.row(hs[0]), s.row(hs[4])];
  const seen = {}; for (let i = 0; i < s.count; i++) seen[d.hp[i]] = d.seen[i];
  out.seen = seen;
  h2.remove();
  s.dispose();
  return out;
}

function timeCases(e) {
  e.time.channel('foes');
  const s = e.swarm({ name: 'foes', capacity: 4, channel: 'foes', fields: ['t'] }), d = s.data, out = {};
  const h = s.spawn();
  let calls = 0, lastDt = 0;
  s.onStep((dd, i, dt) => { calls++; lastDt = dt; dd.t[i] += dt; });
  e.step(0.5, { render: false });
  out.normal = [calls, +d.t[0].toFixed(3)];
  const slow = e.mod('time.foes', { owner: 'test', mul: 0.5 });
  calls = 0; e.step(1 / 60, { render: false });
  out.slowDt = +(lastDt * 60).toFixed(3);
  slow.remove();
  const stop = e.mod('time.foes', { owner: 'test', set: 0 });
  calls = 0; e.step(0.25, { render: false });
  out.stopped = calls;
  stop.remove();
  const f = e.freeze('test');
  const was = d.t[0]; calls = 0; e.step(0.25, { render: false });
  out.frozen = [calls, d.t[0] === was];
  e.stepBlend = 0.25;
  e._catchUp(1 / 60);
  out.blendHeld = e.stepBlend;
  f.remove?.(); e.unfreeze?.('test');
  out.row = s.row(h);
  s.dispose();
  return out;
}

async function saveCases(e) {
  const keep = e.swarm({ name: 'keep', capacity: 16, fields: ['hp'], save: true, color: true }), shots = e.swarm({ name: 'shots', capacity: 16 }), d = keep.data, out = {};
  const a = keep.spawn({ x: 1, hp: 5, color: 0xff0000 }), gone = keep.spawn({ x: 2, hp: 6 }), b = keep.spawn({ x: 3.25, y: 1, z: -2, hp: 7 });
  keep.free(gone);
  shots.spawn({ x: 1 });
  const before = JSON.stringify(keep._save());
  out.saved = await e.saves.save('t');
  keep.free(a); keep.spawn({ x: 50 }); keep.spawn({ x: 51 });
  out.loaded = await e.saves.load('t');
  out.same = JSON.stringify(keep._save()) === before;
  out.rows = [keep.count, keep.row(a) >= 0, d.hp[keep.row(a)], d.x[keep.row(b)], d.hp[keep.row(b)], d.r[keep.row(a)]];
  out.staleDead = keep.row(gone);
  out.shotsCleared = shots.count;
  const next = keep.spawn({ x: 9 });
  out.newHandle = next !== a && next !== b && next !== gone && keep.count === 3;
  // a swarm made after the load gets its data when made
  out.late = await (async () => {
    keep.dispose();
    await e.saves.load('t');
    const again = e.swarm({ name: 'keep', capacity: 16, fields: ['hp', 'extra'], save: true, color: true });
    return [again.count, again.data.hp[again.row(b)], again.data.extra[again.row(b)]];
  })();
  shots.spawn({ x: 2 });
  await e.session.newGame();
  out.newGameCleared = shots.count;   // a new game empties a swarm not in saves
  shots.dispose();
  return out;
}

async function draw(e, label) {
  const s = e.swarm({ name: 'draw', capacity: 2048, geometry: box(), material: new THREE.MeshBasicMaterial({ color: 0xffffff }), fields: ['vx', 'yaw', 'pitch', 'roll', 'scale'], color: true }), d = s.data, m = s.mesh, out = { label };
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 5000);
  const pixels = async () => {
    const r = e.renderer;
    if (r.isWebGPURenderer) { const rt = new TG.RenderTarget(W, H); renderOnce(r, e.scene, cam, rt); const b = new Uint8Array(await r.readRenderTargetPixelsAsync(rt, 0, 0, W, H)); rt.dispose(); return b; }
    const rt = new THREE.WebGLRenderTarget(W, H); renderOnce(r, e.scene, cam, rt);
    const b = new Uint8Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, b); rt.dispose(); return b;
  };
  const lit = (b, ch = 0) => { let c = 0; for (let i = 0; i < b.length; i += 4) if (b[i + ch] > 120) c++; return c; };
  out.backend = e.describe().renderer.backend;
  out.inScene = m.parent === e.scene && m.isInstancedMesh;
  e.step(1 / 60);
  out.empty = [m.count, lit(await pixels())];
  // interpolation: x=0 last step, x=1 this step, ratio 0.25 writes 0.25
  const h = s.spawn({ x: 0, vx: 60, color: 0xff0000 });
  const mover = s.onStep((dd, i, dt) => { dd.x[i] += dd.vx[i] * dt; });
  e.step(1 / 60, { render: false });
  e.stepBlend = 0.25;
  e._render(1 / 60);
  out.lerp = +m.instanceMatrix.array[12].toFixed(3);
  e.step(1 / 60);
  out.latest = +m.instanceMatrix.array[12].toFixed(3);
  mover.remove();
  // turn and scale match three's own maths
  d.yaw[0] = 0.7; d.pitch[0] = -0.4; d.roll[0] = 1.1; d.scale[0] = 2;
  e.step(1 / 60);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.7, 1.1, 'YXZ')), want = new THREE.Matrix4().compose(new THREE.Vector3(d.x[0], d.y[0], d.z[0]), q, new THREE.Vector3(2, 2, 2));
  out.matrixDiff = Math.max(...want.elements.map((v, i) => Math.abs(v - m.instanceMatrix.array[i])));
  // interpolation must not draw a line from the row's previous object
  s.free(h);
  const far = s.spawn({ x: 1000, y: 0, z: 1000, color: 0xff0000 });
  e.stepBlend = 0;
  e._render(1 / 60);
  out.noStreak = m.instanceMatrix.array[12];
  // the bounds follow: far away and in view it still draws; three's one-time bounds would cull it
  cam.position.set(1000, 30, 1000.01); cam.lookAt(1000, 0, 1000);
  e.step(1 / 60);
  out.sphere = [+m.boundingSphere.center.x.toFixed(2), +m.boundingSphere.radius.toFixed(2)];
  const seen = await pixels();
  out.farLit = lit(seen);
  out.farGreen = lit(seen, 1);
  // looking away: the whole swarm is culled
  cam.position.set(-1000, 30, -1000.01); cam.lookAt(-1000, 0, -1000);
  out.culledLit = lit(await pixels());
  // one draw call: many objects are still one InstancedMesh
  s.free(far);
  for (let i = 0; i < 2000; i++) s.spawn({ x: (rnd() - 0.5) * 30, z: (rnd() - 0.5) * 30, scale: 0.5, color: 0x00ff00 });
  cam.position.set(0, 40, 0.01); cam.lookAt(0, 0, 0);
  e.step(1 / 60);
  const crowd = await pixels();
  out.crowd = [m.count, lit(crowd, 1), lit(crowd, 0)];
  // a small capacity uses a uniform buffer on WebGPU and not an attribute (three picks by size); both paths must draw and follow
  const few = e.swarm({ name: 'few', capacity: 8, geometry: box(), material: new THREE.MeshBasicMaterial({ color: 0xff0000 }) });
  s.clear();
  const fh = few.spawn({ x: -8 });
  e.step(1 / 60);
  const left = await pixels();
  few.data.x[few.row(fh)] = 8;
  e.step(1 / 60);
  const right = await pixels(), mid = b => { let sx = 0, c = 0; for (let i = 0; i < b.length; i += 4) if (b[i] > 120) { sx += (i / 4) % W; c++; } return c ? Math.round(sx / c) : -1; };
  out.few = [mid(left), mid(right)];
  few.dispose();
  s.dispose();
  return out;
}

async function disposeCases() {
  const e = await make({}), geo = box(), mat = new THREE.MeshBasicMaterial(), out = {};
  let geoGone = 0, meshGone = 0;
  geo.addEventListener('dispose', () => geoGone++);
  const s = e.swarm({ name: 'one', capacity: 4, geometry: geo, material: mat }), t = e.swarm({ name: 'two', capacity: 4, geometry: geo, material: mat });
  s.mesh.addEventListener('dispose', () => meshGone++);
  t.mesh.addEventListener('dispose', () => meshGone++);
  s.spawn(); t.spawn();
  e.step(1 / 60);
  const ms = s.mesh;
  s.dispose(); s.dispose();
  out.one = [ms.parent, meshGone, Object.keys(e.describe().swarm).join()];
  e.unuse('swarm');
  out.unuse = [t.mesh.parent, meshGone, e.has('swarm')];
  e.use(swarm());
  const u = e.swarm({ name: 'three', capacity: 4, geometry: geo, material: mat }), um = u.mesh;
  let last = 0; um.addEventListener('dispose', () => last++);
  e.dispose();
  out.engine = [um.parent, last, geoGone];
  return out;
}

window.swarmCases = async () => {
  const e = await make({}), out = {};
  out.life = lifeCases(e);
  out.capacity = await capacityCases(e);
  out.near = nearCases(e);
  out.walk = walkCases(e);
  out.time = timeCases(e);
  out.save = await saveCases(e);
  out.webgl = await draw(e, 'webgl');
  e.dispose();
  const g = await make({ renderer: 'webgpu' });
  out.webgpu = await draw(g, 'webgpu');
  g.dispose();
  out.dispose = await disposeCases();
  return out;
};
window.engine = await make({ });
