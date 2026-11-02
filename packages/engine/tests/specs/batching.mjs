// engine.batching (core/Batching.js): repeated static props drawn as one InstancedMesh per cell. Same style as specs.mjs; appended at the end.
// Uses the open-world example: 24 'rock' props placed in one 64 m cell next to the player (ids bt-<i>), plus 10 with batch: false.

/** Load the test props and wait until their models are built (prop models are async) */
async function setup() {
  const tick = () => new Promise(r => setTimeout(r, 0));
  engine.pause();
  const W = engine.world, B = engine.batching, cs = B.cell, p = engine.player.position;
  const ox = Math.floor(p.x / cs) * cs, oz = Math.floor(p.z / cs) * cs, cell = `${ox / cs},${oz / cs}`;
  const props = [];
  for (let i = 0; i < 24; i++) props.push({ id: `bt-${i}`, model: 'rock', x: ox + 6 + (i % 6) * 9, z: oz + 6 + Math.floor(i / 6) * 9 });
  for (let i = 0; i < 10; i++) props.push({ id: `bt-off-${i}`, model: 'pine', batch: false, x: ox + 10 + i * 4, z: oz + 50 });
  engine.content.load({ props });
  for (let i = 0; i < 40 && (!W.view('bt-23') || !W.view('bt-off-9') || !W.ready); i++) { engine.step(0.1); await tick(); }
  engine.step(0.1);
  const batchOf = id => B.of(W.view(id))[0] ?? null;
  return { W, B, cell, batchOf, tick };
}

