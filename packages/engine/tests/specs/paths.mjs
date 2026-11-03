// Async pathfinding (engine.characters.findPathAsync): threads on / off give identical paths at identical steps, statuses stay honest,
// a dead worker falls back to the main thread. The "do not bypass" guard (one A*, one Recast query, NPCs only use the async entry) is rule R20 (npm run check).
// Runs in the page: engines with threads 0 and 2 get the same requests; every answer is logged with the step it landed on
const twin = async ({ useNav, n, crash = true, change = true }) => {
  const { createEngine, world, collision, characters, level, nav, THREE } = threedogThreads;
  const maze = () => {   // 40x40 floor, a wall across z = 0 with gaps at both ends (same layout as the nav test page)
    const g = new THREE.Group(), m = new THREE.MeshBasicMaterial();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), m); floor.name = 'floor'; g.add(floor);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(24, 3, 1), m); wall.name = 'col_wall'; wall.position.set(0, 1.5, 0); g.add(wall);
    return g;
  };
  const make = async threads => {
    const E = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, threads, urlState: false, saveKey: 'path' + threads });
    E.use(world(), collision(), characters({ npcs: false }));
    if (useNav) E.use(level({ scene: maze() }), nav());
    await E.start();
    for (let i = 0; i < 100 && useNav && !E.nav.ready; i++) await new Promise(r => setTimeout(r, 50));
    if (!useNav) for (let i = 0; i < 40; i++) E.collision.addBox([(i * 37) % 120 - 60, 0, (i * 53) % 120 - 60], { halfWidth: 1 + i % 5, halfDepth: 1 + (i * 3) % 4, rotation: i * 0.3 });
    return E;
  };
  const A = await make(0), B = await make(2);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const span = useNav ? 18 : 70, reqs = Array.from({ length: n }, () => [{ x: (rnd() * 2 - 1) * span, z: (rnd() * 2 - 1) * span }, { x: (rnd() * 2 - 1) * span, z: (rnd() * 2 - 1) * span }]);
  const logs = [[], []], ms = [0, 0], syncMs = [0];
  const ask = (E, k, from, to, i) => E.characters.findPathAsync(from, to, (path, status) => logs[k].push(`${i}@${E.tick}:${status}:${JSON.stringify(path)}`));
  const steps = async (count, k) => { const t0 = performance.now(); for (let s = 0; s < count; s++) { [A, B][k].step(1 / 60); await new Promise(r => setTimeout(r, 2)); } return performance.now() - t0; };
  if (!crash) {   // cost run: workers already started and holding the mesh (a game's first requests also pay that once); base = step cost without requests
    for (const E of [A, B]) E.characters.findPathAsync({ x: 1, z: -5 }, { x: 1, z: 5 }, () => {});
    await Promise.all([steps(60, 0), steps(60, 1)]);
  }
  const before = [A, B].map(E => ({ ...E.commits.stats }));
  for (const [k, E] of [A, B].entries()) reqs.forEach(([f, t], i) => ask(E, k, f, t, i));
  // the same requests answered synchronously, for the main-thread cost comparison
  { const t0 = performance.now(); for (const [f, t] of reqs) A.characters.findPath(f, t); syncMs[0] = performance.now() - t0; }
  let crashed = false, s = 0;
  for (; s < 200 && (logs[0].length < n + 2 || logs[1].length < n + 2); s++) {
    for (const [k, E] of [A, B].entries()) {
      if (s === 3 && change) {   // the walkable state changes while batches are in flight: those answers are recomputed on the new state, identically in both
        if (useNav) E.collision.addBox([16, 0, 0], { halfWidth: 4.5, halfDepth: 1 }); else E.collision.addCircle([0, 0, 0], { radius: 3 });
      }
      if (s === 6 && k === 1 && crash) { const lane = [...E.threads.lanes].find(l => /pathWorker/.test(l.create.toString())); if (lane) { lane._crash('test'); crashed = lane.size === 0; } }
      if (s === 6) { ask(E, k, { x: -15, z: -5 }, { x: 15, z: 5 }, 'late'); ask(E, k, { x: 0, z: -5 }, { x: 300, z: 300 }, 'far'); }
      const t0 = performance.now(); E.step(1 / 60); ms[k] += performance.now() - t0;
    }
    await new Promise(r => setTimeout(r, 4));
  }
  const base = [0, 0];
  for (const k of [0, 1]) { for (let i = 0; i < s; i++) { const t0 = performance.now(); [A, B][k].step(1 / 60); base[k] += performance.now() - t0; } }
  const sorted = l => [...l].sort().join('\n');
  const out = { n, same: logs[0].join('\n') === logs[1].join('\n'), sameSet: sorted(logs[0]) === sorted(logs[1]), counts: logs.map(l => l.length), crashed,
    statuses: [...new Set(logs[0].map(s => s.split(':')[1]))], far: logs[0].find(s => s.startsWith('far@')), firstDiff: logs[0].find((s, i) => s !== logs[1][i]),
    stats: [A, B].map((E, k) => ({ applied: E.commits.stats.applied - before[k].applied, late: E.commits.stats.late - before[k].late })), ms: ms.map((m, k) => +(m - base[k]).toFixed(1)), syncMs: +syncMs[0].toFixed(1), sizes: [A.threads.size, B.threads.size] };
  A.dispose(); B.dispose();
  return out;
};

