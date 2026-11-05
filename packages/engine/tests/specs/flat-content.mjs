// Flat content (recipes/30-templates.md "A group of things"): a stall and a gun nest written by hand as plain entries, each standing at a place.
// Guards: offsets and facing turn with the place, one edit of the place moves records, models and collision together, play's own moves survive that edit,
// `source` finds the copies through world.query, and deleting an entry under an old save leaves a reported orphan instead of a crash.
// Everything goes through content.load, the real collision module and the real save, so a second way of placing a group fails here.
const READY = { timeout: 60000 };

// the same content before and after a reload; drop = entry ids deleted from the content
const setup = (drop = []) => {
  const T = engine.THREE, p = engine.player.position, x = Math.round(p.x), z = Math.round(p.z);
  engine.assets.manifest({ name: 'fc', models: {
    fcCrate: () => new T.Mesh(new T.BoxGeometry(2, 2, 1).translate(0, 1, 0)),
    fcPost: () => new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 2, 8).translate(0, 1, 0)),
  } });
  const places = { 'stall-1': { x: x + 12, z: z + 10 }, 'nest-1': { x: x - 12, z: z + 12, rot: Math.PI / 2 } };
  const data = {
    items: { fcBerry: { name: 'Berry' } },
    templates: {
      fcChest: { model: 'fcCrate', collide: 'box', state: { opened: false }, container: { capacity: 4, items: { fcBerry: 2 } } },
      fcWall: { model: 'fcCrate', collide: 'box' },
      fcTurret: { model: 'fcPost', collide: 'circle', state: { ammo: 30 } },
    },
    props: [
      // a farm stall: counter, chest beside it, lamp in front
      { id: 'stall-1-counter', model: 'fcCrate', collide: 'box', place: 'stall-1', source: 'stall' },
      { id: 'stall-1-chest', template: 'fcChest', place: 'stall-1', x: 3, source: 'stall' },
      { id: 'stall-1-lamp', model: 'fcPost', collide: 'circle', place: 'stall-1', x: -3, z: 1, rot: 0.25, source: 'stall' },
      // a shooter's nest: wall ahead, turret to the side, on a place that is already turned
      { id: 'nest-1-wall', template: 'fcWall', place: 'nest-1', z: 2, source: 'nest' },
      { id: 'nest-1-turret', template: 'fcTurret', place: 'nest-1', x: 3, rot: 0.5, ammo: 5, source: 'nest' },
    ].filter(e => !drop.includes(e.id)),
  };
  engine.content.load(data, { places });
  return { data, places, x, z };
};

