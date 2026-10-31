// grids() module: placement grids, occupancy derived from world records, per-cell layers, tiles, preview. Same format as specs.mjs.
// Runs on the level test page: flat floor at y = 0 for x < 2, a ramp x 2 -> 8 rising 0 -> 2 m, no terrain module.
const URL = '/tests/level/index.html';
// shared page setup: install grids, a 8x8 farm on the flat floor and a few items
const setup = async () => {
  if (!engine.grids) engine.use(window.grids());
  const G = engine.grids;
  if (!G.get('farm', false)) {
    G.add('farm', { cell: 1, origin: [-10, -10], size: [8, 8] });
    G.define('crate', { size: [1, 1] });
    G.define('bed', { size: [2, 1], kind: 'furniture' });
    G.define('crop', { layer: { soil: 'tilled' }, fields: { plantedAt: 0 } });
    G.define('shed', { ground: 'grass' });
    engine.ops.define('test.till', { args: { cell: 'any', watered: 'bool?' }, run: (e, { cell, watered }) => G.get('farm').layer('soil').set(cell, { tilled: true, ...(watered ? { watered } : {}) }) });
  }
  return G;
};

export const specs = [
  {
    name: 'grid: place / remove / move go through ops; occupancy, rotation, bounds, tilled-only crops, ground type, explain, describe',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(async (src) => {
        const G = await (0, eval)(src)(), farm = G.get('farm');
        const run = (n, a) => engine.ops.run(n, a, { source: 'test' });
        const a = run('grid.place', { grid: 'farm', item: 'crate', cell: [1, 1] });
        const twice = run('grid.place', { grid: 'farm', item: 'crate', cell: [1, 1] });
        const overlap = run('grid.place', { grid: 'farm', item: 'bed', cell: [0, 1] });   // covers [0,1] [1,1]
        const bed = run('grid.place', { grid: 'farm', item: 'bed', cell: [3, 3], rotation: 1 });   // turned: [3,3] [3,4]
        const turned = [farm.at([3, 3]), farm.at([3, 4]), farm.at([4, 3])];
        const rec = engine.world.get(bed.value), recGrid = JSON.parse(JSON.stringify(rec.grid));
        const oob = run('grid.place', { grid: 'farm', item: 'bed', cell: [7, 0] });
        const explainText = engine.explain({ grid: { grid: 'farm', item: 'crate', cell: [3, 4] } }).text;
        const moved = run('grid.move', { id: bed.value, cell: [5, 5], rotation: 0 });
        const afterMove = [farm.at([3, 3]), farm.at([5, 5]), farm.at([6, 5])];
        const removed = run('grid.remove', { id: a.value });
        // crops only on tilled soil
        const untilled = run('grid.place', { grid: 'farm', item: 'crop', cell: [2, 6] });
        run('test.till', { cell: [2, 6] });
        const tilled = run('grid.place', { grid: 'farm', item: 'crop', cell: [2, 6] });
        // ground type rule with a stubbed ground: grass west of x = -6
        const orig = engine.ground.type;
        engine.ground.type = x => (x < -6 ? 'grass' : 'stone');
        const grass = farm.can('shed', [0, 0]), stone = farm.can('shed', [6, 0]);
        engine.ground.type = orig;
        const d = engine.describe().grids?.farm;
        return { a, twice, overlap, bed, turned, recGrid, kind: rec.kind, oob, explainText, moved, afterMove, removed, freed: farm.at([1, 1]),
          untilled, tilled, plantedAt: engine.world.get(tilled.value)?.plantedAt, grass, stone, d };
      }, setup.toString());
      check('[guard] placing on a taken cell is refused (same cell and a 2x1 footprint overlapping it)', r.a.ok && r.twice.reason === 'occupied' && r.overlap.reason === 'occupied', JSON.stringify([r.a, r.twice, r.overlap]));
      check('[guard] a 2x1 item turned a quarter occupies two cells along z; the record keeps grid { cell, size, rotation, item }',
        r.turned[0] === r.bed.value && r.turned[1] === r.bed.value && r.turned[2] === null && r.kind === 'furniture' && JSON.stringify(r.recGrid) === '{"id":"farm","cell":[3,3],"size":[2,1],"rotation":1,"item":"bed"}', JSON.stringify(r));
      check('outOfBounds past the edge; explain names the occupier', r.oob.reason === 'outOfBounds' && /occupied at cell \[3,4\] by furniture#\d+ \(bed\)/.test(r.explainText), r.explainText);
      check('grid.move frees the old cells and takes the new ones; grid.remove frees its cell',
        r.moved.ok && r.afterMove[0] === null && r.afterMove[1] === r.bed.value && r.afterMove[2] === r.bed.value && r.removed.ok && r.freed === null, JSON.stringify(r));
      check('[guard] crops only on tilled soil: notTilled before tilling, placed after (item fields copied)', r.untilled.reason === 'notTilled' && r.tilled.ok && r.plantedAt === 0, JSON.stringify([r.untilled, r.tilled]));
      check('ground rule reads engine.groundType: wrongGround off grass', r.grass === true && r.stone === 'wrongGround', JSON.stringify([r.grass, r.stone]));
      check('describe().grids shows occupancy and layer counts', r.d?.occupied === 3 && r.d.items.bed === 1 && r.d.items.crop === 1 && r.d.layers.soil === 1, JSON.stringify(r.d));
    },
  },
  {
    name: 'grid: occupancy and layers survive save / load; writes around the ops are caught',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(async (src) => {
        const G = await (0, eval)(src)(), farm = G.get('farm'), soil = farm.layer('soil');
        const run = (n, a) => engine.ops.run(n, a, { source: 'test' });
        const bed = run('grid.place', { grid: 'farm', item: 'bed', cell: [1, 1], rotation: 1 }).value;
        run('test.till', { cell: [4, 4], watered: true }); run('test.till', { cell: [5, 4] });
        const occ = () => [...farm._occ].sort().join('|'), before = occ(), layerBefore = JSON.stringify(soil.query());
        engine.saves.save('grid-test');
        run('grid.remove', { id: bed });
        engine.ops.define('test.dry', { run: () => soil.updateAll(d => { delete d.watered; }) }); run('test.dry');
        const changed = occ() !== before && JSON.stringify(soil.query()) !== layerBefore;
        engine.saves.load('grid-test');
        const after = occ(), layerAfter = JSON.stringify(soil.query());
        // around the ops: a timer writes the grid field / a layer, code edits the frozen field, an op adds an overlapping record by hand
        const warns = [], ow = console.warn; console.warn = (...a) => warns.push(String(a[0]));
        await new Promise(res => setTimeout(() => { engine.world.set(bed, { grid: { id: 'farm', cell: [6, 6], size: [1, 1], rotation: 0 } }); soil.set([0, 0], { tilled: true }); res(); }, 0));
        let frozen = null; try { (() => { 'use strict'; engine.world.get(bed).grid.cell[0] = 7; })(); } catch (err) { frozen = err.constructor.name; }   // game code is an ES module: strict
        engine.ops.define('test.sneak', { run: e => e.world.add({ id: 'sneak', kind: 'crate', position: [0, 0, 0], grid: { id: 'farm', cell: [4, 4], size: [1, 1], rotation: 0 } }) });
        run('grid.place', { grid: 'farm', item: 'crate', cell: [4, 4] }); const first = farm.at([4, 4]);
        run('test.sneak');
        console.warn = ow;
        return { before, after, changed, layerBefore, layerAfter, warns, frozen, keeps: farm.at([4, 4]) === first };
      }, setup.toString());
      check('[guard] occupancy after load equals before save (derived from world records, not stored twice)', r.changed && r.after === r.before, JSON.stringify(r));
      check('[guard] layer data round-trips through the save (updateAll in an op dried it, load restored)', r.layerAfter === r.layerBefore && r.layerBefore.includes('watered'), r.layerAfter);
      check('[guard] writing the grid field or a layer from a timer is reported by the ops guard',
        r.warns.some(w => w.includes('world.set') && w.includes('outside a fixed step')) && r.warns.some(w => w.includes('grid layer farm.soil.set')), JSON.stringify(r.warns));
      check('[guard] editing a placed record\'s grid field in place throws (frozen in dev)', r.frozen === 'TypeError', String(r.frozen));
      check('[guard] a record added around grid.place that overlaps is reported and the cell stays with the first', r.keeps && r.warns.some(w => w.includes('sneak overlaps')), JSON.stringify(r.warns));
    },
  },
  {
    name: 'grid: tiles hug a level ramp without terrain; preview follows its target, turns with the rotate action, colors from the style',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(async (src) => {
        const G = await (0, eval)(src)();
        engine.pause();
        const ramp = G.add('ramp', { cell: 1, origin: [2, -3], size: [6, 6] });
        const soil = ramp.layer('soil', { tiles: { look: d => (d.watered ? 0x334455 : 0x886644) } });
        engine.ops.define('test.rampTill', { run: () => { for (let i = 0; i < 6; i++) soil.set([i, 2], { tilled: true, watered: i % 2 === 0 }); } });
        engine.ops.run('test.rampTill');
        engine.step(1 / 30, { render: false });
        const mesh = engine.scene.getObjectByName('grid:ramp.soil'), pos = mesh.geometry.attributes.position;
        let worst = 0;
        for (let k = 0; k < pos.count; k++) worst = Math.max(worst, Math.abs(pos.getY(k) - 0.03 - engine.surface(pos.getX(k), pos.getZ(k))));
        const ys = [pos.getY(0), pos.getY(pos.count - 1)];
        // preview on the farm, target from a function (cell [3, 3])
        engine.style.grid = { ok: 0x00ff00, bad: 0xff0000 };   // this page has no style pack: give the preview its two colors
        const farm = G.get('farm'), st = engine.style.grid;
        const pv = G.preview({ grid: 'farm', item: 'bed', rotateKeys: ['KeyR'], from: () => ({ x: -6.5, z: -6.5 }) });
        engine.step(1 / 30, { render: false });
        const box = engine.scene.getObjectByName('grid:preview'), okColor = box.material.color.getHex(), first = { cell: pv.cell, ok: pv.ok };
        engine.input.simulate('rotate'); engine.step(1 / 30, { render: false }); engine.input.simulate('rotate', false);
        const turned = pv.rotation, size = [box.scale.x, box.scale.z].map(v => Math.round(v * 100) / 100);
        const placed = pv.place();
        engine.step(1 / 30, { render: false });
        const after = { ok: pv.ok, reason: pv.reason, color: box.material.color.getHex() };
        pv.remove();
        // the engine binds no key itself: a preview whose rotate action is unbound leaves it unbound (and only warns)
        const pv2 = G.preview({ grid: 'farm', item: 'bed', rotate: 'unboundRot', from: () => null }); engine.step(1 / 30, { render: false });
        const unbound = !engine.input.actions.has('unboundRot'); pv2.remove();
        engine.resume();
        return { unbound, tiles: mesh.userData.tiles, worst, ys, okColor, first, turned, size, placed, after, at: farm.at([3, 4]), st: { ok: st.ok, bad: st.bad }, gone: !engine.scene.getObjectByName('grid:preview') };
      }, setup.toString());
      check('[guard] tiles: one quad per cell, every corner on engine.surface + lift (a level ramp, no terrain module)', r.tiles === 6 && r.worst < 1e-3 && r.ys[1] > r.ys[0] + 1, JSON.stringify(r));
      check('preview: target cell from the function, green from style.grid.ok', JSON.stringify(r.first) === '{"cell":[3,3],"ok":true}' && r.okColor === r.st.ok, JSON.stringify(r));
      check('preview: the rotate action turns it (2x1 box becomes 1x2), place() runs grid.place with the shown rotation', r.turned === 1 && r.size[0] < r.size[1] && r.placed.ok && r.at === r.placed.value, JSON.stringify(r));
      check('[guard] preview binds no rotate key by itself (needs rotateKeys or your own binding)', r.unbound, JSON.stringify(r));
      check('preview turns red (style.grid.bad) on the now occupied cell; stop() removes it', !r.after.ok && r.after.reason === 'occupied' && r.after.color === r.st.bad && r.gone, JSON.stringify(r.after));
    },
  },
  {
    name: 'grid: a layer cell and a placed item from play are gone after session.newGame() (grids installed after start)',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(async (src) => {
        const G = await (0, eval)(src)(), farm = G.get('farm'), soil = farm.layer('soil');
        const run = (n, a) => engine.ops.run(n, a, { source: 'test' });
        run('test.till', { cell: [2, 2], watered: true });
        const placed = run('grid.place', { grid: 'farm', item: 'crate', cell: [3, 3] }).value;
        const during = { soil: soil.get([2, 2]), at: farm.at([3, 3]) };
        await engine.session.newGame();
        return { during, soil: soil.get([2, 2]) ?? null, count: soil.count, at: farm.at([3, 3]) ?? null, rec: !!engine.world.get(placed) };
      }, setup.toString());
      check('during play the cell is tilled and the crate occupies its cell', !!r.during.soil?.tilled && !!r.during.at, JSON.stringify(r));
      check('after newGame the layer is empty and the crate is gone', r.soil === null && r.count === 0 && r.at === null && !r.rec, JSON.stringify(r));
    },
  },
];