export const specs = [
  {
    // 不许绕开: a game's own scene.add / engine.add meshes are never moved to layer 31 or drawn by an InstancedMesh unless userData.batch = true
    name: '[guard] batching: game-made meshes stay as made (layer 0, own Raycaster hits them); dev hint names the opt-in; userData.batch = true batches them (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => { try {
        const { B } = await window.__bt();
        const T = engine.THREE, g = new T.BoxGeometry(0.4, 0.4, 0.4), m = new T.MeshStandardMaterial(), p = engine.player.position;
        const mine = [], opted = [];
        for (let i = 0; i < 12; i++) { const x = new T.Mesh(g, m); x.position.set(p.x + 3 + i * 0.6, p.y + 40, p.z + 3); (i % 2 ? engine.scene : engine).add(x); mine.push(x); }
        engine.step(0.05); engine.step(0.05);
        const rc = new T.Raycaster(new T.Vector3(mine[0].position.x, p.y + 60, mine[0].position.z), new T.Vector3(0, -1, 0));
        const own = { layer0: mine.every(x => x.layers.mask === 1 && !B.of(x).length), hit: rc.intersectObjects(engine.scene.children, true)[0]?.object === mine[0],
          hint: B.stats.hint ?? null, counted: B.plain.get(`${g.id}|${m.id}`)?.n ?? 0, perf: /userData\.batch = true/.test(engine.inspect.perf().text) };
        const g2 = new T.BoxGeometry(0.2, 0.2, 0.2);
        for (let i = 0; i < 12; i++) { const x = new T.Mesh(g2, m); x.position.set(p.x + 3 + i * 0.6, p.y, p.z + 5); x.userData.batch = true; engine.scene.add(x); opted.push(x); }
        engine.step(0.05); engine.step(0.05);
        const opt = { batched: opted.every(x => B.of(x).length === 1) };
        for (const x of [...mine, ...opted]) engine.remove(x);
        engine.step(0.05);
        return { own, opt, after: B.plain.has(`${g.id}|${m.id}`) };
      } catch (err) { return { err: String(err.stack) }; } });
      if (r.err) { check('runs without error', false, r.err); return; }
      check('12 identical game meshes (scene.add and engine.add) are not batched: layer 0, no instance', r.own.layer0, JSON.stringify(r.own));
      check('a plain THREE.Raycaster over the scene hits the game mesh itself', r.own.hit, JSON.stringify(r.own));
      check('dev hint in batching.stats and inspect.perf() names userData.batch = true', r.own.counted === 12 && /userData\.batch = true/.test(r.own.hint) && r.own.perf, JSON.stringify(r.own));
      check('userData.batch = true opts game meshes in (batched)', r.opt.batched, JSON.stringify(r.opt));
      check('removed game meshes no longer count toward the hint', r.after === false, String(r.after));
    },
  },
  {
    name: 'batching: same-model props become one batch per cell; move / recolor / pick / remove one item; batch: false opt-out; shadows (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => { try {
        const { W, B, cell, batchOf } = await window.__bt();
        const b0 = batchOf('bt-0'), mine = B.batches.filter(b => b.cell === cell && b.items.includes(W.view('bt-0')));
        const same = Array.from({ length: 24 }, (_, i) => batchOf(`bt-${i}`)?.mesh).every(m => m && m === b0.mesh);
        const first = { ok: !!b0, isInstanced: !!b0?.mesh.isInstancedMesh, batches: mine.length, count: mine[0]?.count,
          cast: b0?.mesh.castShadow, receive: b0?.mesh.receiveShadow,
          meshHidden: (() => { let h = true; W.view('bt-0').traverse(o => { if (o.isMesh && o.visible && o.layers.test(engine.camera.layers)) h = false; }); return h; })(), same,
          inScene: (() => { let s = false; for (let o = b0?.mesh; o; o = o.parent) if (o === engine.scene) s = true; return s; })() };
        // opt-out
        const off = Array.from({ length: 10 }, (_, i) => W.view(`bt-off-${i}`));
        const optOut = { built: off.every(Boolean), none: off.every(o => o && !B.of(o).length), visible: off.every(o => { let v = false; o?.traverse(m => { if (m.isMesh && m.visible && m.layers.test(engine.camera.layers)) v = true; }); return v; }) };
        // move one inside a fixed step (gameplay changes go through fixed steps / ops)
        const at = W.get('bt-5').position, to = { x: at.x + 1.5, z: at.z + 1 };
        const h = engine.onFixed(() => { W.move('bt-5', to); h.remove(); }); engine.step(0.1);
        const s = batchOf('bt-5'), a = s.mesh.instanceMatrix.array, o = s.index * 16;
        const moved = { x: a[o + 12], z: a[o + 14], want: to, viewX: W.view('bt-5').position.x };
        // recolor
        B.tint(W.view('bt-7'), 0xff0000); engine.step(0.05);
        const t = batchOf('bt-7'), c = t.mesh.instanceColor.array.slice(t.index * 3, t.index * 3 + 3), other = batchOf('bt-8');
        const tint = { c: [...c], other: [...other.mesh.instanceColor.array.slice(other.index * 3, other.index * 3 + 3)] };
        // pick: the ray returns the original item, not the batch
        const pos = W.view('bt-5').position, hit = engine.raycast([to.x, pos.y + 30, to.z], [0, -1, 0]);
        let root = hit?.object; while (root && root.parent !== engine.scene) root = root.parent;
        const pick = { hit: !!hit, isItem: root === W.view('bt-5'), notBatch: !hit?.object.isInstancedMesh };
        // remove one
        const n0 = batchOf('bt-0').mesh.count, h2 = engine.onFixed(() => { W.remove('bt-9'); h2.remove(); }); engine.step(0.1);
        const removed = { before: n0, after: batchOf('bt-0').mesh.count, gone: !W.view('bt-9') };
        const d = engine.describe().perf.batching;
        return { first, optOut, moved, tint, pick, removed, describe: d };
      } catch (err) { return { err: String(err.stack) }; } });
      if (r.err) { check('runs without error', false, r.err); return; }
      check('24 same-model props in one cell: one InstancedMesh batch holding all of them, in the scene', r.first.ok && r.first.isInstanced && r.first.batches === 1 && r.first.count >= 24 && r.first.same && r.first.inScene, JSON.stringify(r.first));
      check('the placed object stays, its own meshes are hidden (drawn by the batch)', r.first.meshHidden, JSON.stringify(r.first));
      check('batch casts and receives shadows like the props', r.first.cast === true && r.first.receive === true, JSON.stringify(r.first));
      check('batch: false props are not batched and draw on their own', r.optOut.built && r.optOut.none && r.optOut.visible, JSON.stringify(r.optOut));
      check('world.move of one item moves its instance', Math.abs(r.moved.x - r.moved.want.x) < 1e-3 && Math.abs(r.moved.z - r.moved.want.z) < 1e-3, JSON.stringify(r.moved));
      check('tint recolors only that instance', r.tint.c[0] === 1 && r.tint.c[1] === 0 && r.tint.c[2] === 0 && r.tint.other.every(v => v === 1), JSON.stringify(r.tint));
      check('engine.raycast returns the item (its original mesh), not the batch', r.pick.hit && r.pick.isItem && r.pick.notBatch, JSON.stringify(r.pick));
      check('world.remove of one item takes its instance out', r.removed.gone && r.removed.after === r.removed.before - 1, JSON.stringify(r.removed));
      check('describe().perf.batching reports batches / instances / saved', r.describe && r.describe.batches >= 1 && r.describe.saved === r.describe.instances - r.describe.batches, JSON.stringify(r.describe));
    },
  },
  {
    name: 'batching: unloading a cell frees its batch, coming back rebuilds it; saves identical with batching on / off and after save-load; global switch (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { W, B, cell, batchOf, tick } = await window.__bt();
        const P = engine.player, home = P.position.clone();
        const here = () => B.batches.filter(b => b.cell === cell).length;
        const before = { batches: here(), mesh: batchOf('bt-0')?.mesh };
        P.placeAt({ x: home.x + 2000, z: home.z }); engine.step(3);
        const away = { batches: here(), view: !!W.view('bt-0'), data: !!W.get('bt-0'), freed: !before.mesh?.parent };
        P.placeAt({ x: home.x, z: home.z });
        for (let i = 0; i < 40 && !W.view('bt-23'); i++) { engine.step(0.1); await tick(); }
        engine.step(0.1);
        const back = { batches: here(), item: !!batchOf('bt-0') };
        // saves: batching never touches save data
        const c1 = JSON.stringify(engine.saves.collect().parts);
        B.enabled = false;
        const off = { batches: B.batches.length, shown: (() => { let v = false; W.view('bt-0').traverse(m => { if (m.isMesh && m.visible && m.layers.test(engine.camera.layers)) v = true; }); return v; })() };
        const c2 = JSON.stringify(engine.saves.collect().parts);
        B.enabled = true; engine.step(0.05);
        const on = { item: !!batchOf('bt-0') };
        // world.owed (near-sim bookkeeping) is left out: it drops the player entry on load with or without batching
        const parts = () => { const p = engine.saves.collect().parts; if (p.world) delete p.world.owed; return JSON.stringify(p); };
        const cs = parts();
        await engine.saves.save('bt-save');
        await engine.saves.load('bt-save');
        const c3 = parts();
        return { before: before.batches, away, back, off, on, same12: c1 === c2, same13: cs === c3, diff: (() => { const a = JSON.parse(cs), b = JSON.parse(c3), out = []; for (const k in a) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k + ': ' + JSON.stringify(a[k]).slice(0, 300) + ' VS ' + JSON.stringify(b[k]).slice(0, 300)); return out.join(' | '); })() };
      });
      check('cell near: has a batch', r.before >= 1, String(r.before));
      check('walk far: views torn down, the cell batch is freed (removed from the scene), data kept', r.away.batches === 0 && !r.away.view && r.away.data && r.away.freed, JSON.stringify(r.away));
      check('walk back: the batch is rebuilt', r.back.batches >= 1 && r.back.item, JSON.stringify(r.back));
      check('batching.enabled = false dissolves every batch and shows the originals; true batches again', r.off.batches === 0 && r.off.shown && r.on.item, JSON.stringify({ off: r.off, on: r.on }));
      check('save data identical with batching on and off', r.same12);
      check('save -> load round trip: save data identical', r.same13, r.diff);
    },
  },
].map(s => ({ ...s, async run(ctx) { await ctx.ev(src => { window.__bt = new Function('return ' + src)(); }, setup.toString()); return s.run.call(this, ctx); } }));
