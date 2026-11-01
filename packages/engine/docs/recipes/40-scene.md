# Scene: what is in the world, where, and what a save keeps

The engine's three outward concepts are **Scene** (what stands in the world, where it is, how you interact with it), **Assets** (models, textures,
sounds, fonts: `05-props-bake.md` §3b) and **Style** (how it looks: `09-style-pack.md`). Content packs belong to Scene: they are the data form of it.
Patches, ops and world records are the scene's inner machinery; read them when you need them (`23-ops.md`, `18-world.md`).

## 1. Two doors into one scene
A scene object comes in either of two ways, and both end up in the same scene:

- **Plain three.js.** Build a mesh or group, call `engine.add(obj)`. Nothing else is required. This is the right way for anything your code rebuilds
  on every start.
- **A template.** Define it in `content/templates.js`, place it in `content/props.js` with an `id`, or create it during play with
  `engine.spawn(name, at)`. This is the right way for anything that must be saved, be editable without code, or exist in many copies.

The same windmill, both ways:

```js
// A. plain three.js: your code builds it on every start
const mill = buildWindmill();                       // THREE.Group
mill.position.set(20, 0, -10);
engine.snapToGround(mill);
engine.add(mill, { id: 'mill' });
engine.collision?.addCircle(mill, { radius: 1.3 });
engine.onFrame(dt => { mill.userData.blades.rotation.z += dt * 1.5; });
```
```js
// B. template: the definition is data; the model is a name in the asset manifest
// content/templates.js
export default { windmill: { model: 'windmill', collide: 'circle' } };
```
```js
// content/props.js
export default [{ id: 'windmill-hill', template: 'windmill', x: 20, z: -10 }];
```
```js
// main.js: a code-built model registered by name
engine.assets.manifest({ models: { windmill: buildWindmill } });
```
Route B gives the object an id, a source line (`engine.world.origin('windmill-hill')`), a save record and a place a future editor can write back to.
Route A gives you less ceremony and full three.js control.

## 2. What goes in content, what stays three.js
| Put it in content (templates, props, pickups, npcs, containers) | Write it as three.js (`engine.add`, `engine.scene.add`) |
|---|---|
| Must come back after a load, or the player can change it and the change must be saved | Rebuilt by your code on every start: lights, decoration, effects, bullets |
| Should be editable without a code change (position, state, copies) | Procedural or per-frame: particles, trails, shaders, a spinning blade |
| Many copies of one definition | A one-off with custom geometry or material logic |
| Has a state worth reading with `world.get(id)` | Pure presentation |

The rule check (R33) is deliberately narrow. It flags only the calls that would run again after a load and so duplicate saved data: `world.add`,
`engine.spawn`, `inventory.spawnPickup`, `npcs.add` and `entities.spawn` at startup. `engine.add`, `collision.*`, `rigid.*`, `interactions.add` and the
like are fine at startup.

## 3. Which state a save keeps
The registry (`41-thing-registry.md`) sorts every scene object into one of four kinds:

| Kind | What it is | A save keeps | A save loses |
|---|---|---|---|
| `record` | A world record: template instance, props entry, pickup, NPC, level node | The record's fields and position; the model is rebuilt from the template | Direct edits to the model; change the record instead (`world.set`) |
| `code` | Added by your code with a stable id (`engine.add(obj, { id })`) during setup | Moves, visibility and deletion done through `thing.set` / `thing.remove` | Geometry, material changes, children added later, `userData`, state in closures (inside an `onFrame` callback) |
| `session` | Added by your code without an id, or during play | Nothing: it exists for this session only | Everything. After a load it does not come back. To keep it, make it a template and call `engine.spawn` in an op |
| `engine` | Owned by an engine module (water, sky, terrain) | Managed by that module | Do not edit it directly |

Writing `mesh.position.x = 3` in code always works; it just is not saved and cannot be undone.

## 4. The calls
- `engine.add(obj, { id })`: registers `obj` under a stable id (`engine.add(obj)` works too: it gets a session id `obj#n`, never saved; `obj.name` is not an id).
- `engine.thing(idOrObject)`: what is this? Returns `{ id, kind, owner, at, phase, saved, keeps, loses, edit, object }` for any id or object; `engine.pick(x, y).thing` gives the same.
- `thing.set` and `thing.remove`: ops that move, show, hide or delete a registered object, undoable; for `code` objects they are saved as overrides.
- `engine.remove(obj)` forgets the object in the registry too.
Details and what a save keeps: `41-thing-registry.md`.

## 5. Moving from three.js to a template
When an object turns out to need saving, editing or many copies: register its builder as a model (`assets.manifest({ models: { windmill: buildWindmill } })`),
write a template, add a placement with an id. Delete the `engine.add` line. Nothing else in the game changes.

## 6. Verify
`threedog check` flags the startup calls above; `engine.world.origin(id)` and `engine.pick(x, y).thing` say where a record came from (`30-templates.md`
§5); `engine.world.query({ kind: 'windmill' })` lists the records a save would hold.
