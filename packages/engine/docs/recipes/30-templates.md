# Templates: reusable objects, definition vs instance state

Requires `world()` (in `openWorld()`); a template with `interact` needs `interactions({ ...presets.interactions.nearest })`, with `container` needs
`inventory({ ...presets.keys.inventory })`. The code is `modules/content/templates.js`.

A **template** describes one kind of object once: its model, collision, interaction, container, sound, animation and the default values of its saved
state. Every chest, campfire or bed you place is an **instance**: a world record that names the template (its `kind` is the template name) and holds
only its own state. There is no inheritance and no variant layer; a different look or behaviour is another template.

## 1. Define a template
`games/<game>/content/templates.js` (add it to `content/index.js`):
```js
export default {
  chest: {
    model: 'chest',                        // an asset name (file or generator of an asset pack); every chest clones one shared prototype (geometry and material built once)
    collide: 'box',                        // 'box' / 'circle' from the model's bounds; omitted = does not block
    state: { opened: false },              // instance fields and their defaults, copied onto each record and saved
    interact: { label: rec => rec.opened ? '关上' : '打开', op: 'chest.toggle', radius: 2 },   // using it runs the op with { id }
    container: { capacity: 6, items: { berry: 2 } },   // each chest gets a container whose id is the record id; items = starting goods (placed once)
    sound: { use: 'chest' },               // engine.audio.sfx after a successful use
    animate: (rec, obj, dt) => { obj.children[0].rotation.x = rec.opened ? -1.1 : 0; },   // per-frame look from the record, only while the model exists
  },
};
```
The action itself is an op in main.js (recipes/23-ops.md), so every open is logged and testable:
```js
engine.ops.define('chest.toggle', { run: (e, { id }) => e.world.set(id, { opened: !e.world.get(id).opened }) });
```
`interact` fields: `op` (required), `label` (text, i18n key, or `(rec, engine) => text`), `radius` (default 2.5), `height`, `action`,
`enabled: (rec, engine) => boolean`.

## 2. Place instances
In `content/props.js`, an entry with `template` instead of `model` places an instance. It takes a position and a few explicit overrides:
```js
export default [
  { template: 'chest', id: 'chest-home', place: 'home', x: 3, z: 1 },
  { template: 'chest', id: 'chest-cave', place: 'cave', x: 0, z: 2, opened: true, items: { film: 2 }, rot: 1.6 },
];
```
Allowed per instance: `id`, `place` / `x` / `z`, `y` (height above the ground), `rot`, `scale`, `items` (replaces the starting goods) and the
template's **state fields**. Writing a definition field (`model`, `collide`, `interact`...) throws and says to define another template.

**Ids.** An entry with state (a template with `state`, `container`, `interact` or `body`, every pickup, every grid item) gets a written id: saves find
its changes by id, and an index id (`<template>:<index>`, `pickup:<item>:<index>`) moves to another entry when one is inserted above it. Without one,
dev warns once per load and names the id to write. Pure decoration may keep its index id. Two entries with the same id in one load throw with the fix;
an authored id may not contain `#` or `/` (those are kept for records made during play and for level nodes). Places computed from the seed (a flat
spot near the river) stay in code and come in through `content.load(data, { places })`. Records made during play are numbered `<kind>#<n>`
(`chest#4`), so they never meet an authored id.

**Writing the ids, renaming them.** `npx threedog content ids [-w game]` lists each stateful entry that still relies on its index id with the id it
has now (`-`/`+` lines, dry run); `--write` writes them into the content files. Writing today's id changes nothing for old saves. To give an entry a
readable id later, change it and add the pair to `content/renames.js`: <!-- r18-ignore-line -->
```js
export default { 'chest:3': 'chest-home', 'prop:rock:12': null };   // old id -> new id; null = deleted on purpose
```
Loading a save then moves its changes, removal, owed time and container goods from `chest:3` to `chest-home` (save loaded before or after content),
and drops `prop:rock:12`'s data quietly. `npm run check` errors on a target no entry defines and on a source content still defines; dev warns about an
orphan near an existing id with the exact pair to add.

**Physics props.** `body: { shape: 'box' | 'ball' | 'hull', mass, friction?, restitution?, damping?, angularDamping? }` in a definition makes each
copy a rigid body (needs `rigid()`). The copy rests on the ground asleep until something hits it; then the record follows the model, so a pushed
crate's place is saved like any other change.
```js
// content/templates.js
export default { crate: { model: 'crate', body: { shape: 'box', mass: 2 } } };
```

