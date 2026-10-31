# World data: things that must be saved, grow, and keep changing while far away

Requires module `world()` (already included in the `openWorld()` preset). The interaction prompts in the examples need `interactions()`, the inventory needs `inventory()`. The API list is in `../api/world.md`; this page explains how to use it and what the rules are.

Anything in the game that "must remember its state, survive level changes, and keep changing while far away" (chests, NPCs, zombies, crops, trees the player planted, the player itself) is one **plain data record** in `engine.world`: a stable id, a kind, a position, plus your own fields. The model is just how it looks when the camera is near; unloading a chunk / level tears down only the model and never loses the data; a save stores only data; far away, with no model, the data is still simulated.
A decorative rock or a particle effect is still `engine.add(mesh)`; it does not need to go into world.
Many copies of one interactive object (chests, beds, campfires) with the same model, interaction and container: define it once as a content template and place instances (recipe 30-templates.md); the template is the shared read-only definition, the record holds only the instance state.

## 1. Three steps: data, look, change
```js
const W = engine.world;
W.add({ id: 'zombie_1', kind: 'zombie', position: [10, 0, -4], hp: 10 });   // fields must be plain values; without an id one is numbered automatically (saved)
W.present('zombie', {
  build: rec => new THREE.Mesh(zombieGeo, zombieMat),           // required: built when the camera is near (may be async); world adds it to the scene at rec.position
  update: (rec, obj, dt) => { obj.visible = rec.hp > 0; },       // optional: called every frame for records that have a model; change the look from the data
  dispose: (rec, obj) => engine.remove(obj),                     // optional: first argument is the data, second the model; this is the default
  show: rec => rec.hp > 0,                                       // optional: false = this record has no model right now (picked up, waiting to respawn)
  radius: 40,                                                    // optional: how near to build the model (meters or a function); default world.radius (60)
});
W.simulate('zombie', {
  near: (rec, dt, obj) => { W.move(rec.id, { x: rec.position.x + dt, z: rec.position.z }); },   // near the player: every fixed step; obj may not be built yet (null), gameplay must not depend on it
  far: (rec, dt) => { rec.hp = Math.min(10, rec.hp + dt * 0.1); },                               // far away: once every farEvery seconds; dt is accumulated seconds (it can catch up a long time at once)
});
```
- If `build` throws, fails, or returns something that is not an object, the error is reported once and does not block the loading screen (`world.ready`); it retries when you walk away and come back.
- `show` is re-evaluated when `world.set` changes data of that kind. Calling `present` again for the same kind tears down old models with the old dispose and rebuilds them with the new one.
- Animation, particles and other things that only matter per frame go in `present.update`, not in simulate.

## 2. How to change data
- Discrete changes (open a chest, switch growth stage, get picked up, change direction) use `W.set(id, { opened: true })`: it emits `world:change` and re-evaluates `show`. Don't `set` every step. id / kind cannot be changed (to change the kind, remove then add).
- Things that change every step (position, timers, pathfinding state) are changed directly on the rec's fields inside simulate, and position with `W.move`: no event, cheap.
- Both ways are saved (a save compares contents, it does not rely on events). `move` emits no event: if the look needs to follow position, compare in `update` (see `content/props.js`).
- Don't hold a rec object for long: loading a save replaces it with a new object. Keep the id and call `W.get(id)` when you need it.
- Position forms: Vector3 / object / `[x, y, z]` / `{ x, z }` (a missing y keeps the old one). In development NaN or an array with only two numbers throws immediately.

## 3. Example: a crop grows with game time, press E to harvest when ripe
The key idea: **don't accumulate every step; record the time it was planted, `plantedAt = clock.now`, and growth = now - planted time**. Whether the player walked away, loaded a save, or fast-forwarded with `engine.step(60)`, the result is right, and no simulate is needed.
```js
import { THREE, makeMaterial } from 'threedog';

const GROW = 120;                                                // ripe after 120 game seconds (the unit of clock.now)
const growth = rec => Math.min(1, (engine.clock.now - rec.plantedAt) / GROW);   // 0..1
const geo = new THREE.ConeGeometry(0.25, 0.8, 6);

engine.world.present('crop', {
  build(rec) {
    const m = new THREE.Mesh(geo, makeMaterial('prop', { color: 0x6aa84f }));
    m.castShadow = true;
    m.userData.use = engine.interactions.add(m, { label: '收获', radius: 2, enabled: () => growth(rec) >= 1, onUse: () => harvest(rec) });   // can be harvested only when ripe
    return m;
  },
  update(rec, obj) {                                              // grows bigger, changes color when ripe
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

function plant(x, z) {                                            // the player plants one
  return engine.world.add({ kind: 'crop', position: { x, y: engine.surface(x, z), z }, plantedAt: engine.clock.now });
}
```
Test: `plant(2, 2)` -> `engine.step(130)` (fast-forward 130 game seconds) -> the player walks next to it -> `engine.ops.run('interaction.use')` -> `engine.inventory.count('carrot')`.

