// engine.threads (worker pool) and world far simulation in workers. Same format as specs.mjs, appended at the end of it.
// Every item is a "do not bypass" guard: workers only through engine.threads lanes, results that change gameplay only through engine.commits,
// and threads on / off must give bit-identical world records. The static "do not bypass" source scan (Worker / postMessage only in the pool) is rule R19 (npm run check).
// Runs in the page: two fresh headless engines (threads 0 and 2) with the same world content, advanced step by step with real waits so worker replies can land
const twin = async ({ steps }) => {
  const { createEngine, world } = threedogThreads;
  const make = async threads => {
    const E = createEngine({ canvas: document.createElement('canvas'), headless: true, loading: false, threads, urlState: false, saveKey: 'thr' + threads });
    E.use(world({ farEvery: 0.05 }));
    await E.start();
    const W = E.world;
    // far only (crops): many records, floats through Math.sin / exp so any difference shows; also moves the record (cell index update)
    W.simulate('crop', { worker: true, far: (rec, dt) => {
      rec.g = rec.g + Math.sin(rec.g * 3.1 + dt) * 0.01 + dt * Math.exp(-rec.g);
      rec.position = { x: rec.position.x + Math.cos(rec.g) * dt, y: 0, z: rec.position.z };
      if (rec.g > 1.1 && !rec.ripe) rec.ripe = true;
    } });
    // near + far: the anchor sweeps through them, so some turn near while their far batch is in flight (early landing)
    W.simulate('walker', { worker: true, radius: 20, near: (rec, dt) => { rec.n = (rec.n || 0) + dt; }, far: (rec, dt) => { rec.f = (rec.f || 0) + Math.sqrt(dt + rec.i); } });
    for (let i = 0; i < 400; i++) W.add({ id: 'c' + i, kind: 'crop', position: [i * 3 % 200, 0, (i * 7) % 200], g: i / 400 });
    for (let i = 0; i < 60; i++) W.add({ id: 'w' + i, kind: 'walker', position: [i * 5, 0, 0], i });
    W.anchor = { x: -500, z: 0 };
    return E;
  };
  const A = await make(0), B = await make(2);
  const snap = E => JSON.stringify([...E.world.records.values()].sort((a, b) => a.id < b.id ? -1 : 1));
  let diffAt = -1, ms = [0, 0];
  for (let s = 0; s < steps; s++) {
    const ax = -500 + s * 4;   // anchor sweep: walkers go far -> near -> far
    for (const [k, E] of [A, B].entries()) { E.world.anchor = { x: ax, z: 0 }; const t0 = performance.now(); E.step(1 / 60); ms[k] += performance.now() - t0; }
    if (diffAt < 0 && s % 10 === 9 && snap(A) !== snap(B)) diffAt = s;
    await new Promise(r => setTimeout(r, 4));
  }
  const out = { diffAt, same: snap(A) === snap(B), A: { ...A.commits.stats }, B: { ...B.commits.stats }, sizes: [A.threads.size, B.threads.size],
    lane: B.threads._pure?.size ?? 0, ripe: [...A.world.records.values()].filter(r => r.ripe).length, msPerStep: ms.map(m => +(m / steps).toFixed(3)) };
  A.dispose(); B.dispose();
  return out;
};

export const specs = [
  {
    name: 'threads: pool basics -- lane result equals main thread, a crashed worker falls back to the main thread, threads: false creates no worker, closure in a pure function names the variable (threads test page)',
    url: '/tests/threads/',
    expectErrors: /no-such-worker|Failed to load|MIME|worker failed/,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const T = engine.threads, L = T.pureLane();
        L.broadcast({ def: 't1', src: '(a, b) => { a.v = Math.sin(b) * Math.exp(b); return a.v * 2; }', label: 't1' }, 'def:t1');
        const got = await L.run({ call: 't1', items: [[{ v: 0 }, 1.234]] });
        const bad = T.lane({ create: () => new Worker('/no-such-worker.js', { type: 'module' }), local: () => m => m.x * 2 });
        const fell = await Promise.race([bad.run({ x: 21 }), new Promise(r => setTimeout(() => r('timeout'), 8000))]);
        const { createEngine } = threedogThreads;
        const off = createEngine({ canvas: document.createElement('canvas'), headless: true, loading: false, threads: false, urlState: false });
        const offLane = off.threads.lane({ create: () => { throw new Error('must not be called'); }, local: () => m => m + 1 });
        const offVal = await offLane.run(1);
        const offSize = [off.threads.size, offLane.size]; off.dispose();
        let msg = '';
        try { T.pure(((k) => (rec) => { rec.x = k; })(3), "world.simulate('x') far").call({}); } catch (e) { msg = e.message; }
        let asyncMsg = '';
        try { T.pure(async () => 1, 'lbl'); } catch (e) { asyncMsg = e.message; }
        return { size: T.size, laneSize: L.size, v: got[0].args[0].v, value: got[0].value, want: Math.sin(1.234) * Math.exp(1.234), fell, badSize: bad.size, offVal, offSize, msg, asyncMsg };
      });
      check('threads auto: at least one worker, the pure lane really runs in workers', r.size >= 1 && r.laneSize >= 1, JSON.stringify(r));
      check('worker result is bit-identical to the main thread (Math.sin / exp)', r.v === r.want && r.value === r.want * 2, `${r.v} vs ${r.want}`);
      check('a worker that fails to start: the lane answers from the main-thread handler', r.fell === 42 && r.badSize === 0, JSON.stringify(r));
      check('threads: false: size 0, the lane never calls create, the local handler answers', r.offVal === 2 && r.offSize[0] === 0 && r.offSize[1] === 0, JSON.stringify(r));
      check('closure variable in a pure function: registering it already names the variable and where it came from', /reads 'k'/.test(r.msg) && /simulate\('x'\)/.test(r.msg) && /inside the function/.test(r.msg), r.msg);
      check('async pure function is refused with a fix', /async/.test(r.asyncMsg) && /lbl/.test(r.asyncMsg), r.asyncMsg);
    },
  },
  {
    name: 'threads: world far with worker: true -- threads 2 and threads 0 give bit-identical records step by step, worker results really used (threads test page)',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(twin, { steps: 240 });
      check('threads 0 vs 2: records bit-identical at every checkpoint (every 10 steps, 240 steps, 460 records, near / far switching)', r.diffAt === -1 && r.same, JSON.stringify(r));
      check('threads 2 used worker results (at least one batch arrived before its due step; how many depends on machine speed)', r.sizes[1] === 2 && r.lane === 2 && r.B.late < r.B.applied, JSON.stringify(r));
      check('threads 0 computes every batch on the main thread at its due step', r.sizes[0] === 0 && r.A.late === r.A.applied && r.A.applied > 0, JSON.stringify(r));
      check('simulation actually progressed', r.ripe > 0, JSON.stringify(r));
      console.log(`   main-thread ms per step: threads 0 ${r.msPerStep[0]}, threads 2 ${r.msPerStep[1]}`);
    },
  },
];
