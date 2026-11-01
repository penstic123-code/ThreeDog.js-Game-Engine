// world tightening (end of stage 1): a model build error does not block, refresh precision, no time lost, record-count quota, simulation center separate from the camera, frame-rate independence. Same format as s1-world.mjs; appended at the end of specs.mjs.
// Every item is a "do not bypass" guard: these behaviors must hold when changing world.
const box = 'new engine.THREE.Mesh(new engine.THREE.BoxGeometry(1, 1, 1), new engine.THREE.MeshBasicMaterial())';

export const specs = [
  {
    name: 'S1 world tightening: a synchronous build throw does not block ready and retries after walking away and back; a dispose error names the kind and loading still succeeds; a repeated present tears down the old one first (open world)',
    url: '/?cutscene=skip',
    expectErrors: /s1throw|s1disp/,   // make build / dispose fail on purpose
    async run({ check, ev }) {
      const r = await ev(async mk => {
        engine.pause();
        const W = engine.world, p = engine.player.position, box = new Function('return ' + mk);
        const errs = [], warns = [], ce = console.error, cw = console.warn;
        console.error = (...a) => { errs.push(a.map(String).join(' ')); ce(...a); };
        console.warn = (...a) => { const m = a.map(String).join(' '); if (!/outside a fixed step or an op/.test(m)) warns.push(m); cw(...a); };
        let builds = 0;
        W.present('s1throw', { build: () => { builds++; throw new Error('s1throw bad model'); } });
        W.add({ id: 's1-throw', kind: 's1throw', position: [p.x + 3, p.y, p.z] });
        W.refresh();
        const first = { ready: W.ready, view: W.view('s1-throw'), builds };
        W.move('s1-throw', [p.x + 300, p.y, p.z]); engine.step(0.1);
        W.move('s1-throw', [p.x + 3, p.y, p.z]); engine.step(0.1);
        const retried = builds;
        // the path that builds the model early inside simulation (positionFrom 'view') also does not block or freeze
        W.present('s1throwv', { positionFrom: 'view', build: () => { throw new Error('s1throwv bad model'); } });
        let nearCalls = 0;
        W.simulate('s1throwv', { near: () => { nearCalls++; } });
        W.add({ id: 's1-throwv', kind: 's1throwv', position: [p.x + 2, p.y, p.z] });
        engine.step(0.2);
        // dispose error: loading has to tear down models, and must not be reported as "world load failed"
        W.present('s1disp', { build: box, dispose: (rec, obj) => { throw new Error('s1disp bad dispose'); } });
        W.add({ id: 's1-disp', kind: 's1disp', position: [p.x + 4, p.y, p.z] });
        W.refresh();
        engine.saves.save('s1-disp');
        const loaded = await engine.saves.load('s1-disp');
        // dispose with a single parameter: the signature hint is shown at registration
        W.present('s1one', { build: box, dispose: obj => engine.remove(obj) });
        // the same kind registered again: old models are torn down with the old dispose, then built with the new build
        let oldDisposed = 0, newBuilt = 0;
        W.present('s1re', { build: box, dispose: (rec, obj) => { oldDisposed++; engine.remove(obj); } });
        W.add({ id: 's1-re', kind: 's1re', position: [p.x + 5, p.y, p.z] });
        W.refresh();
        const oldObj = W.view('s1-re');
        W.present('s1re', { build: () => { newBuilt++; return box(); } });
        W.refresh();
        console.error = ce; console.warn = cw;
        return { first, retried, nearCalls, frozen: engine.error, readyAfter: W._v.map.get('s1-throwv')?.pending === false, loaded,
          readFail: errs.some(s => /world load failed/.test(s)), dispErr: errs.some(s => /s1disp/.test(s) && /dispose/.test(s)),
          buildErr: errs.filter(s => /s1throw'/.test(s)).length, sigWarn: warns.some(s => /s1one/.test(s) && /\(rec, obj\)/.test(s)),
          oldDisposed, newBuilt, swapped: !!W.view('s1-re') && W.view('s1-re') !== oldObj };
      }, box);
      check('synchronous build throw: ready is not blocked, no model, reported only once', r.first.ready && r.first.view === null && r.first.builds === 1 && r.buildErr === 1, JSON.stringify(r));
      check('a failed build retries after walking away and back', r.retried === 2, r.retried);
      check('positionFrom view simulation throws while building the model early: simulation keeps running, no freeze, not counted as pending (ready is not blocked)', r.nearCalls > 5 && !r.frozen && r.readyAfter, JSON.stringify(r));
      check('dispose error: the message names the dispose of which kind, loading still succeeds (no world load failure reported)', r.dispErr && !r.readFail && r.loaded === true, JSON.stringify(r));
      check('dispose with a single parameter: the signature (rec, obj) is hinted at registration', r.sigWarn);
      check('present of the same kind again: the old model is torn down with the old dispose and rebuilt with the new build', r.oldDisposed === 1 && r.newBuilt === 1 && r.swapped, JSON.stringify(r));
    },
  },
  {
    name: 'S1 world tightening: moving the focus 9 m (same cell) or moving a record into the radius (same cell) both build the model; the "build within radius" error is at most 8 m (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(mk => {
        engine.pause();
        const W = engine.world, T = engine.THREE, p = engine.player.position, box = new Function('return ' + mk);
        const cs = W._cells.size, x0 = Math.floor(p.x / cs) * cs + 4, z = Math.floor(p.z / cs) * cs + 16, f = new T.Vector3(x0, p.y, z);
        globalThis.__cam = engine.takeCamera('s1', { focus: f });   // the test places the camera focus
        W.present('s1acc', { build: box, radius: 20 });
        W.add({ id: 's1-a', kind: 's1acc', position: [x0 + 26, p.y, z] });       // 26 m: outside the radius
        W.add({ id: 's1-b', kind: 's1acc', position: [x0 - 2 + 32 * 3, p.y, z] });  // very far
        engine.step(0.1);
        const before = !!W.view('s1-a');
        f.x = x0 + 13; engine.step(0.1);                                           // focus moves 9 m, same cell
        const afterFocus = !!W.view('s1-a');
        W.add({ id: 's1-c', kind: 's1acc', position: [x0 + 13 + 25, p.y, z] }); engine.step(0.1);
        const cBefore = !!W.view('s1-c');
        W.move('s1-c', [x0 + 13 + 18, p.y, z]); engine.step(0.1);                // record moves into the radius, same cell
        const cAfter = !!W.view('s1-c');
        globalThis.__cam?.remove();
        return { before, afterFocus, cBefore, cAfter };
      }, box);
      check('focus moved 9 m within the cell: the model inside the radius is built', !r.before && r.afterFocus, JSON.stringify(r));
      check('record moved into the radius within the cell: built on the next frame', !r.cBefore && r.cAfter, JSON.stringify(r));
    },
  },
  {
    name: 'S1 world tightening: far -> near catches up the owed time, far-only kinds also advance when near, records over the quota queue without losing time (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const W = engine.world, p = engine.player.position;
        let T = 0; const h = engine.onFixed(dt => { T += dt; });
        const owedOf = id => W.toJSON().owed[id] ?? 0;
        const acc = (rec, dt) => { rec.acc += dt; };
        W.simulate('s1t', { near: acc, far: acc, farEvery: 4, radius: 30 });
        W.simulate('s1crop', { far: acc, farEvery: 1 });
        const T0 = T;
        W.add({ id: 's1-t', kind: 's1t', position: [p.x + 200, p.y, p.z], acc: 0 });
        W.add({ id: 's1-crop', kind: 's1crop', position: [p.x + 2, p.y, p.z], acc: 0 });
        engine.step(2.5, { render: false });
        W.move('s1-t', [p.x + 5, p.y, p.z]);   // walk to the near zone
        engine.step(1, { render: false });
        const t = { acc: W.get('s1-t').acc, elapsed: T - T0 };
        const crop = { acc: W.get('s1-crop').acc, owed: owedOf('s1-crop'), elapsed: T - T0 };
        // quota: at most 5 per step, 200 records one round per 0.5 s (about 7 get a turn per step); the excess queues, dt accumulates, the total is not lost
        W.farMaxPerTick = 5;
        W.simulate('s1q', { far: acc, farEvery: 0.5 });
        const Tq = T, ids = [];
        for (let i = 0; i < 200; i++) ids.push(W.add({ kind: 's1q', position: [p.x + 300 + i, p.y, p.z], acc: 0 }).id);
        engine.step(3, { render: false });
        let worst = 0, maxOwed = 0;
        const owed = W.toJSON().owed;
        for (const id of ids) { const o = owed[id] ?? 0; worst = Math.max(worst, Math.abs(W.get(id).acc + o - (T - Tq))); maxOwed = Math.max(maxOwed, o); }
        W.farMaxPerTick = 500;
        h.remove();
        return { t, crop, worst, maxOwed };
      });
      check('far -> near: far first catches up the owed time, total = elapsed seconds', Math.abs(r.t.acc - r.t.elapsed) < 0.02, JSON.stringify(r.t));
      check('a far-only kind also advances when standing next to it: advanced + owed = elapsed seconds', r.crop.acc > r.crop.elapsed - 1.05 && Math.abs(r.crop.acc + r.crop.owed - r.crop.elapsed) < 0.02, JSON.stringify(r.crop));
      check('record quota: the excess queues, advanced + owed = elapsed seconds (for every record)', r.worst < 1e-6 && r.maxOwed > 0.5, JSON.stringify(r));
    },
  },
  {
    name: 'S1 world tightening: the simulation center follows the player, not the camera (anchor can be set); positionFrom view copies back into the data at the end of every fixed step (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(mk => {
        engine.pause();
        const W = engine.world, T = engine.THREE, p = engine.player.position, box = new Function('return ' + mk);
        const n = { home: 0, away: 0 };
        W.simulate('s1an', { near: rec => { n[rec.tag]++; }, radius: 30 });
        W.present('s1an', { build: box, radius: 30 });
        W.add({ id: 's1-home', kind: 's1an', position: [p.x + 3, p.y, p.z], tag: 'home' });
        W.add({ id: 's1-away', kind: 's1an', position: [p.x + 600, p.y, p.z], tag: 'away' });
        globalThis.__cam = engine.takeCamera('s1', { focus: new T.Vector3(p.x + 600, p.y, p.z) });   // the camera moves far away (like a cutscene)
        engine.step(1, { render: false });
        const cam = { ...n, homeView: !!W.view('s1-home'), awayView: !!W.view('s1-away') };
        n.home = n.away = 0;
        W.anchor = { x: p.x + 600, z: p.z };   // move the simulation center next to the far record
        engine.step(1, { render: false });
        const anchored = { ...n };
        W.anchor = null; globalThis.__cam?.remove();
        // positionFrom 'view': near simulation moves the model, and at the start of the next step (onFixed runs before world) the data read = the model position
        W.present('s1v', { positionFrom: 'view', build: box });
        W.simulate('s1v', { near: (rec, dt, obj) => { if (obj) obj.position.x += 0.1; } });
        W.add({ id: 's1-v', kind: 's1v', position: [p.x + 2, p.y, p.z] });
        let worst = 0, seen = 0;
        const h = engine.onFixed(() => { const o = W.view('s1-v'); if (o) { seen++; worst = Math.max(worst, Math.abs(W.get('s1-v').position.x - o.position.x)); } });
        engine.step(1, { render: false, frameEvery: 30 });   // very few frames: copying back must not wait for a frame
        h.remove();
        return { cam, anchored, worst, seen };
      }, box);
      check('camera moved away: records beside the player still get near simulation, those beside the camera do not count as near', r.cam.home > 50 && r.cam.away === 0, JSON.stringify(r.cam));
      check('models load around both default stream sources: the camera side and the player side each have a model', r.cam.awayView && r.cam.homeView, JSON.stringify(r.cam));
      check('world.anchor set far away: that side gets near simulation', r.anchored.away > 50 && r.anchored.home === 0, JSON.stringify(r.anchored));
      check('positionFrom view: the model position is copied back into the data at the end of every fixed step (not waiting for a frame)', r.seen > 50 && r.worst < 1e-9, JSON.stringify(r));
    },
  },
  {
    name: 'S1 world tightening: a wrong position (NaN, [x, z]) and set changing id / kind throw with a fix; removed fields do not exist after loading; large-radius queries do not stall and empty cells are deleted (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const W = engine.world, p = engine.player.position, v = p.clone();
        const err = f => { try { f(); return null; } catch (e) { return e.message; } };
        const nan = err(() => W.add({ kind: 's1e', position: [v[0], 0, v[2]] }));   // Vector3 used as an array
        W.add({ id: 's1-e', kind: 's1e', position: [p.x, p.y, p.z] });
        const xz = err(() => W.move('s1-e', [p.x, p.z]));
        const nan2 = err(() => W.move('s1-e', { x: NaN, z: 0 }));
        const kind = err(() => W.set('s1-e', { kind: 'other' }));
        // removed field: after loading it is "no such field"; a field that was null stays null
        W.add({ id: 's1-init', kind: 's1e', position: [p.x, p.y, p.z], extra: 1, note: 'x' }, { initial: true });
        delete W.get('s1-init').extra; W.set('s1-init', { note: null });
        engine.saves.save('s1-del'); engine.saves.load('s1-del');
        const back = W.get('s1-init'), del = { hasExtra: 'extra' in back, note: back.note };
        // a huge radius (Infinity) does not stall; forEachNear and query give the same count
        const all = W.query({ near: p, radius: Infinity }).length;
        let cnt = 0; W.forEachNear(p, 50, () => { cnt++; });
        const q50 = W.query({ near: p, radius: 50 }).length;
        // a record walks across 100 cells and comes back: empty cells are deleted, the cell count does not grow
        const c0 = W._cells.map.size;
        for (let i = 1; i <= 100; i++) W.move('s1-e', [p.x + i * 40, p.y, p.z]);
        W.move('s1-e', [p.x, p.y, p.z]);
        return { nan, xz, nan2, kind, del, all, total: W.records.size, cnt, q50, cells: [c0, W._cells.map.size], byKind: W.query({ kind: 's1e' }).length };
      });
      check('Vector3 used as an array (position NaN): throws with an explanation', /Vector3 used as an array/.test(r.nan ?? '') && /valid number/.test(r.nan2 ?? ''), JSON.stringify(r));
      check('move with an array of only two numbers: throws and says to write [x, y, z] or { x, z }', /three numbers/.test(r.xz ?? ''), r.xz);
      check('set changing kind: throws and says to remove then add', /remove then add/.test(r.kind ?? ''), r.kind);
      check('a removed field does not exist after loading (it is not null); a null field stays null', !r.del.hasExtra && r.del.note === null, JSON.stringify(r.del));
      check('radius: Infinity queries everything without stalling; forEachNear and query give the same count; a query by kind uses the pre-split table', r.all === r.total && r.cnt === r.q50 && r.byKind === 2, JSON.stringify(r));
      check('empty cells that were walked through are deleted', r.cells[1] === r.cells[0], JSON.stringify(r.cells));
    },
  },
  {
    name: 'S1 world tightening: frame-rate independence; for the same scenario at 1 / 2 / 4 fixed steps per frame, world data, clock, random and player position are identical (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const W = engine.world, R = engine.random, P = engine.player, p = P.position;
        // random walk when near, approach the player when far (crossing the near / far boundary), all using engine.random
        W.simulate('s1fr', {
          near: (rec, dt) => { rec.n += dt; if (R.chance(0.05)) W.move(rec.id, { x: rec.position.x + R.range(-2, 2), z: rec.position.z + R.range(-2, 2) }); },
          far: (rec, dt) => { rec.f += dt; W.move(rec.id, { x: rec.position.x + (p.x - rec.position.x) * 0.2, z: rec.position.z + (p.z - rec.position.z) * 0.2 }); },
          farEvery: 0.5, radius: 25,
        });
        for (let i = 0; i < 60; i++) W.add({ kind: 's1fr', position: [p.x + (i % 10) * 14 - 63, p.y, p.z + Math.floor(i / 10) * 14 - 35], n: 0, f: 0 });
        engine.step(0.5);
        engine.saves.save('s1-fr');
        // records moved by a physics body (positionFrom 'view' + rigid) are left out: the Rapier world's solver state is not saved, so after a load
        // resting bodies settle again with ~1e-5 m differences even at the same frame rate. Everything simulated by the engine itself must match exactly
        const physics = new Set([...W.records.values()].filter(rec => W.view(rec.id)?.userData?.body).map(rec => rec.id));
        const out = [];
        for (const fe of [1, 2, 4]) {
          engine.saves.load('s1-fr');
          engine.step(6, { frameEvery: fe, render: false });
          out.push({ world: JSON.stringify(W.toJSON(), (k, v) => physics.has(k) ? undefined : v), clock: engine.clock.now, random: JSON.stringify(R.toJSON()), player: [p.x, p.y, p.z].map(x => x.toFixed(5)).join() });
        }
        const diff = k => out.slice(1).map((o, i) => o[k] === out[0][k] ? null : `${[2, 4][i]}: ${String(o[k]).slice(0, 80)} ≠ ${String(out[0][k]).slice(0, 80)}`).filter(Boolean);
        let firstWorldDiff = null;
        for (let i = 1; i < 3 && !firstWorldDiff; i++) { const a = out[0].world, b = out[i].world; const k = [...a].findIndex((c, j) => c !== b[j]); if (k >= 0) firstWorldDiff = `${i}: …${a.slice(Math.max(0, k - 60), k + 60)} | …${b.slice(Math.max(0, k - 60), k + 60)}`; }
        return { world: diff('world').length, firstWorldDiff, clock: diff('clock'), random: diff('random'), player: diff('player'), size: out[0].world.length };
      });
      check('world data (including owed time and simulation step counts) is identical', r.world === 0, r.firstWorldDiff);
      check('clock and random are identical', !r.clock.length && !r.random.length, JSON.stringify(r));
      check('player position is identical', !r.player.length, JSON.stringify(r.player));
    },
  },
];
