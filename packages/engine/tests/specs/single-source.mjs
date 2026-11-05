// Authored data has one source (recipes/30-templates.md, recipes/20-content-actions-save.md "Save format"). Same style as the other files here.
// Guards: stable ids and duplicate errors, save = authored baseline + per-id diff, orphans kept, runtime spawns saved whole, level-node ids,
// "defined in file:line" in inspect / explain / pick, point -> thing on a batched copy, and the dev warning when code placed records before start.
const READY = { timeout: 60000 };
const reload = async page => { await page.reload(); await page.waitForFunction(() => window.engine?.stateApplied, null, READY); };

// world example page: one stateful template, a few instances (the same setup before and after a reload)
const setup = (ids = ['ss-a', 'ss-b', 'ss-c']) => {
  const p = engine.player.position, x = Math.round(p.x), z = Math.round(p.z);
  if (!engine.ops.defs.has('ssbox.open')) engine.ops.define('ssbox.open', { args: { id: 'id' }, run: (e, { id }) => e.world.set(id, { opened: true }) });
  if (!engine.ops.defs.has('ssbox.make')) engine.ops.define('ssbox.make', { args: { x: 'number', z: 'number' }, run: (e, a) => e.content.spawn('ssbox', a).id });
  engine.content.load({
    templates: { ssbox: { model: 'rock', state: { opened: false }, interact: { label: 'Open', op: 'ssbox.open' } } },
    props: ids.map((id, i) => ({ template: 'ssbox', id, x: x + 3 + i * 2, z: z + 3 })),
  });
  return { x, z };
};

