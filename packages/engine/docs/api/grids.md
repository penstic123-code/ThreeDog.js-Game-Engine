# engine.grids — grids()

Placement grids: world <-> cell, occupancy derived from world records, per-cell layers, placement preview (grids() module)


## Methods and properties
- `grids.add(name: string, opts?: { cell?, origin?, size?, zone?, flat? }) → Grid` — Create a grid. cell: edge length (m, default 1); origin: world [x, z] of the min corner of cell [0, 0]; size: [cells wide, cells deep] (omit = unbounded); zone: level name (tiles only show there); flat: max height difference under a footprint (m, default 0.5). Example: `const room = engine.grids.add('room', { cell: 0.5, origin: [-3, -3], size: [12, 12], zone: 'house' })`
- `grids.get(name: string, must?: boolean) → Grid` — A grid by name (throws with the names that exist; must = false returns undefined instead)
- `grids.define(name: string, rule: import("./Grid.js").GridRule)` — Register what can be placed and its rules. size [w, d] in cells (default [1, 1]); kind of the world record (default the item name); ground: allowed engine.groundType values; layer: { layerName: field } that must be truthy on every cell (reason 'not' + Field, e.g. notTilled); flat: max height difference (overrides the grid's); fields: copied into the record; can(e, { grid, cell, rotation, cells }): your own rule. Example: `engine.grids.define('crop', { size: [1, 1], layer: { soil: 'tilled' }, fields: { plantedAt: 0 } })`
- `grids.preview(opts: { grid, item, from?, rotate?, rotation?, look? }) → { cell, rotation, ok, reason, rotate, place, … }` — Show where an item would go: the target cell under the pointer ('pointer', default), in front of the player ('front') or from your function, turned by the input action rotate (default 'rotate', R), green when can() passes, red otherwise (style.grid.ok / bad). look: false = no visual; (engine) => ({ update(view), hide(), dispose() }) = your own. place() runs grid.place with what is shown. Example: `const pv = engine.grids.preview({ grid: 'farm', item: 'crop' }); engine.onFrame(() => { if (engine.input.pointer.clicked) { const r = pv.place(); if (!r.ok) toast(engine, engine.t('grid.' + r.reason)); } });`
- Properties:
  - `list: Grid[]` All grids