## 4. Data written in content: `initial`
Things that exist from the start (3 crops already in the field, chests on the map) use `add(def, { initial: true })` and must have a stable id. **A save records only their changes and deletions**: if the content changes (one more crop is placed), an old save shows it too; a deleted one stays gone after loading, and a deleted field is "no such field" after loading; it does not matter whether `content.load` runs before or after loading the save.
```js
for (const [i, p] of [[0, 0], [2, 0], [4, 0]].entries())
  engine.world.add({ id: `crop-start-${i}`, kind: 'crop', position: { x: p[0], z: p[1] }, plantedAt: 0 }, { initial: true });
```
When placement should be "random but identical on every start", use `engine.random.seeded(seed)` (an independent generator that does not touch the saved `engine.random`):
```js
const rnd = engine.random.seeded(7);
for (let i = 0; i < 20; i++) engine.world.add({ id: `rock-${i}`, kind: 'rock', position: { x: rnd.range(-40, 40), z: rnd.range(-40, 40) } }, { initial: true });
```
Gameplay randomness (drops, lightning, wander turns) still uses `engine.random` (saved; after loading it continues the same sequence). Records generated at runtime (planted by the player, spawned) are saved whole; `add(def, { save: false })` is not saved (temporary things). The rules are described at the top of `modules/world/persist.js`.

## 5. Example: something that wanders
For enemies that chase the player / wandering NPCs there is the ready-made `engine.npcs.behavior(name, { near, far })` + `engine.npcs.avoid` (mutual avoidance), see recipe 02 "Changing behavior / custom behavior"; below is the pure world version without NPCs.
```js
engine.world.present('chicken', { build: rec => makeChicken() });
engine.world.simulate('chicken', {
  near: (rec, dt) => wander(rec, dt),                              // near: a small step every fixed step
  far:  (rec, dt) => wander(rec, dt),                              // far: catch up once every farEvery seconds
  farEvery: 2,
});
function wander(rec, dt) {
  const a = rec.heading ?? 0;
  engine.world.move(rec.id, { x: rec.position.x + Math.sin(a) * 1.2 * dt, z: rec.position.z + Math.cos(a) * 1.2 * dt });
  if (engine.random.chance(0.01)) engine.world.set(rec.id, { heading: engine.random.range(0, Math.PI * 2) });
}
```

## 6. Near, far, camera, player
- **Near / far is decided by the gameplay anchor `world.anchor`**: by default the position of the player record (`engine.focus` when there is no player). A cutscene or photo mode moves the camera away, but the player's surroundings are still simulated as near: gameplay results do not depend on the camera. For a top-down strategy game centered on a base, set `W.anchor = baseObject`; set it back to `null` to restore the default.
- **The player is a record too**: the id and kind added by `createPlayer` are both `'player'`; position, facing, motion state (vx, vz, vy, facing, grounded...) and which vehicle it is on (vehicle) live in the record and are saved, and it is never torn down by walking away. Only the character's mover changes the position and then writes it back to the record; **move the player with `player.placeAt(position)`, not `world.move('player')`** (the mover would overwrite it on the next step). On load the player is put back from the record.
- **Models are built around the load sources `engine.load`** (section 10): by default the player (`engine.load.player`, follows `world.anchor`) and the camera focus (`engine.load.camera`). Built inside the radius of any source, torn down beyond 1.25x of all of them, with an error of at most 8 meters; at most `world.buildPerFrame` are built per frame (default 8, unlimited while loading), and `ready` waits until all are built. Tearing a model down never touches its record.
- `positionFrom: 'view'` (the model moves itself, for example an NPC driven by the character mover): near simulation builds the model on the spot and copies the model position back to the data at the end of every fixed step; when not simulated near, the data decides and the model follows the data.
- Radius: present / simulate each take their own `radius` (meters or a function); without it they follow `world.radius` (default 60).