export const specs = [
  {
    name: 'Single source: stable ids, duplicate id error, definedAt in inspect / explain, new-game diff warning (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async (src) => {
        'use strict';
        engine.haltLoop();
        const warns = [], warn = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); warn(...a); };
        const W = engine.world, { x, z } = (0, eval)(src)();
        const err = f => { try { f(); return null; } catch (e) { return e.message; } };
        // a stateful template entry without an id: dev warns, naming the index id to write
        engine.content.load({ props: [{ template: 'ssbox', x: x + 9, z: z + 9 }] });
        const noId = warns.find(w => /with state have no id/.test(w)) ?? null;
        // duplicates in one load (across props and pickups) and reserved characters are errors that say how to fix
        const dup = err(() => engine.content.load({ props: [{ template: 'ssbox', id: 'ss-dup', x, z }, { model: 'rock', id: 'ss-dup', x: x + 1, z }] }));
        const dup2 = err(() => engine.content.load({ props: [{ model: 'rock', id: 'ss-dup2', x, z }], pickups: [{ item: 'berry', id: 'ss-dup2', x, z }] }));
        const slash = err(() => engine.content.load({ props: [{ model: 'rock', id: 'a/b', x, z }] }));
        // definedAt: a content-file entry knows its file and line (dev / test builds); inspect, explain and the origin say it
        const origin = W.origin('prop:pine:0'), thing = engine.inspect('prop:pine:0').thing;
        const npc = W.origin(W.query({ kind: 'npc' })[0]?.id);
        const ex = engine.explain({ op: 'ssbox.open', args: { id: 'ss-a' } });
        const spawned = engine.ops.run('ssbox.make', { x: x + 5, z: z - 4 }).value, sOrigin = W.origin(spawned);
        // new game: the captured world diff must be empty; a record placed by code before start is named in a dev warning
        engine.ops.allow(() => W.add({ id: 'ss-code', kind: 'crate', position: [x, 0, z] }));
        engine.session._capture();   // what start() does when loading finishes
        const placed = warns.find(w => /created or removed by code before the game started/.test(w)) ?? null;
        console.warn = warn;
        return { noId, dup, dup2, slash, origin, thing, npc, ex: ex.text, exThing: ex.thing?.id, sOrigin, placed };
      }, setup.toString());
      check('a stateful template entry without an id warns once, naming the index id to write', /ssbox:0/.test(r.noId ?? '') && /id: 'ssbox:0'/.test(r.noId ?? ''), r.noId);
      check('the same id twice in one load (props, or props and pickups) throws, naming both entries and a fix', /used twice/.test(r.dup ?? '') && /ss-dup-2/.test(r.dup ?? '') && /pickups\[0\]/.test(r.dup2 ?? ''), JSON.stringify([r.dup, r.dup2]));
      check('an authored id with "/" or "#" throws with a fixed suggestion', /may not contain/.test(r.slash ?? '') && /"a-b"/.test(r.slash ?? ''), r.slash);
      check('a content-file prop knows its source line (examples/world/content/props.js:4); NPCs too', /examples\/world\/content\/props\.js:4$/.test(r.origin?.definedAt ?? '') && /content\/npcs\.js:\d+$/.test(r.npc?.definedAt ?? ''), JSON.stringify([r.origin, r.npc]));
      check('engine.inspect(id).thing says where to edit it for good', r.thing?.definedAt === r.origin?.definedAt && /edit it there to change the level for good/.test(r.thing?.edit ?? '') && r.thing?.fields?.model === 'pine', JSON.stringify(r.thing));
      check('explain of an op on a record names the record\'s source; a spawned record names the op that made it', r.exThing === 'ss-a' && /ss-a/.test(r.ex) && r.sOrigin?.spawned?.op === 'ssbox.make' && r.sOrigin?.template === 'ssbox', JSON.stringify({ ex: r.ex, s: r.sOrigin }));
      check('new-game capture with a code-placed record warns, naming it', /ss-code/.test(r.placed ?? ''), r.placed);
    },
  },
  {
    name: 'Single source: save is the authored baseline + per-id diff; runtime spawns saved whole; orphans kept; newGame back to the content (open world)',
    url: '/?cutscene=skip',
    async run({ page, check, ev }) {
      const mid = await ev(async (src) => {
        'use strict';
        engine.haltLoop();
        (0, eval)(src)();
        for (let i = 0; i < 40 && !engine.world.ready; i++) { engine.step(0.1); await new Promise(res => setTimeout(res, 0)); }
        engine.step(0.1);
        const W = engine.world, before = JSON.parse(engine.session._base).parts.world;   // the new-game state start() captured
        engine.ops.run('ssbox.open', { id: 'ss-a' });
        engine.ops.allow(() => W.remove('ss-b'));
        const made = engine.ops.run('ssbox.make', { x: W.get('ss-c').position.x + 4, z: W.get('ss-c').position.z }).value;
        const w = engine.saves.collect().parts.world;
        await engine.saves.save('ss1'); await engine.saves.flush();
        return { made, before: { records: Object.keys(before.records), changed: Object.keys(before.changed), removed: before.removed },
          changed: w.changed, removed: w.removed, records: Object.keys(w.records), rec: w.records[made] };
      }, setup.toString());
      check('right after start no runtime record but the player and nothing removed (changes are only simulation: the NPC walking)', mid.before.records.join() === 'player' && mid.before.changed.every(id => id === 'fisher') && !mid.before.removed.length, JSON.stringify(mid.before));
      check('an opened authored instance is saved as a per-id change only; a removed one as a tombstone; untouched ones not at all',
        JSON.stringify(mid.changed['ss-a']) === '{"set":{"opened":true}}' && mid.removed.includes('ss-b') && !mid.changed['ss-c'], JSON.stringify({ changed: mid.changed, removed: mid.removed }));
      check('engine.content.spawn during play is saved whole (kind, state, position)', mid.records.includes(mid.made) && mid.rec?.kind === 'ssbox' && mid.rec?.opened === false && !!mid.rec?.position, JSON.stringify(mid.rec));
      // reload with ss-c renamed in the content: its id is an orphan; its change must survive another save
      await reload(page);
      const r = await ev(async (src) => {
        'use strict';
        engine.haltLoop();
        const warns = [], warn = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); warn(...a); };
        (0, eval)(src)(['ss-a', 'ss-b', 'ss-c2']);
        const W = engine.world;
        const ok = await engine.saves.load('ss1');
        const back = { ok, a: W.get('ss-a')?.opened, b: W.get('ss-b') ?? null, spawned: W.query({ kind: 'ssbox' }).map(x => x.id).filter(id => !id.startsWith('ss-')) };
        // an orphan: a saved change whose entry the content no longer has (simulate by loading a save that names ss-gone)
        const data = engine.saves.collect(); data.parts.world.changed['ss-gone'] = { set: { opened: true } };
        await engine.saves.apply(data, '(test)');
        engine.events.emit('save:loaded', 'test');   // what saves.load emits after applying
        const orphans = engine.describe().world.orphans ?? [], kept = !!engine.saves.collect().parts.world.changed['ss-gone'];
        const said = warns.find(w => /no longer defines/.test(w)) ?? null;
        // newGame: back to exactly the content (authored records reset, runtime ones gone)
        await engine.session.newGame();
        const fresh = engine.saves.collect().parts.world, base = JSON.parse(engine.session._base).parts.world;
        console.warn = warn;
        // simulated NPCs may walk between capture and now: compare with the captured state, not with zero
        return { back, orphans, kept, said, fresh: { records: Object.keys(fresh.records), removed: fresh.removed, same: JSON.stringify(Object.keys(fresh.changed)) === JSON.stringify(Object.keys(base.changed)), baseChanged: Object.keys(base.changed) } };
      }, setup.toString());
      check('after reload + load: the change and the removal come back on top of the content; the spawned record is back', r.back.ok && r.back.a === true && r.back.b === null && r.back.spawned.length === 1, JSON.stringify(r.back));
      check('an orphan (saved id the content no longer defines) is kept in the save, listed in describe().world.orphans and warned about once', r.kept && r.orphans.includes('ss-gone') && /ss-gone/.test(r.said ?? ''), JSON.stringify({ kept: r.kept, orphans: r.orphans, said: r.said }));
      check('newGame returns to the content: no runtime records but the player, no diff', r.fresh.records.join() === 'player' && r.fresh.same && !r.fresh.removed.length, JSON.stringify(r.fresh));
    },
  },
  {
    name: 'Single source: pick resolves a hit (also on a batched copy) to { id, kind, template, definedAt }; physics template body saves a pushed position (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async (src) => {
        'use strict';
        engine.haltLoop();
        const tick = () => new Promise(res => setTimeout(res, 0));
        const W = engine.world, B = engine.batching, cs = B.cell, p = engine.player.position;
        const { x, z } = (0, eval)(src)();
        const ox = Math.floor(p.x / cs) * cs, oz = Math.floor(p.z / cs) * cs, props = [];
        for (let i = 0; i < 12; i++) props.push({ id: `sp-${i}`, model: 'rock', x: ox + 6 + (i % 6) * 9, z: oz + 6 + Math.floor(i / 6) * 9 });
        engine.content.load({ props, templates: { sscrate: { model: 'rock', body: { shape: 'box', mass: 1 } } } });
        engine.content.load({ props: [{ template: 'sscrate', id: 'ss-crate', x: x - 4, z: z - 4 }] });
        for (let i = 0; i < 60 && (!W.view('sp-11') || !W.view('ss-crate') || !W.ready); i++) { engine.step(0.1); await tick(); }
        engine.step(0.2);
        const batched = B.of(W.view('sp-3')).length > 0;
        const at = W.view('sp-3').position, hit = engine.raycast([W.get('sp-3').position.x, at.y + 30, W.get('sp-3').position.z], [0, -1, 0]);
        const t = hit?.thing;
        // screen pick: aim the camera ray at the hit point
        const cam = engine.camera; globalThis.__cam = engine.takeCamera('test');
        cam.position.set(hit.point.x, hit.point.y + 12, hit.point.z + 4); cam.lookAt(hit.point); cam.updateMatrixWorld();
        const v = hit.point.clone().project(cam), pk = engine.pick(v.x, v.y)?.thing ?? { v: [v.x, v.y, v.z] };
        globalThis.__cam?.remove();
        // a template instance from props
        const ta = W.view('ss-a').position, th = engine.raycast([W.get('ss-a').position.x, ta.y + 30, W.get('ss-a').position.z], [0, -1, 0])?.thing;
        // physics body: the model moves itself and the record follows it, so a pushed position is in the save
        const entry = W.view('ss-crate')?.userData.body, from = { ...W.get('ss-crate').position };
        if (entry) { engine.ops.allow(() => engine.rigid.setPosition(entry, [from.x + 3, from.y + 0.5, from.z])); for (let i = 0; i < 10; i++) engine.step(1 / 30); }
        const saved = engine.saves.collect().parts.world.changed['ss-crate']?.set?.position ?? null, pushed = saved && Math.abs(saved.x - from.x - 3) < 0.5;
        return { batched, t, pk, th, body: !!entry, pushed, saved, crateBatch: W.view('ss-crate')?.userData.batch };
      }, setup.toString());
      check('a ray hit on a batched copy resolves to its record: id, kind, model, definedAt null for inline data, mesh / material named',
        r.batched && r.t?.id === 'sp-3' && r.t?.kind === 'prop' && r.t?.model === 'rock' && r.t?.definedAt === null && 'material' in (r.t ?? {}), JSON.stringify({ batched: r.batched, t: r.t }));
      check('engine.pick at the projected point resolves to the same record', r.pk?.id === 'sp-3', JSON.stringify(r.pk ?? 'no hit'));
      check('a template instance hit says its template and fields', r.th?.id === 'ss-a' && r.th?.template === 'ssbox' && r.th?.fields?.opened === false, JSON.stringify(r.th));
      check('template body: rigid body built, never batched; a pushed position is copied to the record and saved', r.body && r.crateBatch === false && r.pushed === true, JSON.stringify({ body: r.body, saved: r.saved }));
    },
  },
  {
    name: 'Single source: level-model nodes tagged template / id become records <level>/<node>; grid items in props are authored records',
    url: '/tests/level/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        'use strict';
        engine.haltLoop();
        const T = window.THREE, W = engine.world;
        engine.assets.manifest({ models: { lvbox: () => new T.Mesh(new T.BoxGeometry(1, 2, 0.2)) } });   // this page has no style
        if (!engine.content) engine.use(window.content());
        if (!engine.grids) engine.use(window.grids());
        engine.ops.define('lvdoor.open', { args: { id: 'id' }, run: (e, { id }) => e.world.set(id, { opened: true }) });
        engine.content.load({ templates: { lvdoor: { model: 'lvbox', state: { opened: false }, interact: { label: 'Open', op: 'lvdoor.open' } } } });
        const build = () => {
          const root = new T.Group(); root.name = 'nodeLevel';
          const floor = new T.Mesh(new T.PlaneGeometry(40, 40).rotateX(-Math.PI / 2)); floor.name = 'floor'; root.add(floor);
          const door = new T.Mesh(new T.BoxGeometry(1, 2, 0.2)); door.name = 'door_front'; door.position.set(3, 1, 0); door.userData = { template: 'lvdoor', opened: true }; root.add(door);
          const rock = new T.Mesh(new T.BoxGeometry(1, 1, 1)); rock.name = 'rock_12'; rock.position.set(-3, 0.5, 2); rock.userData = { id: true, mossy: 1 }; root.add(rock);
          return root;
        };
        await engine.level.load(build());
        for (let i = 0; i < 30 && !W.ready; i++) { engine.step(0.1); await new Promise(res => setTimeout(res, 0)); }
        engine.step(0.1);
        const door = W.get('nodeLevel/door_front'), rock = W.get('nodeLevel/rock_12');
        const out = { door: door && { kind: door.kind, opened: door.opened }, rock: rock && { kind: rock.kind, mossy: rock.mossy, x: rock.position.x },
          origin: W.origin('nodeLevel/rock_12'), inRoot: !!engine.level.root.getObjectByName('rock_12') && engine.level.root.getObjectByName('rock_12').parent === engine.level.root,
          hlod: W.view('nodeLevel/rock_12')?.userData.hlod };
        const hit = engine.raycast([-3, 20, 2], [0, -1, 0]);
        out.pick = hit?.thing?.id ?? null; out.edit = hit?.thing?.edit ?? null;
        engine.ops.allow(() => W.remove('nodeLevel/rock_12'));
        out.removed = engine.saves.collect().parts.world.removed.includes('nodeLevel/rock_12');
        await engine.level.load(build());   // the level loads again: the removed node stays removed, the door keeps its record
        out.again = { rock: W.get('nodeLevel/rock_12') ?? null, door: !!W.get('nodeLevel/door_front') };
        // grid items authored in content/props.js
        engine.content.load({ grids: { ssfarm: { cell: 1, origin: [-10, -10], size: [6, 6] } } });
        engine.grids.define('ssbed', { size: [2, 1], kind: 'ssfurniture' });
        engine.content.load({ props: [{ id: 'bed-home', grid: 'ssfarm', item: 'ssbed', cell: [1, 1], rotation: 1 }] });
        let gridErr = null; try { engine.content.load({ props: [{ grid: 'ssfarm', item: 'ssbed', cell: [3, 3] }] }); } catch (e) { gridErr = e.message; }
        const bed = structuredClone(W.get('bed-home')), w0 = engine.saves.collect().parts.world, occupied = (o => o?.id ?? o ?? null)(engine.grids.get('ssfarm').at([1, 1]));
        engine.ops.run('grid.move', { id: 'bed-home', cell: [3, 3] });
        const w1 = engine.saves.collect().parts.world;
        out.grid = { kind: bed?.kind, cell: bed?.grid.cell, occupied, inSave0: !!w0.changed['bed-home'] || 'bed-home' in w0.records,
          moved: !!w1.changed['bed-home'] && !('bed-home' in w1.records), gridErr };
        return out;
      });
      check('a node with template = lvdoor is an instance (its custom property fills state); a node with id = true is a levelNode record keeping its fields',
        r.door?.kind === 'lvdoor' && r.door.opened === true && r.rock?.kind === 'levelNode' && r.rock.mossy === 1 && Math.abs(r.rock.x + 3) < 0.01, JSON.stringify(r));
      check('node ids are <level>/<node>, origin names level and node; the node left the level root and is never baked by hlod',
        r.origin?.level === 'nodeLevel' && r.origin?.node === 'rock_12' && !r.inRoot && r.hlod === false, JSON.stringify({ origin: r.origin, inRoot: r.inRoot, hlod: r.hlod }));
      check('pick on a level node names it and says to change it in the level model', r.pick === 'nodeLevel/rock_12' && /level nodeLevel node rock_12/.test(r.edit ?? ''), JSON.stringify({ pick: r.pick, edit: r.edit }));
      check('removing a node record is a tombstone; loading the level again keeps it removed and the door record', r.removed && r.again.rock === null && r.again.door, JSON.stringify(r.again));
      check('a grid item in props is an authored record (same shape as grid.place, occupies its cells, not in the save until moved; moving it is a diff); without an id it throws',
        r.grid.kind === 'ssfurniture' && JSON.stringify(r.grid.cell) === '[1,1]' && r.grid.occupied === 'bed-home' && !r.grid.inSave0 && r.grid.moved && /needs an id/.test(r.grid.gridErr ?? ''), JSON.stringify(r.grid));
    },
  },
  {
    name: 'Single source: runtime ids kind#n and their exact save migration; content renames move saved state; grid layers save a per-cell diff (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async (src) => {
        'use strict';
        engine.haltLoop();
        const warns = [], warn = console.warn; console.warn = (...a) => { warns.push(a.join(' ')); warn(...a); };
        const W = engine.world, I = engine.inventory, { x, z } = (0, eval)(src)(['ss-a']), out = {};
        const err = f => { try { f(); return null; } catch (e) { return e.message; } };
        const apply = async d => { await engine.saves.apply(d, '(test)'); engine.events.emit('save:loaded', 'test'); };
        // 1. a record made during play is numbered kind#n: it can never equal an authored id (those may not contain #)
        out.made = engine.ops.run('ssbox.make', { x: x + 5, z: z - 4 }).value;
        // an old (world v2 / containers v1) save: only `<own kind>-<n>` with n <= seq is a runtime id; an n claimed twice, n > seq or another kind is left alone
        const old = engine.saves.collect(), at = { x: x + 6, y: 0, z: z + 6 };
        I.container('ss-tmp', { items: { berry: 2 } }); const goods = I._containers.save()['ss-tmp']; I._containers.remove('ss-tmp');
        old.versions.world = 2; old.versions.containers = 1;
        W.simulate('ssfar', { far: () => {} });   // owed time is written only for kinds simulated far
        Object.assign(old.parts.world, { seq: 50, owed: { 'ssfar-8': 3 } });
        Object.assign(old.parts.world.records, {
          'ssbox-7': { kind: 'ssbox', position: at, opened: true, owner: 'ssbox-7' }, 'ssfar-8': { kind: 'ssfar', position: { x: 3000, y: 0, z: 3000 } }, 'crate-99': { kind: 'crate', position: at },
          'ta-5': { kind: 'ta', position: at }, 'tb-5': { kind: 'tb', position: at }, 'ssbox-home': { kind: 'ssbox', position: at }, 'plot-3': { kind: 'crop', position: at },
        });
        old.parts.containers = { ...old.parts.containers, 'ssbox-7': goods };
        await apply(old);
        out.mig = { rec: W.get('ssbox#7') ?? null, oldGone: !W.get('ssbox-7'), kept: ['crate-99', 'ta-5', 'tb-5', 'ssbox-home', 'plot-3'].filter(id => W.get(id)),
          box: I._containers.map.has('ssbox#7') ? I.container('ssbox#7').count('berry') : null, owed: Object.keys(engine.saves.collect().parts.world.owed ?? {}).includes('ssfar#8') || null };
        // 2. renames: a save made before the rename (changes, tombstone, container goods under the old id) loads onto the new id
        const pre = engine.saves.collect();
        pre.parts.world.changed['ss-old'] = { set: { opened: true } }; pre.parts.world.removed.push('ss-old2'); pre.parts.world.changed['ss-dropped'] = { set: { opened: true } };
        pre.parts.containers = { ...pre.parts.containers, 'ss-oldbox': goods };
        await apply(pre);   // save first, content after
        engine.content.load({ renames: { 'ss-old': 'ss-new', 'ss-old2': 'ss-new2', 'ss-dropped': null, 'ss-oldbox': 'ss-newbox' },
          props: [{ template: 'ssbox', id: 'ss-new', x: x + 8, z }, { template: 'ssbox', id: 'ss-new2', x: x + 10, z }] });
        engine.events.emit('save:loaded', 'test');
        const orph = () => engine.describe().world.orphans ?? [];
        out.ren = { opened: W.get('ss-new')?.opened, gone2: !W.get('ss-new2'), orphans: orph(), box: I._containers.map.has('ss-newbox') ? I.container('ss-newbox').count('berry') : null,
          dropped: !engine.saves.collect().parts.world.changed['ss-dropped'] };
        await apply(pre);   // content first, save after: the remembered renames apply again
        out.ren2 = { opened: W.get('ss-new')?.opened, gone2: !W.get('ss-new2'), orphans: orph() };
        // an orphan near a content id gets the exact renames pair; a rename target nothing defines is named; a target with # throws
        const typo = engine.saves.collect(); typo.parts.world.changed['ss-nwe'] = { set: { opened: true } };
        engine.content.load({ renames: { 'ss-x1': 'ss-missing' } });
        await apply(typo);
        out.hint = warns.find(w => /renames: \{ 'ss-nwe': 'ss-new' \}/.test(w)) ?? null;
        out.target = warns.find(w => /ss-missing \(from ss-x1\)/.test(w)) ?? null;
        out.hashErr = err(() => engine.content.load({ renames: { 'ss-y': 'ssbox#3' } }));
        console.warn = warn;
        return out;
      }, setup.toString());
      check('a record made during play is numbered <kind>#<n>', /^ssbox#\d+$/.test(r.made ?? ''), r.made);
      check('world v2 -> v3: an auto id kind-n (n <= seq, own kind, n unique) becomes kind#n with its owed time, its container and fields that name it; nothing else is renamed',
        r.mig.rec?.opened === true && r.mig.rec?.owner === 'ssbox#7' && r.mig.oldGone && r.mig.kept.length === 5 && r.mig.box === 2 && r.mig.owed, JSON.stringify(r.mig));
      check('content renames move a save\'s change, tombstone and container goods to the new id; null drops quietly; none of them are orphans',
        r.ren.opened === true && r.ren.gone2 && r.ren.box === 2 && r.ren.dropped && !r.ren.orphans.some(id => /^ss-(old|dropped)/.test(id)), JSON.stringify(r.ren));
      check('a save loaded after the content with renames is renamed the same way', r.ren2.opened === true && r.ren2.gone2 && !r.ren2.orphans.some(id => /^ss-old/.test(id)), JSON.stringify(r.ren2));
      check('an orphan near a content id suggests the renames pair; a rename target nothing defines is named; a # target throws',
        !!r.hint && !!r.target && /may not contain/.test(r.hashErr ?? ''), JSON.stringify({ hint: r.hint, target: r.target, hashErr: r.hashErr }));
    },
  },
  {
    name: 'Single source: a grid layer authored in content saves only the cells changed from it; orphan layer diffs kept; v1 grid saves migrate',
    url: '/tests/level/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        'use strict';
        engine.haltLoop();
        if (!engine.content) engine.use(window.content());
        if (!engine.grids) engine.use(window.grids());
        const out = {}, apply = async d => { await engine.saves.apply(d, '(test)'); };
        // grid layer authored in content: the save keeps only cells changed from it; a diff for a grid this run lacks is kept
        engine.content.load({ grids: { ssg2: { cell: 1, origin: [-40, -40], size: [4, 4], layers: { soil: [[0, 0, { tilled: true }], [1, 0, { tilled: true }]] } } } });
        const soil = engine.grids.get('ssg2').layer('soil'), g0 = engine.saves.collect().parts.grids ?? {};
        engine.ops.allow(() => { soil.set([0, 0], { watered: true }); soil.clear([1, 0]); });
        const g1 = engine.saves.collect();
        g1.parts.grids = { ...g1.parts.grids, nogrid: { soil: { set: [[0, 0, { a: 1 }]] } } };
        await apply(g1);
        const g2 = engine.saves.collect().parts.grids, watered = soil.get([0, 0])?.watered, cleared = soil.get([1, 0]) ?? null;
        const v1 = engine.saves.collect(); v1.versions.grids = 1; v1.parts.grids = { ssg2: { soil: [[2, 2, { tilled: true }]] } };   // v1 saved every cell whole
        await apply(v1);
        out.grid = { base0: 'ssg2' in g0, diff: g2.ssg2?.soil, watered, cleared, orphanKept: !!g2.nogrid,
          v1: { a: soil.get([0, 0]) ?? null, b: soil.get([2, 2])?.tilled } };
        return out;
      });
      check('grid layer: authored cells are not in the save; a change saves only that cell (set) and an emptied authored cell (clear); loading restores both',
        !r.grid.base0 && JSON.stringify(r.grid.diff) === '{"set":[[0,0,{"tilled":true,"watered":true}]],"clear":[[1,0]]}' && r.grid.watered === true && r.grid.cleared === null, JSON.stringify(r.grid));
      check('grid layer: a diff for a grid this run does not have is kept; a v1 save (every cell whole) loads exactly, authored cells it lacks stay empty',
        r.grid.orphanKept && r.grid.v1.a === null && r.grid.v1.b === true, JSON.stringify(r.grid));
    },
  },
];
