// 第三次审查，优先项 2：世界和分块。全部走公开接口。名字带 [review3 FAILING] 的是实锤；其余是守卫。
const page0 = '/?threedog-headless';
// 默认页面没有全局 THREE：从场景里现成的网格取构造函数
const steps = `let src = null; engine.scene.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material)) src ??= o; }); const THREE = { Mesh: src.constructor, BoxGeometry: src.geometry.constructor, MeshBasicMaterial: src.material.constructor, MeshStandardMaterial: src.material.constructor, Vector3: engine.player.position.constructor }; const steps = async n => { for (let i = 0; i < n; i++) { engine.step(1 / 60); if (i % 30 === 0) await new Promise(r => setTimeout(r, 0)); } };`;
const inPage = (ev, body) => ev(new Function(`return (async () => { ${steps}\n${body} })()`));

export const specs = [
  {
    name: 'review3 world: a slow model that arrives after its record left the area, was removed, or a new game began leaves nothing in the scene',
    url: page0,
    async run({ check, ev }) {
      const r = await inPage(ev, `
        const gates = [], disposed = [];
        const h = engine.world.present('r3slow', { radius: 40, build: rec => new Promise(res => gates.push(() => { const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); m.name = 'r3-' + rec.id; res(m); })), dispose: (rec, o) => disposed.push(rec.id) });
        const p = engine.player.position;
        const add = id => engine.world.add({ id, kind: 'r3slow', position: { x: p.x + 2, y: 0, z: p.z + 2 } });
        const count = () => { let n = 0; engine.scene.traverse(o => { if (o.name?.startsWith('r3-')) n++; }); return n; };
        add('a'); add('b'); add('c'); await steps(3);
        const built = gates.length;
        engine.world.remove('a');
        engine.world.move('b', { x: p.x + 900, z: p.z + 900 });
        await steps(3);
        await engine.session.newGame(); await steps(3);
        for (const g of gates) g();
        await new Promise(r => setTimeout(r, 20)); await steps(3);
        const left = count(), recs = engine.world.query({ kind: 'r3slow' }).map(x => x.id);
        h.remove();
        return { built, left, recs, disposed };
      `);
      check('three builds started', r.built === 3, JSON.stringify(r));
      check('no model of a gone record stays in the scene', r.left <= r.recs.length, JSON.stringify(r));
    },
  },
  {
    name: 'review3 world: batching follows records out of and back into range, nothing is drawn twice or left over',
    url: page0,
    async run({ check, ev }) {
      const r = await inPage(ev, `
        const geo = new THREE.BoxGeometry(), mat = new THREE.MeshStandardMaterial();
        const h = engine.world.present('r3box', { radius: 60, build: rec => { const m = new THREE.Mesh(geo, mat); m.name = 'r3b'; return m; } });
        const p = engine.player.position.clone(), N = 24;
        for (let i = 0; i < N; i++) engine.world.add({ id: 'r3b' + i, kind: 'r3box', position: { x: p.x + (i % 6) * 3, y: 0, z: p.z + (i / 6 | 0) * 3 } });
        await steps(60);
        const look = () => { const st = engine.batching.stats; let plain = 0, inst = 0; engine.scene.traverse(o => { if (o.isInstancedMesh && o.geometry === geo) inst += o.count; if (o.isMesh && !o.isInstancedMesh && o.geometry === geo && !o.layers.isEnabled(31)) plain++; }); return { batches: st.batches, instances: st.instances, plain, inst, views: engine.world.query({ kind: 'r3box' }).filter(x => engine.world.view(x.id)).length }; };
        const go = p => { let on = true; (async () => { for (let i = 0; on && i < 4000; i++) await steps(2); })(); return p.finally(() => { on = false; }); };
        const near1 = look();
        const start = [p.x, p.y, p.z];
        await go(engine.stream.teleport([p.x + 700, 0, p.z + 700], { timeout: 60 }).catch(e => e)); await steps(90);
        const far = look();
        await go(engine.stream.teleport(start, { timeout: 60 }).catch(e => e)); await steps(90);
        const near2 = look();
        for (let i = 0; i < N; i += 2) engine.world.remove('r3b' + i);
        await steps(30);
        const half = look();
        h.remove(); await steps(10);
        return { near1, far, near2, half, end: look() };
      `);
      const J = JSON.stringify(r);
      check('all drawn once near', r.near1.plain + r.near1.inst === 24, J);
      check('all drawn once on the way back', r.near2.plain + r.near2.inst === 24, J);
      check('removed records leave', r.half.plain + r.half.inst === 12, J);
      check('nothing left when the presenter leaves', r.end.plain + r.end.inst === 0, J);
    },
  },
  {
    name: 'review3 world: chunks after source ping-pong match a fresh load (ground under the player, collision, table size)',
    url: page0,
    async run({ check, ev }) {
      const r = await inPage(ev, `
        const p = engine.player.position.clone(), probe = [[p.x + 5, p.z + 5], [p.x - 30, p.z + 12], [p.x + 60, p.z - 44]];
        const before = probe.map(q => engine.surface(q[0], q[1]));
        const bBlock = probe.map(q => engine.collision?.blocked?.(q[0], q[1]) ?? null);
        const d0 = JSON.stringify(engine.describe().terrain ?? null).length;
        const far = [];
        for (let i = 0; i < 12; i++) {
          const s = engine.stream.source([p.x + 400 * (1 + i % 3), 0, p.z - 300 * (i % 2)], { radius: 96 });
          far.push(s);
          await steps(1 + i % 3);
          if (i % 2) s.remove();
        }
        for (const s of far) s.remove();
        await steps(240);
        await engine.stream.whenReady?.catch?.(() => {});
        return { same: probe.every((q, i) => Math.abs(engine.surface(q[0], q[1]) - before[i]) < 1e-6), blocks: probe.every((q, i) => (engine.collision?.blocked?.(q[0], q[1]) ?? null) === bBlock[i]), err: engine.error?.message ?? null, sources: engine.describe().stream?.sources ?? null, d0 };
      `);
      check('ground, collision the same, no error', r.same && r.blocks && !r.err, JSON.stringify(r));
    },
  },
  {
    name: 'review3 world: a job booked with apply never lands in a later playthrough; a throwing generator fails only its promise',
    url: page0,
    async run({ check, ev }) {
      const r = await inPage(ev, `
        let applied = 0, ran = 0;
        const j = engine.jobs.add(function* () { for (let i = 0; i < 50; i++) { ran++; yield; } return 1; }, { apply: () => { applied++; }, lag: 30 });
        await engine.session.newGame();
        await steps(60);
        await Promise.race([j, new Promise(r => setTimeout(r, 200))]);
        let msg = null;
        const bad = engine.jobs.add(function* () { yield; throw new Error('r3 boom'); }, { apply: () => { applied += 100; }, lag: 2 }).catch(e => { msg = e.message; });
        await steps(10); await bad;
        return { applied, ran, msg, frozen: !!engine.error };
      `);
      check('no apply after the new game, no freeze', r.applied === 0 && r.msg === 'r3 boom' && !r.frozen, JSON.stringify(r));
    },
  },
  {
    name: '[guard] jobs: an endless generator with apply fails by name at maxSteps, it cannot hang the fixed step',
    url: page0,
    async run({ check, ev }) {
      const r = await ev(async () => { let n = 0, applied = 0, code = null; const was = engine.jobs.maxSteps; engine.jobs.maxSteps = 5000; const p = engine.jobs.add(function* () { for (;;) { if (++n > 3e6) throw new Error('r3 stop'); yield; } }, { apply() { applied++; }, lag: 1 }).catch(e => { code = e.code; }); for (let i = 0; i < 5; i++) engine.step(1 / 60); await p; engine.jobs.maxSteps = was; return { n, applied, code, pending: engine.jobs.pending, frozen: !!engine.error }; });
      check('the fixed step stopped a job that never ends (maxSteps 5000 per run)', r.n < 1e5, JSON.stringify(r));
      check('its promise names the failure, apply did not run, the game goes on', r.code === 'jobs-endless' && !r.applied && !r.pending && !r.frozen, JSON.stringify(r));
    },
  },
];
