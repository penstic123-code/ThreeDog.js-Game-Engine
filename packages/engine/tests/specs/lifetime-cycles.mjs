// [guard] Repeat create / dispose (outside review: "an engine with modules, created and disposed again and again, must not grow").
// Per cycle: the engine drawing a few frames with terrain, vegetation, water, sky, particles and weather, then dispose(). Across cycles the page must not grow:
// live DOM listeners (window / document / the canvas), document children and styles, the patch state (Object3D.prototype.add identity, threePatches list),
// engine.counts() of a fresh engine, and the GPU memory the renderer still reports after dispose (geometries / textures: 0).
// WebGPU: renderer: 'webgpu' here runs WebGPURenderer on its WebGL2 backend (what headless test browsers have), not a real WebGPU device.
// Run: npm test -- Lifetime
const PAGE = '/tests/lifetime/index.html';

/** Runs in the page (ev passes it { opts, n }, so it cannot use anything outside itself): n cycles with the given createEngine options; returns what changed between the first and the last cycle */
async function cycles({ opts, n, parts = true }) {
  {
    const { THREE, make, threePatches } = window.lifetime, out = { errors: [], per: [] };
    const onErr = ev => out.errors.push(String(ev.message || ev));
    window.addEventListener('error', onErr);
    // live listeners: add minus remove, ignoring those whose AbortSignal has fired (the browser dropped them)
    const live = new Set(), targets = [EventTarget.prototype];
    const origAdd = EventTarget.prototype.addEventListener, origRemove = EventTarget.prototype.removeEventListener;
    const key = (t, type, fn, cap) => ({ t, type, fn, cap: typeof cap === 'object' ? !!cap?.capture : !!cap });
    const entries = [];
    EventTarget.prototype.addEventListener = function (type, fn, o) { if (fn && !entries.some(x => x.t === this && x.type === type && x.fn === fn)) entries.push({ ...key(this, type, fn, o), signal: o?.signal, once: !!o?.once }); return origAdd.call(this, type, fn, o); };
    EventTarget.prototype.removeEventListener = function (type, fn, o) { const i = entries.findIndex(x => x.t === this && x.type === type && x.fn === fn); if (i >= 0) entries.splice(i, 1); return origRemove.call(this, type, fn, o); };
    const liveListeners = () => entries.filter(x => !x.signal?.aborted && !x.once && !(x.t instanceof Node && !x.t.isConnected && x.t !== window) && !(x.t instanceof AbortSignal)).length;
    const base = { listeners: liveListeners(), body: document.body.children.length, head: document.head.children.length, add: THREE.Object3D.prototype.add, remove: THREE.Object3D.prototype.remove };
    const patches = () => JSON.stringify(threePatches.list().map(p => [p.id, p.on]));
    const patches0 = patches();
    for (let i = 0; i < n; i++) {
      const e = make(opts, parts);
      await e.start();
      e.camera.position.set(0, 4, 10); e.camera.lookAt(0, 0, 0);
      e.weather?.set?.('wet');
      for (let k = 0; k < 6; k++) e.step(1 / 30);
      e.particles?.emit('puff', { x: 0, y: 3, z: 0 }, { count: 10 });
      e.step(1 / 30);
      const c = e.counts();
      const cell = { listeners: c.listeners, fixed: c.fixed, frame: c.frame, timers: c.timers, jobs: c.jobs, commits: c.commits, statics: c.statics, geometries: c.geometries, textures: c.textures };
      e.dispose();
      const m = e.renderer.info.memory;
      out.per.push({ counts: cell, after: { geometries: m.geometries, textures: m.textures }, listeners: liveListeners(), body: document.body.children.length, head: document.head.children.length,
        addSame: THREE.Object3D.prototype.add === base.add && THREE.Object3D.prototype.remove === base.remove, patches: patches(), counts2: e.disposed });
    }
    EventTarget.prototype.addEventListener = origAdd; EventTarget.prototype.removeEventListener = origRemove;
    window.removeEventListener('error', onErr);
    out.leaked = entries.filter(x => !x.signal?.aborted && !x.once && !(x.t instanceof AbortSignal)).map(x => `${x.t?.constructor?.name}:${x.type}:${String(x.fn).slice(0, 80)}`).slice(0, 6);
    out.base = base && { listeners: base.listeners, body: base.body, head: base.head }; out.patches0 = patches0;
    return out;
  }
}

function judge(check, label, r, n, webgpu = false) {
  const first = r.per[0], last = r.per.at(-1);
  check(`${label}: ${n} cycles ran, no page errors`, r.per.length === n && r.errors.length === 0, JSON.stringify(r.errors.slice(0, 3)));
  check(`${label}: a fresh engine's counts() are the same in the first and the last cycle (no growth of listeners, hooks, timers, jobs, geometries, textures)`,
    JSON.stringify(first.counts) === JSON.stringify(last.counts), JSON.stringify({ first: first.counts, last: last.counts }));
  // WebGPURenderer keeps counting its own internals after dispose (three.js itself, with one mesh and nothing else: 1 geometry, 2 textures; the
  // engine's modules add 1 and 3 on top, constant per renderer): there the numbers must only stay the same every cycle and small
  check(`${label}: after dispose the renderer reports ${webgpu ? 'the same few (<= 4 geometries, <= 8 textures)' : 'no'} geometries or textures, every cycle`,
    r.per.every(p => webgpu ? p.after.geometries === first.after.geometries && p.after.textures === first.after.textures && p.after.geometries <= 4 && p.after.textures <= 8 : p.after.geometries === 0 && p.after.textures === 0), JSON.stringify(r.per.map(p => p.after)));
  check(`${label}: live DOM listeners, document children and head children are back to the start after every dispose`,
    r.per.every(p => p.listeners === r.base.listeners && p.body === r.base.body && p.head === r.base.head), JSON.stringify({ leaked: r.leaked, base: r.base, per: r.per.map(p => [p.listeners, p.body, p.head]) }));
  check(`${label}: the Object3D.add / remove wrapper and the threePatches list do not change across cycles`, r.per.every(p => p.addSame && p.patches === r.patches0), JSON.stringify({ p0: r.patches0, last: last.patches, same: last.addSame }));
}

export const specs = [
  {
    name: 'Lifetime: 25 create / dispose cycles of an engine with modules (WebGL) do not grow listeners, DOM, counts, GPU memory or patch state',
    url: PAGE,
    software: true,
    async run({ check, ev }) {
      judge(check, 'webgl', await ev(cycles, { opts: {}, n: 25 }), 25);
    },
  },
  {
    name: 'Lifetime: 20 create / dispose cycles on WebGPURenderer (its WebGL2 backend in test browsers, not a real WebGPU device) do not grow either',
    url: PAGE,
    software: true,
    async run({ check, ev }) {
      judge(check, 'webgpu(webgl2 backend)', await ev(cycles, { opts: { renderer: 'webgpu' }, n: 20 }), 20, true);
    },
  },
];
