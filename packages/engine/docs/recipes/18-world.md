# World data: things that must be saved, grow, and keep changing while far away

**In this recipe**: 1. Three steps · 2. How to change data · 3. Example: a crop grows with game time, press E to… · 4. Data written in content ·
5. Example: something that wanders · 6. Near, far, camera, player · 7. Time and ordering rules · 8. Querying nearby things ·
9. zone and data limits · 10. Stream sources

Requires module `world()` (already included in the `openWorld()` preset). The interaction prompts in the examples need
`interactions({ ...presets.interactions.nearest })`, the inventory needs `inventory()` (keys: `presets.bindings.interact` / `.inventory`). The API list is in
`../api/world.md`; this page explains how to use it and what the rules are.

Anything in the game that "must remember its state, survive level changes, and keep changing while far away" (chests, NPCs, zombies, crops, trees the
player planted, the player itself) is one **plain data record** in `engine.world`: a stable id, a kind, a position, plus your own fields. The model is
just how it looks when the camera is near; unloading a chunk / level tears down only the model and never loses the data; a save stores only data; far
away, with no model, the data is still simulated.
A decorative rock is a props entry in `content/props.js` (an authored record, saved only if play moves or removes it); `engine.add(mesh)` is for
transient effects. Everything placed in a level comes from content, so a new game equals the content (in dev, start warns about records code created before it).
Many copies of one interactive object (chests, beds, campfires) with the same model, interaction and container: define it once as a content template
and place instances (recipe 30-templates.md); the template is the shared read-only definition, the record holds only the instance state.

## 1. Three steps: data, picture, change
```js
const W = engine.world;
W.add({ id: 'zombie_1', kind: 'zombie', position: [10, 0, -4], hp: 10 });   // fields must be plain values; without an id one is numbered automatically (saved)
W.present('zombie', {
  build: rec => new THREE.Mesh(zombieGeo, zombieMat),   // required: built when the camera is near (may be async); world adds it to the scene at rec.position
  update: (rec, obj, dt) => { obj.visible = rec.hp > 0; },   // optional: called every frame for records that have a model; change the picture from the data
  dispose: (rec, obj) => engine.remove(obj),   // optional: first argument is the data, second the model; this is the default
  show: rec => rec.hp > 0,   // optional: false = this record has no model right now (picked up, waiting to respawn)
  radius: 40,   // optional: how near to build the model (meters or a function); default world.radius (60)
});
W.simulate('zombie', {
  near: (rec, dt, obj) => { W.move(rec.id, { x: rec.position.x + dt, z: rec.position.z }); },   // near the player: every fixed step; obj may not be built yet (null), gameplay must not depend on it
  far: (rec, dt) => { rec.hp = Math.min(10, rec.hp + dt * 0.1); },   // far away: once every farEvery seconds; dt is accumulated seconds (it can catch up a long time at once)
});
```
- If `build` throws, fails, or returns something that is not an object, the error is reported once and does not block the loading screen
  (`world.ready`); it retries when you walk away and come back.
- `show` is re-evaluated when `world.set` changes data of that kind. Calling `present` again for the same kind tears down old models with the old
  dispose and rebuilds them with the new one.
- Animation, particles and other things that only matter per frame go in `present.update`, not in simulate. It runs after world placed the model
  on its record, so picture-only motion written there stays: `update: (rec, obj, dt) => { obj.getObjectByName('legL').rotation.x = Math.sin(rec.walk * 9) * 0.5;
  obj.position.x += rec.stagger * 0.1; }` (a leg swing, a stagger offset). Moving the model from anywhere else is put back next frame, with a warning.

## 2. How to change data
- Discrete changes (open a chest, switch growth stage, get picked up, change direction) use `W.set(id, { opened: true })`: it emits `world:change` and
  re-evaluates `show`. Don't `set` every step. id / kind cannot be changed (to change the kind, remove then add).
