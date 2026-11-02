// Small perf items: collision grid index matches a linear scan, Events history off records nothing, counts() includes world / rigid / particles and stays flat across repeated save / load.
// Same style as specs.mjs, appended at the end of specs.mjs.
export const specs = [
  {
    name: 'S1 perf: collision grid index gives exactly the same callback sequence as a linear scan with many colliders (including add / remove), and is faster (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const C = engine.collision, g = engine.ground;
        const saved = g.forEachCollider; g.forEachCollider = undefined;   // compare only the manual-collider part
        let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
        const handles = [];
        for (let i = 0; i < 3000; i++) handles.push(C.addCircle([rnd() * 400 - 200, 0, rnd() * 400 - 200], { radius: 0.3 + rnd() * 2 }));
        for (let i = 0; i < 1500; i++) handles.push(C.addBox([rnd() * 400 - 200, 0, rnd() * 400 - 200], { halfWidth: 0.5 + rnd() * 4, halfDepth: 0.5 + rnd() * 4, rotation: rnd() * 6 }));
        handles.push(C.addBox([0, 0, 0], { halfWidth: 150, halfDepth: 3 }));   // oversized: takes the separate linear "big collider" path
        const linear = (x, z, range) => {
          const out = [];
          for (const c of C.circles) { const dx = c.x - x, dz = c.z - z, rr = range + c.r; if (dx * dx + dz * dz < rr * rr) out.push(c); }
          for (const b of C.boxes) { const dx = b.x - x, dz = b.z - z, rr = range + b.r; if (dx * dx + dz * dz < rr * rr) out.push(b); }
          return out;
        };
        const qs = Array.from({ length: 300 }, () => [rnd() * 440 - 220, rnd() * 440 - 220, 1 + rnd() * 12]);
        const compare = () => {
          let bad = 0, hits = 0;
          for (const [x, z, range] of qs) {
            const want = linear(x, z, range);
            const got2 = C._grid.query(x, z, range).map(it => it._b ? it : `${it.x},${it.z},${it.r}`);
            const want2 = want.map(o => o.hw !== undefined ? o : `${o.x},${o.z},${o.r}`);
            hits += want.length;
            if (want2.length !== got2.length || want2.some((w, i) => w !== got2[i])) bad++;
          }
          return { bad, hits };
        };
        const first = compare();
        for (let i = 0; i < handles.length; i += 3) handles[i].remove();   // remove a third, then compare again
        const afterRemove = compare();
        const time = f => { const t0 = performance.now(); for (let k = 0; k < 5; k++) for (const [x, z, range] of qs) f(x, z, range); return performance.now() - t0; };
        // best of 3 alternating rounds: a busy machine (other browsers, GC) slows one round, not the fastest of each
        let msLinear = Infinity, msGrid = Infinity;
        for (let k = 0; k < 3; k++) {
          msLinear = Math.min(msLinear, time((x, z, range) => { for (const o of linear(x, z, range)); }));
          msGrid = Math.min(msGrid, time((x, z, range) => { for (const o of C._grid.query(x, z, range)); }));
        }
        // real usage: resolve pushes the character out; equal results follow from equal callback sequences, so only check that it does not throw
        const p = { x: 3, z: 0 }; C.resolve(p, 0.4);
        g.forEachCollider = saved;
        for (const h of handles) h.remove();
        return { first, afterRemove, msLinear: Math.round(msLinear * 10) / 10, msGrid: Math.round(msGrid * 10) / 10, total: C.circles.length + C.boxes.length };
      });
      check('4500 colliders: callback sequence of 300 random queries matches the linear scan', r.first.bad === 0 && r.first.hits > 100, JSON.stringify(r.first));
      check('Still identical after removing a third', r.afterRemove.bad === 0, JSON.stringify(r.afterRemove));
      // timed in the same run, so machine speed cancels out; the index is normally far ahead, the 3x margin absorbs noise (JIT, GC)
      check('Grid index is faster than the linear scan (1500 queries)', r.msGrid * 3 < r.msLinear, `linear ${r.msLinear}ms, grid ${r.msGrid}ms (must be at least 3x faster)`);
      console.log(`    [data] 4500 colliders, 1500 queries: linear ${r.msLinear}ms -> grid ${r.msGrid}ms`);
    },
  },
  {
    name: 'S1 perf: Events.historySize = 0 records no history, default 200 unchanged (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const E = engine.events, size0 = E.historySize;
        E.historySize = 0; E.history.length = 0;
        let got = 0; const h = E.on('s1:perf', () => got++);
        for (let i = 0; i < 50; i++) E.emit('s1:perf', { i });
        const off = { len: E.history.length, recent: E.recent('s1:perf').length, got };
        E.historySize = 3;
        for (let i = 0; i < 10; i++) E.emit('s1:perf', { i });
        const on = E.recent('s1:perf').length;
        h.remove(); E.historySize = size0;
        return { size0, off, on };
      });
      check('Keeps 200 entries by default', r.size0 === 200, r.size0);
      check('historySize = 0: no history, listeners still receive events', r.off.len === 0 && r.off.recent === 0 && r.off.got === 50, JSON.stringify(r.off));
      check('historySize = 3: keeps only the latest 3', r.on === 3, r.on);
    },
  },
  {
    name: 'S1 perf: engine.counts() includes world / rigid / particles, and nothing grows over 10 save -> load cycles (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        engine.world.add({ id: 's1p-a', kind: 's1p', position: [5, 0, 5], n: 1 });
        const round = async () => { engine.saves.save('s1p'); await engine.saves.flush(); const ret = engine.saves.load('s1p'); if (ret?.then) await ret; engine.step(0.2); };
        await round();
        const first = engine.counts();
        for (let i = 0; i < 9; i++) await round();
        return { first, last: engine.counts() };
      });
      const f = r.first, l = r.last;
      check('counts() carries world.records / world.views / rigid / particles', typeof f.world?.records === 'number' && typeof f.world.views === 'number' && typeof f.rigid === 'number' && typeof f.particles?.alive === 'number' && typeof f.particles.emitters === 'number', JSON.stringify(f));
      const flat = c => ({ ...c, ...c.world && { 'world.records': c.world.records, 'world.views': c.world.views }, ...c.particles && { 'particles.emitters': c.particles.emitters } });
      const a = flat(f), b = flat(l), grown = Object.keys(a).filter(k => typeof a[k] === 'number' && b[k] > a[k]);
      check('Counts are the same after the 1st and 10th save / load (listeners, timers, geometries, world records etc. do not accumulate)', grown.length === 0, grown.map(k => `${k}: ${a[k]} → ${b[k]}`).join(', '));
    },
  },
];