## 7. Time and ordering rules (nothing lost, nothing doubled, loading a save is bit-identical)
- The dt of both near and far is accumulated fixed-step seconds (not multiplied by `clock.timeScale`). For one record, whether near, far, or alternating, the dts add up to the elapsed time: on the step going from far to near, `far` first catches up the owed time, then `near` runs.
- **Kinds that only define far** (crops) are not split into near and far; even when you stand next to them they advance at the far pace. **Kinds that only define near** are not simulated far away, and the owed time is not caught up.
- Near: at the start of each step, the records inside the radius are gathered and simulated one by one **sorted by id** (independent of insertion order and loading; when near records affect each other, running continuously and saving then loading give bit-identical results).
- Far: records are bucketed by id and taken in turns (one round every `farEvery` seconds), at most `world.farMaxPerTick` records per fixed step (default 500); the rest queue for the next step, and dt keeps accumulating without loss. It counts records, not milliseconds, so the result does not depend on how fast the machine is.
- The owed time and the simulation step count are saved: after loading they are caught up the same way, and the same save gives the same result however many fixed steps run per frame. For things measured by game clock (grows in a few days, respawns at a time), record `engine.clock.now` and compare.
- **Far in workers** (many far records, e.g. thousands of crops): `W.simulate('crop', { far, worker: true })`. Each step's far batch is copied and run in `engine.threads` workers, then written back 4 fixed steps later through `engine.commits`; if a reply is late the same function runs on the main thread, so threads on / off / slow give **bit-identical** records. Only fields far changed are written back (gameplay changes to other fields during those 4 steps are kept). `far` must be self-contained: it is recompiled from source and sees only `(rec, dt)` and globals like `Math`; an outside variable throws `... x is not defined. Put constants inside the function, or store the value on the record` (also with `threads: false`, so you find it in development). Limit: a save taken while a batch is in flight re-simulates that stretch after loading (equal within float tolerance, not bit-identical).

## 8. Querying nearby things
```js
const list = engine.world.query({ kind: 'zombie', near: engine.player, radius: 30, where: z => z.hp > 0 });   // array, nearest first
let crowd = 0;
engine.world.forEachNear(engine.player, 5, (rec, d2) => { if (rec.kind === 'zombie') crowd++; });            // no allocation, no sorting
engine.world.get(id);  engine.world.view(id);                                                                // the data / the current model (null when far)
```
For things that query neighbors every step (hundreds of zombies avoiding each other) use `forEachNear`; inside the callback don't add / remove / move, note them down and change them after the loop.

## 9. zone and data limits
- A record can carry a `zone` (for example the level name); once `world.zone` is set, records with a different zone get no model and no near simulation, and the data stays when the level changes.
- Data must be plain values (numbers, strings, booleans, arrays, plain objects): in development, putting a three.js object or a function in it throws immediately and explains the fix — models go in present, logic goes in simulate.

## 10. Load sources: what is loaded where (teleport, far camera)
Three things are kept apart: **what is shown** (terrain chunks, models, stream entries, hlod), **what has colliders** (rigid terrain colliders, chunk collision), and **world data** (records and their near / far simulation, which follows `world.anchor` and never unloads). Every loader reads the same list, `engine.load`:

| Source | Shows | Colliders |
|---|---|---|
| `engine.load.player` (built in: `world.anchor`, else the player, else `engine.focus`) | full | yes |
| `engine.load.camera` (built in: `engine.focus`) | full | no |
| `engine.load.source(p, { radius, detail, physics, until })` | `detail: 'full'` (default) or `'simple'` (terrain and hlod proxies only) | `physics` (default true for `'full'`) |

```js
// teleport: the player moves only after the destination's terrain, collision and nearby models are ready
await engine.load.teleport([800, 0, 300]);

// the same by hand (for a door animation or a fade while it loads)
const dest = engine.load.source([800, 0, 300], { radius: 64 });
await dest.whenReady;
engine.player.placeAt([800, 0, 300]);
dest.remove();

// a photo camera far away: a picture, no colliders; removed when photo mode ends
engine.load.source(photoCam, { physics: false, until: () => !photoMode.active });

// a far view from a tower: terrain and hlod proxies only
const vista = engine.load.source(towerTop, { detail: 'simple', radius: 600 });
```
- `radius` caps every loader's own range around that source (terrain view distance, present radius, `stream` range); without it each loader uses its own.
- `source.ready` is checked at the end of each frame; a new source counts after one full frame, so every loader has seen it. Fixed steps must run (collision takes effect on a tick), so do not wait while `engine.pause()` is on without stepping.
- Leaving a place and coming back is safe: models unload, but records (an opened chest, a dropped item, a removed rock) stay in `engine.world` and the models are rebuilt from them.
- Module authors with their own distance-based loader: read `engine.load.list({ detail: 'full' })` / `list({ physics: true })` and `engine.load.reach(s, range)`, and register `engine.load.readyCheck(name, s => ...)`. Do not read `engine.focus` or the player position for loading.