- Things that change every step (position, timers, pathfinding state) are changed directly on the rec's fields inside simulate, and position with
  `W.move`: no event, cheap.
- Both ways are saved (a save compares contents, it does not rely on events). `move` emits no event: if the picture needs to follow position, compare in
  `update` (see `content/props.js`).
- Don't hold a rec object for long: loading a save replaces it with a new object. Keep the id and call `W.get(id)` when you need it.
- Position forms: Vector3 / object / `[x, y, z]` / `{ x, z }` (a missing y keeps the old one). In development NaN or an array with only two numbers
  throws immediately.

## 3. Example: a crop grows with game time, press E to harvest when ripe
The key idea: **don't accumulate every step; record the time it was planted, `plantedAt = clock.now`, and growth = now - planted time**. Whether the
player walked away, loaded a save, or fast-forwarded with `engine.step(60)`, the result is right, and no simulate is needed.
```js
import { presets, THREE } from 'threedog';

const GROW = 120;   // ripe after 120 game seconds (the unit of clock.now)
const growth = rec => Math.min(1, (engine.clock.now - rec.plantedAt) / GROW);   // 0..1
const geo = new THREE.ConeGeometry(0.25, 0.8, 6);

engine.world.present('crop', {
  build(rec) {
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x6aa84f }));
    m.castShadow = true;
    m.userData.use = engine.interactions.add(m, { label: 'Harvest', radius: 2, enabled: () => growth(rec) >= 1, onUse: () => harvest(rec) });   // can be harvested only when ripe
    return m;
  },
  update(rec, obj) {   // grows bigger, changes color when ripe
    const g = growth(rec);
    obj.scale.setScalar(0.3 + 0.7 * g);
    obj.material.color.setHex(g >= 1 ? 0xe8a33d : 0x6aa84f);
  },
  dispose(rec, obj) { obj.userData.use.remove(); engine.remove(obj); },   // an interaction you registered yourself must be removed yourself
});

function harvest(rec) {
  engine.inventory.add('carrot', 2);
  engine.world.remove(rec.id);   // delete the data after harvesting (the model goes with it). To "grow back after a while": world.set(rec.id, { plantedAt: engine.clock.now }); to hide temporarily: return false from show
}

// the player plants one: an op, because saved state changes only in a fixed step or an op (recipe 23 §5); a key, a button or a test runs it
engine.ops.define('crop.plant', {
  desc: 'Plant a crop on the ground',
  args: { x: 'number', z: 'number' },
  run(e, { x, z }) { return e.world.add({ kind: 'crop', position: { x, y: e.surface(x, z), z }, plantedAt: e.clock.now })?.id; },
});
```
The same "store when, derive the rest" pattern fits any timed thing: an enemy camp that respawns (`clearedAt`), a turret or machine cooldown
(`usedAt`), a door that shuts again (`openedAt`):
`const ready = rec => engine.clock.now - rec.usedAt >= rec.cooldown;   // no per-step counter, correct after skip and load`
Test: `engine.ops.run('crop.plant', { x: 2, z: 2 })` -> `engine.step(130)` (fast-forward 130 game seconds) -> the player walks next to it -> `engine.ops.run('interaction.use')` ->
`engine.inventory.count('carrot')`.