export const specs = [
  {
    name: '[guard] nav: engine.dispose() frees the Recast objects (navMesh / query / tileCache / crowd live in the WASM heap)',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, world, collision, characters, level, nav, THREE } = threedogThreads;
        const g = new THREE.Group(), f = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial()); f.name = 'floor'; g.add(f);
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'nav-dispose' });
        E.use(world(), collision(), characters({ npcs: false }), level({ scene: g }), nav());
        await E.start();
        for (let i = 0; i < 100 && !E.nav.ready; i++) await new Promise(res => setTimeout(res, 50));
        const freed = [];
        for (const k of ['navMesh', 'query', 'tileCache', 'crowd']) { const o = E.nav[k]; if (o?.destroy) { const d = o.destroy.bind(o); o.destroy = () => { freed.push(k); d(); }; } }
        const N = E.nav, ready = N.ready;
        E.dispose();
        return { ready, freed, after: N.navMesh ?? null };
      });
      check('the navmesh was built, and engine.dispose() destroyed it and its query', r.ready && r.freed.includes('navMesh') && r.freed.includes('query') && r.after === null, JSON.stringify(r));
    },
  },
  {
    name: 'paths: findPathAsync with A* -- threads 0 and 2 give identical paths on identical steps, also across a collider change and a worker crash (threads test page)',
    url: '/tests/threads/',
    expectErrors: /worker failed/,
    async run({ check, ev }) {
      const r = await ev(twin, { useNav: false, n: 300 });
      check('threads 0 vs 2: every answer (step, status, path) identical, in the same order', r.same && r.counts[0] === r.n + 2, JSON.stringify({ ...r, firstDiff: r.firstDiff?.slice(0, 200) }));
      check('a crashed path worker hands its work to the main thread, answers unchanged', r.crashed, JSON.stringify(r.crashed));
      check('A* without nav reports ok / noPath', r.statuses.every(s => s === 'ok' || s === 'noPath') && r.statuses.includes('ok'), r.statuses.join());
    },
  },
  {
    name: 'paths: findPathAsync main-thread cost -- no crash, no state change: threads 2 uses worker answers (threads test page)',
    url: '/tests/threads/',
    async run({ check, ev }) {
      for (const useNav of [false, true]) {
        const n = useNav ? 300 : 300, r = await ev(twin, { useNav, n, crash: false, change: false });
        check(`${useNav ? 'navmesh' : 'A*'}: identical answers, threads 2 used worker results (how many depends on machine speed)`, r.same && r.stats[1].late < r.stats[1].applied, JSON.stringify({ ...r, firstDiff: undefined }));
        console.log(`   ${n} ${useNav ? 'navmesh' : 'A*'} paths, main-thread ms: sync findPath ${r.syncMs}; findPathAsync (all steps) threads 0 ${r.ms[0]}, threads 2 ${r.ms[1]}; late ${r.stats[1].late}/${r.stats[1].applied}`);
      }
    },
  },
  {
    name: 'paths: findPathAsync with the navmesh -- worker Recast copy answers like the main thread, notReady vs noPath stay distinct (threads test page)',
    url: '/tests/threads/',
    expectErrors: /worker failed/,
    async run({ check, ev }) {
      const r = await ev(twin, { useNav: true, n: 120 });
      check('threads 0 vs 2: every navmesh answer identical (imported mesh in the worker = live mesh here)', r.same && r.counts[0] === r.n + 2, JSON.stringify({ ...r, firstDiff: r.firstDiff?.slice(0, 200) }));
      check('a goal off the mesh is noPath, not notReady', /^far@\d+:noPath:null$/.test(r.far || ''), r.far);
      const s = await ev(async () => {
        const { createEngine, world, collision, characters, level, nav, THREE } = threedogThreads;
        const g = new THREE.Group(), f = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial()); f.name = 'floor'; g.add(f);
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, threads: 2, urlState: false, saveKey: 'pathnr' });
        E.use(world(), collision(), characters({ npcs: false }), level({ scene: g }), nav());
        await E.start();
        E.nav.dispose();   // installed but not ready: A* stands in and says so
        const got = [];
        E.characters.findPathAsync({ x: 0, z: 0 }, { x: 5, z: 5 }, (p, st) => got.push(st));
        for (let i = 0; i < 10; i++) E.step(1 / 60);
        let bad = ''; try { E.characters.findPathAsync({ x: 0, z: 0 }, { x: 1, z: 1 }); } catch (err) { bad = err.message; }
        E.dispose();
        return { got, bad };
      });
      check('nav installed but not ready: notReady (with the A* stand-in path)', s.got[0] === 'notReady', JSON.stringify(s));
      check('missing done callback: the error says what to pass', /done must be a function/.test(s.bad), s.bad);
    },
  },
];
