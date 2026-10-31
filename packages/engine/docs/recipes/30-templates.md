# Templates: reusable objects, definition vs instance state

Requires `world()` (in `openWorld()`); a template with `interact` needs `interactions()`, with `container` needs `inventory()`. The code is `modules/content/templates.js`.

A **template** describes one kind of object once: its model, collision, interaction, container, sound, animation and the default values of its saved state. Every chest, campfire or bed you place is an **instance**: a world record that names the template (its `kind` is the template name) and holds only its own state. There is no inheritance and no variant layer; a different look or behaviour is another template.

## 1. Define a template
`games/<game>/content/templates.js` (add it to `content/index.js`):
```js
export default {
  chest: {
    model: 'chest',                        // style pack generator or assets name; every chest clones one shared prototype (geometry and material built once)
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
`interact` fields: `op` (required), `label` (text, i18n key, or `(rec, engine) => text`), `radius` (default 2.5), `height`, `action`, `enabled: (rec, engine) => boolean`.

## 2. Place instances
In `content/props.js`, an entry with `template` instead of `model` places an instance. It takes a position and a few explicit overrides:
```js
export default [
  { template: 'chest', id: 'chest-home', place: 'home', x: 3, z: 1 },
  { template: 'chest', id: 'chest-cave', place: 'cave', x: 0, z: 2, opened: true, items: { film: 2 }, rot: 1.6 },
];
```
Allowed per instance: `id`, `place` / `x` / `z`, `y` (height above the ground), `rot`, `scale`, `items` (replaces the starting goods) and the template's **state fields**. Writing a definition field (`model`, `collide`, `interact`...) throws and says to define another template. Without `id`, the id is `<template>:<index in props>`; give one to anything whose content may still change (same rule as props, recipe 05).

At runtime (inside an op or a fixed step), `engine.content.spawn(name, at, fields)` places a new instance and returns its record:
```js
engine.ops.define('chest.build', {
  run: (e, { x, z }) => e.content.spawn('chest', { x, z }, { items: { stick: 3 } }).id,
});
```
Instances from `props.js` are initial records (a save stores only their changes); spawned ones are saved whole. Use `engine.world.get(id)`, `set`, `move`, `remove` and `query({ kind: 'chest' })` as for any record (recipe 18). Removing a record does not remove its container (the game decides what happens to the goods).

## 3. What belongs to the definition, what to the instance
| | Definition (shared, read-only) | Instance (per object, saved) |
|---|---|---|
| Template | model, collide, static, interact, container capacity and starting goods, sound, animate, state defaults | world record: id, kind, position, rot, scale, state fields (`opened`) |
| Container | capacity, maxWeight | the goods in `engine.inventory.container(id)` |
| Item (`inventory.define`) | name, icon, stack, weight, use | count and per-piece `data` (durability, ammo): `add('sword', 1, { data: { durability: 40 } })` |
| Entity type (`entities.define`) | create, stages, interact, collider, state defaults | `ent.state` (stage, watered) on its world record |
| Crop / enemy kind (your own table) | grow time, max hp, drops | `plantedAt`, `hp` on the record |

Definitions are frozen when registered (`content/templates.js`, `inventory.define`, `entities.define`): `engine.content.template('chest').state.opened = true` throws `Cannot assign to read only property`, and the engine's error hint says to keep the value on the record instead (`engine.world.set(id, { opened: true })`). Read a definition with `engine.content.template(name)` or `engine.inventory.def(id)`. For your own tables of kinds (enemy types, crop types), the same split applies: keep the table in content, store `kind` plus the changing values on the record, and wrap the table with `Object.freeze` if you like. <!-- r18-ignore-line -->

## 4. Tests
`tests/specs/templates.mjs`: two chests of one template share the model, open / goods per instance, save and reload restores each, the definition never changes.
