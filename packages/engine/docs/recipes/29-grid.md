# Grid placement: farming, furniture, crates, building

Requires module `grids()` and `world()` (`openWorld()` includes world; grids is opt-in and costs nothing when not installed). The API list is in
`../api/grids.md`.
A grid turns world positions into cells. Things placed on it are ordinary `engine.world` records; per-cell state that is not a thing (tilled soil, wet
soil, a painted floor) lives in **layers**. Farming soil always goes here; `terrain.edit({ paint })` is only for landscape ground types (roads, sand),
see `28-terrain.md`.
Works on any ground: procedural terrain, a Blender level, an indoor floor. Heights come from `engine.surface`, ground types from `engine.groundType`.

## 1. Grids and items
```js
import { grids, toast } from 'threedog';
engine.use(grids());
const farm = engine.grids.add('farm', { cell: 1, origin: [0, 0], size: [16, 12] });            // several grids may exist
const room = engine.grids.add('room', { cell: 0.5, origin: [-3, -3], size: [12, 12], zone: 'house' });

engine.grids.define('crop',  { layer: { soil: 'tilled' }, fields: { plantedAt: 0 } });        // only on cells whose soil layer has tilled
engine.grids.define('bed',   { size: [2, 1], kind: 'furniture', fields: { model: 'bed' } });  // 2x1 cells; world record kind 'furniture'
engine.grids.define('shed',  { size: [3, 2], ground: ['grass', 'dirt'], flat: 0.2 });       // engine.groundType must match; max 0.2 m height difference
engine.grids.define('crate', { size: [1, 1], can: (e, { cell }) => (cell[1] > 2 ? true : 'tooCloseToRoad') });   // your own rule
```
Coordinates: `farm.toCell(pos)` -> `[i, j]`, `farm.toWorld(cell, size?, rotation?)` -> footprint center on the ground, `farm.snap(pos)`,
`farm.inside(cell)`, `farm.footprint(cell, size, rotation)`.
Cell `[0, 0]` starts at `origin`. A footprint is anchored at its min corner; `rotation` is quarter turns (0-3), odd turns swap width and depth.

## 2. Place, pick up, move: always ops
```js
engine.ops.run('grid.place', { grid: 'farm', item: 'bed', cell: [4, 4], rotation: 1 });   // { ok, value: record id } or { ok: false, reason }
engine.ops.run('grid.move',  { id: 'furniture-3', cell: [6, 2], rotation: 0 });          // its own cells do not block it; grid: 'room' moves it to another grid
engine.ops.run('grid.remove', { id: 'furniture-3' });                                     // value { item, kind }: put it back in the bag yourself
farm.can('crop', [3, 5]);                                                                // ask only: true or a reason
```
Reasons: `outOfBounds` `occupied` `wrongGround` `notFlat` `not<Field>` (from a layer rule: `notTilled`) `noGrid` `idTaken` `unknown` `notPlaced`, or
your `can` reason.
Show them through i18n (`engine.t('grid.' + r.reason)`); `engine.explain({ grid: { grid: 'farm', item: 'bed', cell: [4, 4] } }).text` says which cell
and which record is in the way.
A placed record looks like `{ id, kind, position, rot, ...fields, grid: { id: 'farm', cell: [4, 4], size: [2, 1], rotation: 1, item: 'bed' } }`. Give
it a look with `world.present(kind, ...)` as usual (`rot` is the yaw in radians).
To build several things at once, call `grid.place` from your own op (`build.wall`), so each placement is still checked.

**Occupancy is not saved separately.** `farm.at(cell)` / `farm.area(cell, size)` read an index built from the world records' `grid` field, so a save
holds every placed thing once and can never disagree with itself.
**Don't go around it** (dev): the `grid` field of a placed record is frozen (editing it in place throws); `world.set / add` outside an op trigger the
ops guard; a record added by hand that overlaps another is reported and the cell stays with the first.

## 3. Layers: per-cell state (Stardew-style soil)
```js
const soil = farm.layer('soil');                          // created on first use; saved with the game (only cells that differ from content)
engine.ops.define('farm.till',  { args: { cell: 'any' },
  can: (e, { cell }) => (!farm.inside(cell) ? 'outOfBounds' : farm.at(cell) ? 'occupied' : true),
  run: (e, { cell }) => soil.set(cell, { tilled: true }) });
engine.ops.define('farm.water', { args: { cell: 'any' },
  can: (e, { cell }) => (soil.get(cell)?.tilled ? true : 'notTilled'),
  run: (e, { cell }) => soil.set(cell, { watered: true }) });
engine.ops.define('farm.dry',   { run: () => soil.updateAll(d => { delete d.watered; }) });   // bulk change; return null from fn to clear a cell
engine.sky.at('06:00', () => engine.ops.run('farm.dry'));                                      // daily reset is the game's job
```
`get(cell)`, `set(cell, patch)` (merge; a field set to null is deleted), `clear(cell)`, `query(cell?, size?)` -> `[{ cell, data }]`, `updateAll(fn)`, `count`.
Writes are saved gameplay state: do them inside an op or a fixed step (the guard reports anything else). Data must be plain values.
Cells that exist from the start go in content: `content/grids.js` <!-- r18-ignore-line -->
`farm: { cell: 1, origin: [0, 0], size: [16, 12], layers: { soil: [[3, 5, { tilled: true }]] } }` <!-- r18-ignore-line -->
(or `grids.add(name, { layers })`). They are the baseline: a save keeps only cells changed from it, so editing the content later still reaches old saves.

**Tiles.** The game gives a layer its colors: `farm.layer('soil', { tiles: { look: d => d.watered ? 0x5b3d2a : d.tilled ? 0x8a6243 : null } })`
(what the data means is gameplay, so no style pack ships these). A layer with tiles shows crisp per-cell quads just above the ground, following its
height (slopes, ramps, level meshes).
`farm.layer('soil', { tiles: false })` turns them off; `{ tiles: true }` draws every non-empty cell gray; `lift` raises them; `{ tiles:
(engine, layer) => ({ update(cells), dispose() }) }` is your own view. Options are read when the layer is first created.

## 4. Preview
```js
engine.input.define('place', ['Mouse0'], 'Place');                          // gameplay reads input actions, not pointer.clicked (recipe 26)
const pv = engine.grids.preview({ grid: 'farm', item: 'bed', ...presets.keys.gridRotate });   // under the pointer; from: 'front' = the cell in front of the player
engine.onFrame(() => {
  if (engine.input.pressed('place')) { const r = pv.place(); if (!r.ok) toast(engine, engine.t('grid.' + r.reason)); }
});
pv.remove();                                                                // leave build mode
```
The engine binds no key: `...presets.keys.gridRotate` (or `rotateKeys: ['KeyR']`) defines the action `rotate` on R, or bind that action yourself with
`input.define`; pass `rotate: 'myAction'` to read another one, `false` for none. Without a binding the preview warns once and only `pv.rotate()` turns
it. `pv.cell`, `pv.rotation`, `pv.ok`, `pv.reason`
are readable every frame.
Colors come from `style.grid.ok / bad / previewOpacity`. `look: false` hides the default box; `look: (engine) => ({ update(view), hide(), dispose()
})` draws your own (`view = { cells, center, size, rotation, ok, reason }`).

## 5. Verify
`engine.describe().grids` -> `{ farm: { occupied, items: { bed: 1 }, layers: { soil: 30 } } }`. Tests: `npx threedog test "grid:"`.