export const specs = [
  {
    name: 'Flat content: a stall and a nest as plain entries; offsets and facing turn with the place; source is queryable; a moved and turned place carries models and collision, not what play moved [guard]',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async src => {
        'use strict';
        engine.haltLoop();
        const { data, places, x, z } = (0, eval)(src)();
        const W = engine.world, settled = async () => { engine.step(0.5); await W.whenReady; engine.step(0.1); engine.step(0.1); };
        await settled();
        const n = v => +v.toFixed(3), at = id => ({ x: n(W.get(id).position.x), z: n(W.get(id).position.z), rot: W.get(id).rot === undefined ? null : n(W.get(id).rot) });
        const statics = t => { const out = []; engine.collision.forEachStatic((k, o) => { if (k === t) out.push(o); }); return out; };
        const box = (bx, bz) => statics('box').filter(b => Math.hypot(b.x - bx, b.z - bz) < 0.2).length;
        const circle = (cx, cz) => statics('circle').filter(c => Math.hypot(c.x - cx, c.z - cz) < 0.2).length;
        const view = id => { const o = W.view(id); return o ? { x: n(o.position.x), z: n(o.position.z), rot: n(o.rotation.y) } : null; };
        const first = {
          wall: at('nest-1-wall'), turret: at('nest-1-turret'), turretView: view('nest-1-turret'), counter: at('stall-1-counter'),
          stall: W.query({ where: e => e.source === 'stall' }).map(e => e.id).sort(), nestChest: W.query({ kind: 'fcChest', where: e => e.source === 'nest' }).length,
          place: engine.content.place('nest-1'),
        };
        // play moves the lamp and turns the chest, then the author moves and turns the whole stall: one edit of one place
        const lampPlay = { x: x + 5, z: z + 14 };
        engine.ops.allow(() => { W.move('stall-1-lamp', lampPlay); W.set('stall-1-chest', { rot: 1 }); });
        await settled();
        const sx = places['stall-1'].x, sz = places['stall-1'].z, to = { x: sx - 2, z: sz + 4, rot: Math.PI / 2 };
        const before = { box: box(sx, sz), free: engine.collision.walkable([to.x, 0, to.z]) };
        engine.content.load(data, { places: { 'stall-1': to } });
        await settled();
        const after = {
          counter: at('stall-1-counter'), counterView: view('stall-1-counter'), chest: at('stall-1-chest'), chestView: view('stall-1-chest'), lamp: at('stall-1-lamp'),
          oldBox: box(sx, sz), newBox: box(to.x, to.z), chestBox: box(to.x, to.z - 3), blocked: !engine.collision.walkable([to.x, 0, to.z]), oldFree: engine.collision.walkable([sx, 0, sz]),
          lampCircle: circle(lampPlay.x, lampPlay.z),
        };
        const { changed } = engine.saves.collect().parts.world;
        const refused = (() => { try { engine.content.load({}, { places: { bad: { x: 0, z: 0, rot: 'east' } } }); return null; } catch (e) { return e.message; } })();
        return { x, z, nest: places['nest-1'], to, first, before, after, refused, changed: { counter: changed['stall-1-counter'] ?? null, chest: changed['stall-1-chest'] ?? null, lamp: changed['stall-1-lamp'] ?? null } };
      }, setup.toString());
      const { first: f, after: a, nest, to } = r, near = (v, w) => Math.abs(v - w) < 0.01;
      check('a place with rot turns the offsets: z = 2 ahead lands 2 along +x at a quarter turn, x = 3 lands 3 along -z',
        near(f.wall.x, nest.x + 2) && near(f.wall.z, nest.z) && near(f.turret.x, nest.x) && near(f.turret.z, nest.z - 3), JSON.stringify(f));
      check('the facing adds up: the place rot alone on an entry without rot, place + own rot on one with rot, and the model shows it',
        near(f.wall.rot, Math.PI / 2) && near(f.turret.rot, Math.PI / 2 + 0.5) && near(f.turretView?.rot, f.turret.rot), JSON.stringify(f));
      check('a place without rot leaves a record without rot', f.counter.rot === null, JSON.stringify(f.counter));
      check('source finds the copies of one arrangement through world.query, by itself and with kind', f.stall.join() === 'stall-1-chest,stall-1-counter,stall-1-lamp' && f.nestChest === 0, JSON.stringify(f.stall));
      check('content.place reports rot', near(f.place?.rot, Math.PI / 2), JSON.stringify(f.place));
      check('[guard] a moved and turned place carries the record, the model and its facing', near(a.counter.x, to.x) && near(a.counter.z, to.z) && near(a.counter.rot, to.rot)
        && near(a.counterView?.x, to.x) && near(a.counterView?.z, to.z) && near(a.counterView?.rot, to.rot), JSON.stringify(a));
      check('[guard] collision follows: the box is gone from the old spot and stands at the new one, walkers are stopped there and pass the old one',
        r.before.box === 1 && r.before.free && a.oldBox === 0 && a.newBox === 1 && a.blocked && a.oldFree, JSON.stringify({ b: r.before, a }));
      check('[guard] what play changed stays: the moved lamp keeps its spot and collider, the chest moves with the place but keeps the rot play gave it',
        near(a.lamp.x, r.x + 5) && near(a.lamp.z, r.z + 14) && a.lampCircle === 1 && near(a.chest.x, to.x) && near(a.chest.z, to.z - 3) && near(a.chest.rot, 1), JSON.stringify(a));
      check('the turned offset of the chest reaches its collision (a box at its new spot)', a.chestBox === 1, JSON.stringify(a));
      check('[guard] the save stays a diff: the place edit adds nothing, play moves stay', r.changed.counter === null && !!r.changed.lamp?.set?.position && r.changed.chest?.set?.rot === 1 && !r.changed.chest?.set?.position, JSON.stringify(r.changed));
      check('a place rot that is no number is refused at the load, naming the place', /Place "bad": rot must be a number/.test(r.refused ?? ''), r.refused);
    },
  },
  {
    name: 'Flat content: save, delete an entry from the content, reload: the game starts, the old change is a reported orphan and survives the next save [guard]',
    url: '/?cutscene=skip',
    async run({ page, check, ev }) {
      await ev(async src => {
        'use strict';
        engine.haltLoop();
        (0, eval)(src)();
        const W = engine.world;
        engine.step(0.5); await W.whenReady; engine.step(0.1);
        engine.ops.allow(() => { W.set('stall-1-chest', { opened: true }); W.set('nest-1-turret', { ammo: 2 }); });
        await engine.saves.save('fc1'); await engine.saves.flush();
      }, setup.toString());
      await page.reload();
      await page.waitForFunction(() => window.engine?.stateApplied, null, READY);
      const r = await ev(async src => {
        'use strict';
        engine.haltLoop();
        const warns = [], warn = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); warn(...a); };
        (0, eval)(src)(['stall-1-chest']);
        const W = engine.world, ok = await engine.saves.load('fc1');
        engine.step(0.5); await W.whenReady; engine.step(0.1);
        const orphans = engine.describe().world.orphans ?? [], again = engine.saves.collect().parts.world;
        console.warn = warn;
        return { ok, orphans, said: warns.find(w => /no longer defines/.test(w)) ?? null, gone: W.get('stall-1-chest') ?? null, ammo: W.get('nest-1-turret')?.ammo, built: !!W.view('stall-1-counter'), kept: !!again.changed['stall-1-chest'] };
      }, setup.toString());
      check('[guard] the old save loads into content without the entry: no crash, the rest of the save applies and builds', r.ok === true && r.gone === null && r.ammo === 2 && r.built, JSON.stringify(r));
      check('[guard] the saved change of the deleted entry is a reported orphan, warned about, and kept by the next save', r.orphans.includes('stall-1-chest') && /stall-1-chest/.test(r.said ?? '') && r.kept, JSON.stringify(r));
    },
  },
];