## 4. Data written in content: `initial`
Things that exist from the start (3 crops already in the field, chests on the map) use `add(def, { initial: true })` and must have a stable id. **A
save records only their changes and deletions**: if the content changes (one more crop is placed), an old save shows it too; a deleted one stays gone
after loading, and a deleted field is "no such field" after loading; it does not matter whether `content.load` runs before or after loading the save.
```js
for (const [i, p] of [[0, 0], [2, 0], [4, 0]].entries())
  engine.world.add({ id: `crop-start-${i}`, kind: 'crop', position: { x: p[0], z: p[1] }, plantedAt: 0 }, { initial: true });
```
When placement should be "random but identical on every start", use `engine.random.seeded(seed)` (an independent generator that does not touch the
saved `engine.random`):
```js
const rnd = engine.random.seeded(7);
for (let i = 0; i < 20; i++) engine.world.add({ id: `rock-${i}`, kind: 'rock', position: { x: rnd.range(-40, 40), z: rnd.range(-40, 40) } }, { initial: true });
```
These loops show what content loaders do. In a game, put such entries in `content/props.js` (a loop inside the content file is fine): each then gets a
source line (`engine.world.origin(id).definedAt` in dev builds) and a new game stays equal to the content.
Gameplay randomness (drops, lightning, wander turns) still uses `engine.random` (saved; after loading it continues the same sequence). Records
generated at runtime (planted by the player, spawned) are saved whole; `add(def, { save: false })` is not saved (temporary things). The rules are
described at the top of `modules/world/persist.js`.
World models are in the thing registry too (`engine.thing(id)` answers with the record, saved `'record'`): do not move them from code. Change the
record (`ops.run('thing.set', { id, position })`, `world.set` / `world.move`); dev reports code that moves a `positionFrom: 'record'` model, and
`engine.add` of a model throws (recipe 40).

A world record's model belongs to the scene too (`40-scene.md`; `engine.thing(id)` shows it, recipe 40). Do not move that model from code: the record owns its <!-- r18-ignore-line -->
position, so change the record (`world.set`, `world.move`) and the model follows.

## 5. Example: something that wanders
For enemies that chase the player / wandering NPCs there is the ready-made `engine.npcs.behavior(name, { near, far })` + `engine.npcs.avoid` (mutual
avoidance), see recipe 02 "Changing behavior / custom behavior"; below is the pure world version without NPCs.
```js
engine.world.present('chicken', { build: rec => makeChicken() });
engine.world.simulate('chicken', {
  near: (rec, dt) => wander(rec, dt),   // near: a small step every fixed step
  far:  (rec, dt) => wander(rec, dt),   // far: catch up once every farEvery seconds
  farEvery: 2,
});
function wander(rec, dt) {
  const a = rec.heading ?? 0;
  engine.world.move(rec.id, { x: rec.position.x + Math.sin(a) * 1.2 * dt, z: rec.position.z + Math.cos(a) * 1.2 * dt });
  if (engine.random.chance(0.01)) engine.world.set(rec.id, { heading: engine.random.range(0, Math.PI * 2) });
}
```

## 6. Near, far, camera, player
- **Near / far is decided by the gameplay anchor `world.anchor`**: by default the position of the player record (`engine.focus` when there is no
  player). A cutscene or photo mode moves the camera away, but the player's surroundings are still simulated as near: gameplay results do not depend
  on the camera. For a top-down strategy game centered on a base, set `W.anchor = baseObject`; set it back to `null` to restore the default.
- **The player is a record too**: the id and kind added by `createPlayer` are both `'player'`; position, facing, motion state (vx, vz, vy, facing,
  grounded...) and which vehicle it is on (vehicle) live in the record and are saved, and it is never torn down by walking away. Only the character's
  mover changes the position and then writes it back to the record; **move the player with `player.placeAt(position)`, not `world.move('player')`**
  (the mover would overwrite it on the next step). On load the player is put back from the record.
- **Models are built around the stream sources** (section 10, `33-stream-sources.md`): by default the player (`engine.stream.player`, follows
  `world.anchor`) and the camera
  focus (`engine.stream.camera`). Built inside the radius of any source, torn down beyond 1.25x of all of them, with an error of at most 8 meters; at
  most `world.buildPerFrame` are built per frame (default 8, unlimited while loading), and `ready` waits until all are built. Tearing a model down
  never touches its record.
- `positionFrom: 'view'` (the model moves itself, for example an NPC driven by the character mover): near simulation builds the model on the spot and
  copies the model position back to the data at the end of every fixed step; when not simulated near, the data decides and the model follows the data.
  A model moved by a physics body saves its position, not the physics solver state: after a load, resting bodies settle again and can differ by ~0.01
  mm, so replays that must match exactly should not depend on physics props.
