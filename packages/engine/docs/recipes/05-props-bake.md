# Props and baking

**Props** are a small number of hand-placed objects (a tree next to a cabin, rocks, street lamps). Write them as data; each entry becomes an ordinary `kind: 'prop'` record in `engine.world` (needs `world()`, which `openWorld()` already includes). The model is created only when the player gets close (within terrain view distance), and **the collision body and ray registration are built with the model and removed when the player leaves** (only things near the player need to block the way).
Large repeated areas (forests, grass) don't use this; use `content/vegetation.js` (instanced vegetation).

## 1. Prop data
`games/<game>/content/props.js` (a list; remember to add it to `content/index.js`):
```js
export default [
  { model: 'pine', place: 'home', x: -8, z: -6, scale: 1.2, collide: 'circle' },   // name of a generator function in the style pack's models
  { model: ['flower', 0xf2d16b], place: 'home', x: 1.6, z: 3.4 },                   // with arguments, use an array: models.flower(0xf2d16b)
  { model: 'rock', x: 120, z: -40, rot: 0.6, scale: 0.8, collide: 'box' },          // no place = world coordinates; rot in radians
  { model: 'well', place: 'home', x: 4, z: -4, y: 0, collide: 'box' },              // not a generator name, so it is treated as an asset name: assets.model('well')
  { model: 'crate', place: 'tower', x: 1, floor: 6, y: 0.5 },                        // on the tower's second floor (not its roof), half a meter up
];
```
Fields: `id` (stable id, see below), `model`, `place` + `x/z` (relative to the place), `floor` (on multi-layer ground — a second storey, a bridge deck, a lower dungeon level — the reference height of the layer it stands on; a level-marker place lends its own height), `y` (height above that ground), `rot`, `scale`, `collide` (`'box'` / `'circle'` / omitted = does not block), `static: false` (do not register for rays).
An entry with `template` instead of `model` (`{ template: 'chest', x: 3, z: 1 }`) places an instance of a content template: a reusable object with interaction, container and saved state (recipe 30).
A model name is looked up first in `content.load(data, { models })` (by default the style pack's `style.models`); if not found, `engine.assets.model(name)` is used, so a glTF must be registered in the manifest first:
```js
engine.assets.manifest({ models: { well: '/models/well.glb' } });
```
Props with the same model share one prototype (geometry and material are built once); each spot gets a clone.

**Stable ids and saves**: if you write an `id` it is used; otherwise the id is `prop:<model name>:<index in the props array>` (for a model with arguments, the name is used, e.g. `prop:flower:5`). The same content gives the same ids on every load, with no collisions (two colliding ids throw during development and say how to fix it).
Inserting a new entry in the middle shifts the later indexes, so moves / deletions in old saves no longer match. **Give an `id` to any prop whose content may still change.**
Get them in code, move or delete them (all saved with the game):
```js
engine.world.query({ kind: 'prop' });                     // all prop data { id, position, model, rot, scale, collide ... }
engine.world.move('prop:rock:3', { x: 12, z: -4 });         // move: model, collision and ray registration follow; height is recomputed from the ground
engine.world.set('prop:rock:3', { rot: 1.2, scale: 1.5 });  // change rotation / size
engine.world.remove('prop:pine:0');                       // delete (model and collision are removed together)
engine.world.view('prop:rock:3');                         // the current model (null when the player is not near)
```
Props are the world's **initial data**: a save records only moves, changes and deletions, so the result is the same whether `content.load` runs before or after loading a save (a deleted prop never reappears); props added to the content in a game update also show up when an old save is loaded.
A prop whose position uses a level marker carries a `zone` (= level name): changing level only removes the model, and moves / deletions are still there when you come back.
Procedural models from the style pack (both props and vegetation) go through `engine.assets.cached(modelName, generator, args)`: if baked, the file in `public/models/baked/` is read; during development the result is cached automatically.
Models are obtained asynchronously and the loading screen waits for them (`engine.world.ready`: every model that should exist nearby at the start is built); `world.view(id)` works after `start()`; a model built later when the player walks up appears one or two frames late (to wait, `await engine.world.whenReady`).
If a model fails to generate, world reports it once in the console, does not block loading, and retries when the player walks away and comes back.

## 2. Large code-generated models and baking
Big things assembled in code, such as a city block or a whole house, are written as a function, registered in the manifest and fetched by name. During development they are cached automatically (.threedog/cache) and recomputed when the code changes:
```js
import { buildBlock } from './block.js';
engine.assets.manifest({ models: { 'city-block': buildBlock } });     // the function returns an Object3D or a geometry
const block = await engine.assets.model('city-block');
engine.use(level({ url: 'city-block' }));                               // a level reads it by name (the city example does this): baked file and cache both apply, and loading a save can switch back to this map
```
To package a release or edit it in Blender, create `bake.js` in the game folder (`npm run bake -- -w <game>` looks for `bake.js` in that game's folder and for the engine's `styles/*/index.js`):
```js
// games/<game>/bake.js
import { buildBlock } from './block.js';
export const bake = { 'city-block': () => buildBlock() };
```
`npm run bake` exports to this game's `public/models/baked/<name>.glb` and writes `index.json`; afterwards `assets.model('city-block')` with the same name reads the file.
If the generating code changes again: during development you are told to "switch to computing it live", and `npm run build` fails to remind you to bake again. To keep editing in Blender, write the manifest entry as `{ build, source: 'file' }`; it is never overwritten afterwards.

## 2b. Many copies of one model: automatic batching
Nothing to write: the engine (`engine.batching`, core) watches what is added to the scene, so props, `world.present` views, grid items, `stream` builds and anything you `engine.add` are covered. When the same geometry + material (+ shadow flags) appears at least 8 times in one 64 m cell, those meshes are drawn by one real `THREE.InstancedMesh` per cell; fewer stay plain meshes. Each placed object stays in the scene with its own userData, record, collision and interactions; only its meshes are moved to layer 31 (not drawn), so `engine.raycast` / `pick` / photo return the original object, not an instance index.
```js
const crate = engine.world.view('crate_3');
if (crate) {
  engine.batching.tint(crate, 0xff8080);       // recolor one copy (instance color; null restores)
  engine.batching.of(crate);                   // [{ mesh: InstancedMesh, index }], [] when drawn on its own
}
engine.batching.batches;                       // [{ mesh, cell, count, items }] for inspection
engine.batching.stats;                         // { batches, instances, saved } (also describe().perf.batching)
engine.batching.enabled = false;               // global switch; createEngine({ batching: false }) never starts it, { minCount, cell } tunes it
```
- Move / hide / remove a copy as usual (`world.move`, `obj.visible = false`, `engine.remove`): its instance follows next frame; unloading a cell frees its batch.
- Opt out: `batch: false` on a prop entry, or `userData.batch = false` on a model (clones inherit it, so set it on the prototype). Do this for models whose parts you animate or whose materials you swap; if you forget, the copy is taken out of its batch automatically with a one-time dev warning.
- Never batched: skinned, morphing or animated models, multi-material or transparent meshes, `ShaderMaterial`, meshes with children, and level geometry `hlod` registered (hlod owns far, batching owns near).

## 3. Loading: what is it waiting for, what failed, does it block the start
Every asset load is a task in `engine.loading` (so are module init / `isReady`, the stream's nearby builds and the game's own steps). Each task has a phase (`queued` → `download` → `decode` → `upload` / `build` → `done` | `failed`), progress, the error (file, HTTP status, a texture or `.bin` the model references but could not load) and its source (which manifest, which path, file version, animation names).
Decide per entry what a failure means:
```js
engine.assets.manifest({
  models: {
    hero: { url: '/models/hero.glb', critical: true },          // the game cannot start without it: start() stops and says why
    bush: '/models/bush.glb',                                    // degradable (default): a gray placeholder, the game continues
    fern: { url: '/models/fern.glb', fallback: 'bush' },        // degradable, shows another entry instead
  },
}, { name: 'forest' });                                          // the source label in engine.loading (default 'manifest#1')
const level = await engine.loading.track('level-data', () => fetch('/levels/1.json').then(r => r.json()));   // the game's own step, critical by default
```
- Finished is not succeeded: `describe().loading` has `done` (nothing pending) and `ok` (nothing failed, no missing references); `blocked` is true when a critical item failed before the start. `waiting` names the current item, e.g. `decoding model "hero" (/models/hero.glb, manifest "forest")`.
- `threedog loading` prints the same view (it answers while `start()` is still running or stuck); `threedog loading hero` shows one task with its source. Failures also go to `.threedog/errors.log` with the likely cause.
- The loading-screen part gets the current item as `text`; when a critical item fails it gets `failed` and stays up (class `.threedog-loading-failed`).
- Unregistered paths (`assets.model('/x.glb')`) and code-generated models do not fall back: the error goes to the caller, and the task shows it.

## 4. Verify
- `npm run check`: prop model names and place names are validated. After `npm run map`, GAMEMAP.md has a props table.
- Loading: `engine.loading.list({ phase: 'failed' })` should be empty; related test `npm test -- 加载可观察`.
- `describe().content.props` is the number of prop entries; when the player is near, named objects appear in `nearby` (`npm run shot -- / --pos x,z --describe-only`).
- Collision: `engine.collision.walkable({ x, z })` should be false at a prop's position.
- Baking: `npm run bake` prints each item's size; related test `npm test -- 烘焙`. To look at the picture: `npm run shot -- / --pos x,z`.

## 5. Deleting objects
`engine.remove(obj)` deletes an object and frees its GPU memory; `engine.detach(obj)` only takes it off for a while (add it back with `engine.add`). Don't call `obj.removeFromParent()` or `scene.remove()` on meshes you built: their geometry and materials would leak.
