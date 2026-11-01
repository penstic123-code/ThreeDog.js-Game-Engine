# Things: what is in the scene, who manages it, what a save keeps (engine.thing)

Every root you pass to `engine.add` is registered: an id, where it was added (`main.js:50`, dev builds only), who manages it and how much a save
keeps. World records (template instances, props, pickups, NPCs, level nodes) share the same id space and the same query, so one question works for a
plain three.js mesh and for a template instance alike. `engine.scene.add` adds without registering: the plain three.js way in, still legal.

## 1. Give it an id
```js
const windmill = buildWindmill();                  // any Object3D
engine.add(windmill, { id: 'windmill' });          // at setup: thing.set / thing.remove changes to it are saved
engine.add(spark);                                 // effects need no id: obj#7, this session only
engine.thing('windmill');
// { id: 'windmill', kind: 'Group', owner: 'game', at: 'main.js:50', phase: 'setup', saved: 'code',
//   keeps: ['position, rotation, scale, visibility and removal made with thing.set / thing.remove (scene save part)'],
//   loses: ['geometry and material changes', 'children added later', 'userData', ...], edit: 'added by code at main.js:50 (id ...)' }
engine.thing('windmill').object;                   // the live Object3D (not enumerable, so the result stays JSON-able)
engine.thing(engine.pick(0, 0).object).id;         // any child resolves to its registered root; hit.thing says the same
```
- The id is `{ id }`, else a session id `obj#n` (session tier: never saved). `obj.name` is not an id (GLB roots are all called `Scene`): it only helps `engine.thing(name)` find the object. An id is a non-empty string without `#`,
  unique across `engine.add` objects and world records: a clash throws (`thing-id`) from either side (`engine.add` or `world.add`) and says which one holds it.
- With several objects in one call (`engine.add(a, b)`) pass no id; add the one that needs an id on its own.
- `engine.thing(id | name | obj)` throws with the closest id when nothing matches. `engine.inspect(id)` takes the same ids.
- `describe().scene` gives counts only: `{ game, code, session, world, engine, unsaved, conflicts, orphans }`. Objects of engine modules (particles,
  physics bodies, nav helpers, hlod, grid tiles, the level root, streamed objects) are counted under `engine` and never listed as the game's.

## 2. Four save tiers
Judged in this order (`thing.saved`):

| Tier | When | A save keeps | A save loses |
|---|---|---|---|
| `record` | a world record's model (templates, props, pickups, NPCs, level nodes) | the record's fields and position (world part); the model is rebuilt from its template / present | the model object itself; change it through the record |
| `code` | added by game code with a stable id at setup (before `engine.ready`, or in a `session:start` listener) | position, rotation, scale, visibility and removal made with `thing.set` / `thing.remove` (`scene` part) | geometry and material changes, children added later, `userData`, closure state, writes like `mesh.position.x = 3` |
| `session` | no stable id, or added during play | nothing: it exists only in this session | everything; it does not come back after a load |
| `engine` | managed by an engine module | its module's business | direct changes (the module rewrites them) |

Only transform, visibility and removal are saved for `code` objects; colours and materials belong to Style and are not saved. To keep something made
during play, make it a template and create it inside an op with `engine.spawn(name, at)`: a record is saved whole.

## 3. Change it: thing.set / thing.remove (ops, undoable)
```js
const args = { id: 'windmill', position: [5, 0, 2], rotation: 1.2 };   // rotation: a number is yaw, or [x, y, z]; scale: a number or [x, y, z]
const r = engine.ops.run('thing.set', args);
engine.ops.undo('thing.set', args, r.value);                            // back where it was
engine.ops.run('thing.remove', { id: 'windmill' });                     // detached and kept: undo puts it back
```
- A world record id turns into `world.set` / `world.move` (`rot` / `scale` are template instance fields) and `world.remove`; the model follows the
  record. `visible` is refused for a record (`recordVisible`): hide its model with `present({ show })` and a field.
- A `code` object gets its new values written and recorded as an override; a `session` object only changes in this session.
- Objects of engine modules are refused (`engineOwned`).

## 4. Saves: the `scene` part (version 1)
`{ set: { windmill: { position: [5, 0, 2] } }, removed: ['old-fence'] }`, only for `code` objects. A load first undoes the current overrides (a new
game applies an empty part, so everything goes back to what the code built), then applies the save. An id the save names but no object has yet waits:
the override applies the moment `engine.add(obj, { id })` runs. One that never comes is an orphan: kept in the save, listed in
`describe().scene.orphans` and warned once (`thing-orphan`).

## 5. Dev checks
- `engine.add(obj, { save: true })` for an object that cannot be saved (no id, or during play) warns at once (`thing-unsaved`); objects added inside an
  op are listed by `saves.save()` and in `describe().scene.unsaved`.
- `engine.add` of a world model throws (`thing-owned`): world adds, places and tears down its models.
- Code that moves a `positionFrom: 'record'` world model outside its present `update` is warned once and listed in `describe().scene.conflicts`.
- Rule R33 (`npm run check`) flags the static half: startup calls that create things saved whole, and code writing `world.view()` models.
- Cost: a release build pays two table writes per `engine.add` (about 2 µs per add in `tests/specs/things.mjs`); dev builds also take a short stack
  for `at`, at most 2000 per session (`describe().scene.atCapped` after that).
