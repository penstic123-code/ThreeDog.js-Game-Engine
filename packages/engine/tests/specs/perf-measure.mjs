// Performance measurement: cpuMs covers a whole frame and the budget samples this frame (not the previous one); the cost of applying background
// results (terrain chunks, vegetation, colliders, GPU upload, stream builds) is split in stages and readable from describe().perf.apply and the budget.
export const specs = [
  {
    serial: true,   // timing assertion: runs alone, not beside other pages
    name: 'PERF cpuMs：一帧 CPU 含 fixed/frame/render/afterRender 四段，Budget 采到的是本帧而不是上一帧',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const burn = ms => { const t = performance.now(); while (performance.now() - t < ms); };
        engine.budget.enable({});
        engine.use({ name: 'perfburn', type: 'rules', frame() { burn(3); }, afterRender() { burn(4); } });
        const log = [], b = engine.budget, orig = b.sample;
        b.sample = function (dt) {   // the engine calls this once per real-time frame, after the afterRender hooks
          orig.call(this, dt);
          const p = engine._cpuPhases;
          log.push({ cpu: engine._cpuMs, sampled: this._cpu.at(-1), sum: p.fixed + p.frame + p.render + p.afterRender, frame: p.frame, after: p.afterRender });
        };
        await __t.until(() => log.length >= 14, 20000);
        b.sample = orig;
        const rows = log.slice(2);   // the burn hooks may be installed mid-frame
        return { n: rows.length, rows, desc: engine.describe().perf };
      });
      check('collected frames from the real-time loop', r.n >= 10, String(r.n));
      check('what Budget samples is the cpuMs of the same frame', r.rows.every(x => x.sampled === x.cpu), JSON.stringify(r.rows[0]));
      check('cpuMs is the sum of the four phases', r.rows.every(x => Math.abs(x.cpu - x.sum) < 1e-6), JSON.stringify(r.rows[0]));
      check('frame hooks (3 ms burned) and afterRender hooks (4 ms burned) are inside cpuMs, already in the frame that sampled',
        r.rows.every(x => x.frame >= 2.8 && x.after >= 3.8 && x.cpu >= 6.8), JSON.stringify(r.rows[0]));
      check('describe().perf.cpu gives the phases', r.desc.cpu && r.desc.cpu.afterRender >= 3.5 && r.desc.cpu.frame >= 2.5, JSON.stringify(r.desc.cpu));
    },
  },
  {
    serial: true,   // timing assertion: runs alone, not beside other pages
    name: 'PERF 后台结果回到主线程：传输 / 建 three 对象 / 碰撞体 / GPU 上传按段计时，流式进入新区域能出一份数字',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const T = engine.terrain, cost = engine.budget.cost, pl = engine.player.position;
        const first = cost.report();   // everything from startup: the first-screen chunks
        cost.reset();
        engine.player.placeAt({ x: pl.x + 700, z: pl.z });   // far enough that the whole ring around the player is new
        const ok = await __t.until(() => T.stats.builtThisFrame === 0 && T.stats.queued === 0 && T.chunks.size > 0 && cost.t.build.n >= 9 && cost.t.collider.n > 0, 90000).then(() => true, () => false);
        await new Promise(res => setTimeout(res, 500));
        const moved = cost.report();
        const e = engine.stream.add({ position: [pl.x, 0, pl.z], radius: 30, build: () => new engine.THREE.Mesh() });
        await __t.until(() => cost.t.stream.n >= 1, 20000).catch(() => {});
        e.remove();
        const values = engine.budget.enable({ applyBuildMs: 1000 }).values();
        engine.budget.disable();
        return { first, moved, ok, stream: cost.report().stream, desc: engine.describe().perf.apply, values, keys: Object.keys(cost.report()) };
      });
      check('startup chunks were counted', r.first.build.n > 0 && r.first.transit.n > 0 && r.first.transit.bytes > 0, JSON.stringify(r.first));
      check('moving 700 m: chunks arrive, every stage has results', r.ok && r.moved.transit.n > 0 && r.moved.build.n > 0 && r.moved.collider.n > 0 && r.moved.upload.n > 0, JSON.stringify(r.moved));
      check('times are finite and not negative', Object.values(r.moved).every(s => Number.isFinite(s.totalMs) && s.totalMs >= 0 && s.maxMs <= s.totalMs + 1e-6));
      check('stream build() callback is timed', r.stream.n >= 1, JSON.stringify(r.stream));
      check('describe().perf.apply lists the five stages', r.keys.join() === 'transit,build,collider,upload,stream' && Object.keys(r.desc).join() === r.keys.join(), JSON.stringify(r.desc));
      check('budget.values() has applyBuildMs and friends', ['applyTransitMs', 'applyBuildMs', 'applyColliderMs', 'applyUploadMs', 'applyStreamMs'].every(k => typeof r.values[k] === 'number'), JSON.stringify(r.values));
    },
  },
  {
    serial: true,   // timing assertion: runs alone, not beside other pages
    name: 'PERF 近处植被某种类在区块里一棵都没有时，结果应用后不会无限重发 detail 任务',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const T = engine.terrain, cost = engine.budget.cost, pl = engine.player.position;
        engine.player.placeAt({ x: pl.x + 700, z: pl.z });
        await __t.until(() => T.stats.queued === 0 && T.stats.builtThisFrame === 0 && T.chunks.size > 0, 90000);
        await new Promise(res => setTimeout(res, 1500));   // let every first-ring detail job come back
        // 碰撞体按固定步数分批建（每步 1 块，不看墙钟，回放才一致），所以"多久到齐"取决于这台机器每秒跑几个固定步：
        // 无头软件渲染下帧率低、每帧补的固定步有上限，原来睡固定 4 秒只到 1/9。这里等到齐（带上限），检查的仍是"全部到齐"
        const CH = T.generator.CHUNK, pcx = Math.floor(engine.player.position.x / CH), pcz = Math.floor(engine.player.position.z / CH);
        const ring = () => { let n = 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (engine.rigid.terrain.get((pcx + dx) + ',' + (pcz + dz))?.ready) n++; return n; };
        await __t.until(() => ring() === 9, 30000).catch(() => {});
        const ringReady = ring();
        cost.reset();
        await new Promise(res => setTimeout(res, 2500));   // standing still: nothing should be requested any more
        return { ringReady, ringWant: 9, idle: cost.report().transit.n, chunks: T.chunks.size, near: engine.vegetation.nearNames().length, pending: engine.rigid._srcPending };
      });
      check('colliders of a new ring are built over several steps but all arrive (and nothing is left pending)', r.ringReady === r.ringWant && r.ringWant >= 9 && r.pending === false, JSON.stringify(r));
      check('scene has a near-only species', r.near > 0, JSON.stringify(r));
      check('standing still: worker results stay bounded (no resend loop)', r.idle <= 3, JSON.stringify(r));
    },
  },
];