- Radius: present / simulate each take their own `radius` (meters or a function); without it they follow `world.radius` (default 60).

## 7. Time and ordering rules (nothing lost, nothing doubled, loading a save is bit-identical)
- The dt of both near and far is accumulated fixed-step seconds (real seconds: not multiplied by `clock.rate`; with `simulate(kind, { channel: 'enemies' })` both are multiplied by that time channel's speed). For one record, whether near, far, or
  alternating, the dts add up to the elapsed time: on the step going from far to near, `far` first catches up the owed time, then `near` runs.
- **Kinds that only define far** (crops) are not split into near and far; even when you stand next to them they advance at the far pace. **Kinds that
  only define near** are not simulated far away, and the owed time is not caught up.
- Near: at the start of each step, the records inside the radius are gathered and simulated one by one **sorted by id** (independent of insertion
  order and loading; when near records affect each other, running continuously and saving then loading give bit-identical results).
- **Near tiers** for crowds: `simulate(kind, { near, fullRadius: 25, nearEvery: 4 / 60 })` runs records within `fullRadius` every step and the rest of
  the near zone once every `nearEvery` seconds, handing it the seconds since its last turn. Turns go by hashed id and step count (saved), so loading a
  save between turns gives the same result. NPCs use it only when the game opts in (`engine.npcs.tiers({ fullRadius, nearEvery })`); leave it off for enemies whose every step matters.
- Far: records are bucketed by id and taken in turns (one round every `farEvery` seconds), at most `world.farMaxPerTick` records per fixed step
  (default 500); the rest queue for the next step, and dt keeps accumulating without loss. It counts records, not milliseconds, so the result does not
  depend on how fast the machine is.
- The owed time and the simulation step count are saved: after loading they are caught up the same way, and the same save gives the same result
  however many fixed steps run per frame. For things measured by game clock (grows in a few days, respawns at a time), record `engine.clock.now` and compare.
- **Far in workers** (many far records, e.g. thousands of crops, spawners or machines): `W.simulate('crop', { far, worker: true })`. Each step's far batch is copied and run
  in `engine.threads` workers, then written back 4 fixed steps later through `engine.commits`; if a reply is late the same function runs on the main
  thread, so threads on / off / slow give **bit-identical** records. Only fields far changed are written back (gameplay changes to other fields during
  those 4 steps are kept). `far` must be self-contained: it is recompiled from source and sees only `(rec, dt)` and globals like `Math`; an outside
  variable throws `... x is not defined. Put constants inside the function, or store the value on the record` (also with `threads: false`, so you find
  it in development). Limit: a save taken while a batch is in flight re-simulates that stretch after loading (equal within float tolerance, not bit-identical).

## 8. Querying nearby things
```js
const list = engine.world.query({ kind: 'zombie', near: engine.player, radius: 30, where: z => z.hp > 0 });   // array, nearest first
let crowd = 0;
engine.world.forEachNear(engine.player, 5, (rec, d2) => { if (rec.kind === 'zombie') crowd++; });   // no allocation, no sorting
engine.world.get(id);  engine.world.view(id);   // the data / the current model (null when far)
```
For things that query neighbors every step (hundreds of zombies avoiding each other) use `forEachNear`; inside the callback don't add / remove / move,
note them down and change them after the loop.

## 9. zone and data limits
- A record can carry a `zone` (for example the level name); once `world.zone` is set, records with a different zone get no model and no near
  simulation, and the data stays when the level changes.
- Data must be plain values (numbers, strings, booleans, arrays, plain objects): in development, putting a three.js object or a function in it throws
  immediately and explains the fix — models go in present, logic goes in simulate.

## 10. Stream sources: what is loaded where (teleport, far camera)
Moved to `33-stream-sources.md`: the shared source list of `engine.stream`, `await engine.stream.teleport(p)`, `engine.stream.source(...)` for a photo
camera or a far view.