**Grid items and level nodes.** A props entry `{ id: 'bed-home', grid: 'farm', item: 'bed', cell: [4, 4], rotation: 1 }` is the record `grid.place`
would make, as authored data (the grid comes from the content key `grids`, `{ farm: { cell: 1, origin: [0, 0], size: [16, 12] } }`, or
`engine.grids.add`). In a level model, a node with the Blender custom property `template = 'door'` becomes an instance of that template (its other
custom properties fill the template's state), and one with `id = true` becomes a record of kind `levelNode` whose model is the node itself. Their id
is `<level file name>/<node name>`, for example `town/door_front` (recipe 10).

At runtime (inside an op or a fixed step), `engine.spawn(name, at, fields)` places a new instance and returns its record:
```js
engine.ops.define('chest.build', {
  run: (e, { x, z }) => e.spawn('chest', { x, z }, { items: { stick: 3 } }).id,
});
```
Instances from `props.js` are initial records (a save stores only their changes); spawned ones are saved whole. Use `engine.world.get(id)`, `set`,
`move`, `remove` and `query({ kind: 'chest' })` as for any record (recipe 18). Removing a record does not remove its container (the game decides what
happens to the goods).

## 3. What belongs to the definition, what to the instance
| | Definition (shared, read-only) | Instance (per object, saved) |
|---|---|---|
| Template | model, collide, static, interact, container capacity and starting goods, sound, animate, state defaults, body | world record: id, kind, position, rot, scale, state fields (`opened`) |
| Container | capacity, maxWeight | the goods in `engine.inventory.container(id)` |
| Item (`inventory.define`) | name, icon, stack, weight, use | count and per-piece `data` (durability, ammo): `add('sword', 1, { data: { durability: 40 } })` |
| Entity type (`entities.define`) | create, stages, interact, collider, state defaults | `ent.state` (stage, watered) on its world record |
| Crop / enemy kind (your own table) | grow time, max hp, drops | `plantedAt`, `hp` on the record |

Definitions are frozen when registered (`content/templates.js`, `inventory.define`, `entities.define`):
`engine.content.template('chest').state.opened = true` throws `Cannot assign to read only property`, and the engine's error hint says to keep the
value on the record instead (`engine.world.set(id, { opened: true })`). Read a definition with `engine.content.template(name)` or
`engine.inventory.item(id)`. For your own tables of kinds (enemy types, crop types), the same split applies: keep the table in content, store `kind`
plus the changing values on the record, and wrap the table with `Object.freeze` if you like. <!-- r18-ignore-line -->

## 4. Tests
`tests/specs/templates.mjs`: two chests of one template share the model, open / goods per instance, save and reload restores each, the definition
never changes. `tests/specs/single-source.mjs` (`npm test -- "Single source"`): ids, duplicates, baseline + diff, orphans, level nodes, source lines, pick.

## 5. Point -> thing: where is this defined
Runtime ops change only the current session and its saves. To change the level itself, edit the content files or the level model, then reload. To find
the entry, ask the engine what a thing is:
```js
const t = engine.pick(0, 0)?.thing;   // what is in the middle of the screen
// { id: 'chest-home', kind: 'chest', template: 'chest', definedAt: 'content/props.js:14', templateAt: 'content/templates.js:3', fields: { opened: false }, edit: 'defined in content/props.js:14: …' }
engine.world.origin('chest-home');     // the same source info for an id
```
`hit.thing` is on every `engine.pick` / `engine.raycast` hit (computed when read); a hit on a batched copy resolves to its original object.
`engine.inspect(id).thing` and `engine.explain({ op, args: { id } })` say the same. A hit on a plain object added with `engine.add` gets its
`hit.thing` from the registry (id, `at` = the file:line of the add, `saved`, `edit`; recipe 41). A record made during play shows the op and tick that spawned it
(`spawned`), a level node its level and node name. Source lines exist in dev and test builds only (a Vite transform tags `content/*.js` with their
line numbers); a release build has none and pays nothing. From a terminal or an MCP client: `npx threedog pick 480,270` (screen pixels from the canvas
top-left) or the MCP tool `pick { x, y }`.

## 6. When to use a template
Two doors lead into one scene. Plain three.js, `engine.add(mesh, { id })`, is fine for anything your code rebuilds on every start: a code-built
windmill, colliders, interactions. A template plus a placement with an `id` in `content/props.js` (or `pickups`, `npcs`, `containers`, a game kind
from `rules.js`, the level model) is what you want when the thing must be saved with its own state, edited without touching code, or copied many
times. Both land in the same registry: `engine.thing(id)` answers for either and says what a save keeps (recipe 41). Game code keeps the rules: ops,
`world.simulate` / `world.present`, conditions and UI. Something that appears during play is created inside an op with `engine.spawn`.

`npm run check` (rule R33) flags only what breaks, in examples, templates and `games/*` alike. Error: `world.add` (without `{ save: false }`),
`engine.spawn`, `spawnPickup`, `npcs.add` or `entities.spawn` at module top level or in an `engine:ready` / `level:loaded` / `session:start`
handler, because those are saved whole and the startup code would make a second copy after every load; and `world.add(…, { initial: true })`
anywhere. Warning: code that `engine.add`s a `world.view(id)` model or writes its position / rotation / scale (world puts it back every frame).
The fix is a placement in content, or an op. Places computed from the seed (a flat spot for `home`) stay in code and are passed as `places` to
`content.load`; a mesh built in code becomes a model by name (`engine.assets.manifest({ models: { cabin } })`) when you want it as a template.
A line that really must do it from code at startup carries `// runtime: <reason>`.
