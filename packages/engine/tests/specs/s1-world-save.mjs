// The "initial records + save diff" rule of world data, and level changes (top of world/World.js). Same format as the other files here.
const READY = { timeout: 60000 };
const reload = async page => { await page.reload(); await page.waitForFunction(() => window.engine?.stateApplied, null, READY); };

export const specs = [
  {
    name: 'S1 world data: initial records save only changes and removals, loading before / after content gives the same result, records newly added by content also exist when loading an old save (open world)',
    url: '/?cutscene=skip',
    async run({ page, check, ev }) {
      const r1 = await ev(async () => {
        engine.haltLoop();
        const W = engine.world, a = W.get('prop:rock:3').position, X = Math.round(a.x), Z = Math.round(a.z);
        const C = extra => ({ props: [{ id: 's1-ia', model: 'rock', x: X + 5, z: Z }, { id: 's1-ib', model: 'rock', x: X + 6, z: Z }, ...extra] });
        engine.content.load(C([]));
        engine.step(0.5);   // nearby models are built (a prop's height is recomputed when its model is built; it must match the value from adding for it to stay out of the save)
        W.remove('s1-ia'); W.remove('prop:flower:5');          // remove one of the content we added ourselves and one of the starting content
        W.move('s1-ib', { x: X + 8, z: Z });
        W.add({ kind: 's1tmp' }, { save: false });
        W.add({ id: 's1-run', kind: 's1run', position: [X, 0, Z], n: 1 });   // runtime record: saved whole
        let loads = 0; const h = engine.events.on('world:load', () => loads++);
        engine.saves.save('s1-init'); await engine.saves.flush();
        const d = JSON.parse(JSON.stringify(W.toJSON()));
        const saved = { untouched: Object.keys(d.changed).filter(k => /^(prop|pickup):/.test(k)), b: d.changed['s1-ib']?.set && Object.keys(d.changed['s1-ib'].set), bDel: d.changed['s1-ib']?.del,
          removed: d.removed, runtime: Object.keys(d.records).filter(id => /^s1/.test(id)), tmp: Object.values(d.records).some(x => x.kind === 's1tmp') };
        // same page: content is loaded first (with one more record, like a game update), then load the save
        W.move('s1-ib', { x: X + 6, z: Z }); W.set('s1-run', { n: 99 });
        engine.content.load(C([{ id: 's1-ic', model: 'rock', x: X + 7, z: Z }]));
        engine.saves.load('s1-init');
        const same = { a: !!W.get('s1-ia'), bx: W.get('s1-ib').position.x - X, c: !!W.get('s1-ic'), run: W.get('s1-run')?.n, tmp: W.query({ kind: 's1tmp' }).length, loads };
        h.remove();
        return { X, Z, saved, same };
      });
      check('save: untouched content is not stored, moved content stores only position, removed content leaves a tombstone, runtime records are stored whole, save:false is not stored',
        r1.saved.untouched.length === 0 && r1.saved.b?.join() === 'position' && !r1.saved.bDel && r1.saved.removed.includes('s1-ia') && r1.saved.removed.includes('prop:flower:5') && r1.saved.runtime.join() === 's1-run' && !r1.saved.tmp, JSON.stringify(r1.saved));
      check('content before load: removed ones stay removed, moves are restored, runtime records are restored, temporary records are cleared, world:load is emitted', !r1.same.a && r1.same.bx === 8 && r1.same.run === 1 && r1.same.tmp === 0 && r1.same.loads === 1, JSON.stringify(r1.same));
      check('a record newly added by content after a game update: exists after loading the old save', r1.same.c);
      await reload(page);
      const r2 = await ev(async ({ X, Z }) => {
        engine.haltLoop();
        const W = engine.world, C = extra => ({ props: [{ id: 's1-ia', model: 'rock', x: X + 5, z: Z }, { id: 's1-ib', model: 'rock', x: X + 6, z: Z }, ...extra] });
        const ret = engine.saves.load('s1-init'); if (ret?.then) await ret;
        const mid = { flower: !!W.get('prop:flower:5'), a: !!W.get('s1-ia'), b: !!W.get('s1-ib'), run: W.get('s1-run')?.n };
        engine.content.load(C([{ id: 's1-ic', model: 'rock', x: X + 7, z: Z }]));   // content is loaded only after the load
        const after = { a: !!W.get('s1-ia'), bx: W.get('s1-ib')?.position.x - X, c: !!W.get('s1-ic') };
        engine.saves.save('s1-init2'); engine.saves.load('s1-init2');   // save and load again: tombstones and changes are carried along
        const again = { a: !!W.get('s1-ia'), bx: W.get('s1-ib')?.position.x - X, flower: !!W.get('prop:flower:5'), c: !!W.get('s1-ic') };
        return { mid, after, again };
      }, r1);
      check('reopen the page and load (starting content already installed): the removed starting prop is gone, runtime records exist; nothing of our own content exists before it is installed', !r2.mid.flower && !r2.mid.a && !r2.mid.b && r2.mid.run === 1, JSON.stringify(r2.mid));
      check('content installed after the load: removed ones do not appear, moves are applied, new ones exist', !r2.after.a && r2.after.bx === 8 && r2.after.c, JSON.stringify(r2.after));
      check('save and load again: removals and moves are carried along', !r2.again.a && r2.again.bx === 8 && !r2.again.flower && r2.again.c, JSON.stringify(r2.again));
    },
  },
  {
    name: 'S1 world data: content placed by level markers carries a zone; remove / move -> change level -> come back still removed / moved (city)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const W = engine.world, T = engine.THREE, m = engine.level.marker('npc_shopkeeper').position.clone();
        engine.assets.manifest({ models: {
          's1-level2': () => { const g = new T.Group(), f = new T.Mesh(new T.BoxGeometry(40, 1, 40), new T.MeshBasicMaterial()); f.name = 'ground'; f.position.y = -0.5; g.add(f); return g; },
          's1cube': () => new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()),
        } });
        const data = { props: [{ id: 's1-lv-a', model: 's1cube', place: 'npc_shopkeeper', x: 2 }, { id: 's1-lv-b', model: 's1cube', place: 'npc_shopkeeper', x: 4 }] };
        engine.content.load(data);
        const zone = W.get('s1-lv-a')?.zone;
        W.remove('s1-lv-a');                          // equivalent to picking it up
        W.move('s1-lv-b', { x: m.x + 6, z: m.z });
        await engine.level.load('s1-level2'); engine.step(0.2);
        const mid = { b: !!W.get('s1-lv-b'), bView: !!W.view('s1-lv-b') };
        await engine.level.load('city-block'); engine.step(0.2);
        engine.content.load(data);                    // the game installs the content again when returning to this level
        return { zone, mid, a: !!W.get('s1-lv-a'), bx: Math.round((W.get('s1-lv-b')?.position.x - m.x) * 100) / 100 };
      });
      check('props placed by markers belong to the current level (zone)', r.zone === 'city-block', JSON.stringify(r));
      check('change to another level: the data stays, the model is torn down', r.mid.b && !r.mid.bView, JSON.stringify(r.mid));
      check('come back (content installed again): removed ones stay removed, moved ones stay at the new position', !r.a && r.bx === 6, JSON.stringify(r));
    },
  },
];
