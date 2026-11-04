# Props and baking

**In this recipe**: 1. Prop data · 2. Large code-generated models and baking · 2a. Models in plain three.js · 2b. Many copies of one model ·
2c. Art iteration loop · 2d. Where art comes from · 2e. Plants on your own geometry and spots · 3. Loading: what is it waiting for, what failed, does it… · 3b. Asset packs · 4. Verify ·
5. Deleting objects

**Props** are a small number of hand-placed objects (a tree next to a cabin, rocks, street lamps). Write them as data; each entry becomes an ordinary
`kind: 'prop'` record in `engine.world` (needs `world()`, which `openWorld()` already includes). The model is created only when the player gets close
(within terrain view distance), and **the collision body and ray registration are built with the model and removed when the player leaves** (only
things near the player need to block the way).
Large repeated areas (forests, grass) don't use this; use `content/vegetation.js` (instanced vegetation), or section 2e for plants on your own geometry.

## 1. Prop data
`games/<game>/content/props.js` (a list; remember to add it to `content/index.js`):
```js
export default [
  { model: 'pine', place: 'home', x: -8, z: -6, scale: 1.2, collide: 'circle' },   // an asset name (here a generator from an asset pack)
  { model: ['flower', 0xf2d16b], place: 'home', x: 1.6, z: 3.4 },                   // a generator with arguments, use an array: flower(0xf2d16b)
  { model: 'rock', x: 120, z: -40, rot: 0.6, scale: 0.8, collide: 'box' },          // no place = world coordinates; rot in radians
  { model: 'well', place: 'home', x: 4, z: -4, y: 0, collide: 'box' },              // a file asset: assets.model('well')
  { model: 'crate', place: 'tower', x: 1, floor: 6, y: 0.5 },                        // on the tower's second floor (not its roof), half a meter up
];
```
Fields: `id` (stable id, see below), `model`, `place` + `x/z` (relative to the place), `floor` (on multi-layer ground — a second storey, a bridge
deck, a lower dungeon level — the reference height of the layer it stands on; a level-marker place lends its own height), `y` (height above that
ground), `rot`, `scale`, `collide` (`'box'` / `'circle'` / `{ circle: 0.25, occluder: false }` / omitted = does not block; a circle stands on the model's base, see recipes/30-templates.md), `static: false` (do not register for rays), `batch: false` (see 2b).
An entry with `template` instead of `model` (`{ template: 'chest', x: 3, z: 1 }`) places an instance of a content template: a reusable object with
interaction, container and saved state (recipe 30).
A model is always an **asset name**, never a path or a function (`npm run check` reports both): register it in a manifest or asset pack first.
There is one path for "a model, used by name": a file entry or a generator entry (built once per name + params, baked file -> dev cache -> build)
means the same thing in content (props, templates, vegetation), `assets.model(name)`, an item's `model` (pickups) and `vegetation.define(name, { model })`.
The game's packs live in `assets.js` (export default one pack or a list), which main.js registers and `npm run check` imports, so the names it
checks are the names the game registers:
```js
// assets.js
import { assets as scenery } from 'some-asset-pack';                  // a published pack, or your own folder's
export default [scenery, { name: 'props', models: { well: '/models/well.glb', crate: () => makeCrate() } }];
// main.js
import packs from './assets.js';
engine.assets.manifest(packs);                                        // pine, rock, ['flower', color], well, crate...
```
Props with the same model share one prototype (geometry and material are built once); each spot gets a clone.

**Stable ids and saves**: if you write an `id` it is used; otherwise the id is `prop:<model name>:<index in the props array>` (for a model with
arguments, the name is used, e.g. `prop:flower:5`). The same content gives the same ids on every load, with no collisions (two colliding ids throw
during development and say how to fix it).
Inserting a new entry in the middle shifts the later indexes, so moves / deletions in old saves no longer match. **Give an `id` to any prop whose
content may still change.**
Get them in code, move or delete them (all saved with the game):
```js
engine.world.query({ kind: 'prop' });                     // all prop data { id, position, model, rot, scale, collide ... }
engine.world.move('prop:rock:3', { x: 12, z: -4 });         // move: model, collision and ray registration follow; height is recomputed from the ground
engine.world.set('prop:rock:3', { rot: 1.2, scale: 1.5 });  // change rotation / size
engine.world.remove('prop:pine:0');                       // delete (model and collision are removed together)
engine.world.view('prop:rock:3');                         // the current model (null when the player is not near)
```
Props are the world's **initial data**: a save records only moves, changes and deletions, so the result is the same whether `content.load` runs before
or after loading a save (a deleted prop never reappears); props added to the content in a game update also show up when an old save is loaded.
A prop whose position uses a level marker carries a `zone` (= level name): changing level only removes the model, and moves / deletions are still
there when you come back.
Procedural models of an asset pack (props, templates, vegetation, pickups) are built through that one path: if baked, the file in
`public/models/baked/` is read; during development the result is cached automatically.
Other things made in code have one home each: a texture made in code goes in the manifest's `textures` (a Texture or a function returning one), a
sound made in code (a synth function) in its `sounds`, and a material made in code is plain three.js in the game's `picture/` (recipe 09), not an asset.
Models are obtained asynchronously and the loading screen waits for them (`engine.world.ready`: every model that should exist nearby at the start is
built); `world.view(id)` works after `start()`; a model built later when the player walks up appears one or two frames late (to wait,
`await engine.world.whenReady`).
If a model fails to generate, world reports it once in the console, does not block loading, and retries when the player walks away and comes back.

## 2. Large code-generated models and baking
Big things assembled in code, such as a city block or a whole house, are written as a function, registered in the manifest and fetched by name. During
development they are cached automatically (.threedog/cache) and recomputed when the code changes:
```js
import { buildBlock } from './block.js';
engine.assets.manifest({ models: { 'city-block': buildBlock } });     // the function returns an Object3D or a geometry
const block = await engine.assets.model('city-block');
engine.use(level({ url: 'city-block' }));                               // a level reads it by name (the city example does this): baked file and cache both apply, and loading a save can switch back to this map
```
To package a release or edit it in Blender, create `bake.js` in the game folder (`npm run bake -- -w <game>` reads the `bake` export of `bake.js`
in that game's folder). A game's picture lives in its own `picture/` folder; a model built there is baked the same way, by importing its
builder into `bake.js`:
```js
// games/<game>/bake.js
import { buildBlock } from './block.js';
export const bake = { 'city-block': () => buildBlock() };
```
`npm run bake` exports to this game's `public/models/baked/<name>.glb` and writes `index.json`; afterwards `assets.model('city-block')` with the same
name reads the file.
If the generating code changes again: during development you are told to "switch to computing it live", and `npm run build` fails to remind you to
bake again. To keep editing in Blender, write that entry in `bake.js` as `{ build, source: 'file' }`; it is never overwritten afterwards.

## 2a. Models in plain three.js
No model file yet? Don't add loose `THREE.Mesh(new THREE.BoxGeometry())` calls to `main.js`: write the model as one function in plain three.js
(any geometry, the `three/addons` ones such as `RoundedBoxGeometry`, `ExtrudeGeometry`, `mergeGeometries`, or a CSG library you install), register
it by name, and use the name everywhere. Later a `.glb` registered under the same name replaces it with no other change.

**The generator contract**
- Return a `BufferGeometry` (drawn with a neutral gray material, or white under its vertex colors) or an `Object3D`
  (a Mesh or a Group, with any number of meshes and materials, used as it is). It may be `async`.
- Arguments: `model: ['name', ...args]` in content passes them as written (each argument list is its own cached model). Or declare a schema,
  `{ build, params: { height: { type: 'number', min: 1, max: 8, default: 3 }, leaf: { type: 'color', default: 0x4a7a3a } } }` (the
  `core/params.js` format, plus `'color'`): the generator then gets one object, defaults < dev panel values < a call's own `['pine', { height: 5 }]`,
  and a typo or wrong type throws naming the field.
- Written as `function` (not an arrow), `this` is `{ palette, engine }`: `this.palette` = `engine.assets.palette`, `this.engine` = the engine.
- Shadows: `{ build, castShadow: false }` in the manifest turns them off for every mesh. Without it, a generator that set `castShadow` or
  `receiveShadow` on any of its meshes keeps its own flags (a rug that receives but does not cast); one that set none casts and receives
  everywhere. The same rule holds for `assets.model(name)` and content props.
- It runs once per name + params; every placement is a clone sharing geometry and materials (`engine.assets.model(name)` and content props alike).
- Cache key = name + the generator's source (its file and imports) + params + `engine.assets.palette`. Values it reads from outer variables must go in
  `params`, or a change keeps the stale model. In dev a build slower than `assets.cacheMinMs` (20 ms) is stored as GLB in `.threedog/cache` and
  read back next time; `npm run bake` writes the same GLB to `public/models/baked/` (section 2). Neither is needed: unbaked generators run in the
  built game (`npm run build`) too.
- What the GLB round trip keeps: the hierarchy, names, `userData`, shadow flags, visibility, every material's type and settings, and textures in
  standard slots (`map`, `normalMap`, ...; also ones made in code like `CanvasTexture`). A mesh with a material array comes back as one mesh per
  material. **Lost**: a material's own `onBeforeCompile` and `applyEffects` patches, `lightMap` / `specularMap` / `envMap` and a toon `gradientMap`
  (glTF has no slot: the bake warns once naming the model and slots), `ShaderMaterial` texture uniforms, and the identity of uniform objects (code holding `mat.uniforms.time` stops driving the
  copy). For such a model write `{ build, cache: false }` (never stored in the dev cache, and don't bake it), or set that material after loading.

```js
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function lampPost() {
  const pole = new THREE.MeshStandardMaterial({ color: this.palette.metal ?? 0x3a3d42, roughness: 0.5, metalness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffd27a, emissiveIntensity: 1.5 });
  const root = new THREE.Group();
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 0.5, 2, 0.05), pole); base.position.y = 0.15;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3, 12), pole); post.position.y = 1.8;
  const head = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.2, 0.05], [0.14, 0.4], [0, 0.45]].map(([r, y]) => new THREE.Vector2(r, y)), 16), glass);
  head.position.y = 3.3;
  for (const m of [base, post, head]) { m.castShadow = m.receiveShadow = true; root.add(m); }
  return root;
}
engine.assets.manifest({ name: 'props', models: { lampPost } });
// content/props.js: { model: 'lampPost', x: 4, z: 2, collide: 'circle' }        code: engine.add(await engine.assets.model('lampPost'), { id: 'lamp-1' })
```

**Where the colors come from**
- **The model's own three.js materials** (`new THREE.MeshStandardMaterial({ map: canvasTexture })`, a `ShaderMaterial`), any type a game's picture calls for.
- **Colors shared between models** live in the palette: read `this.palette.metal` in the generator, as the lamp post does.
- Vertex colors for a merged model: `mergeColored([[geometry, this.palette.wood], ...])` returns one geometry.

**The palette.** `engine.assets.palette` is a plain object of named colors: `engine.assets.palette = { wood: 0x8a5a36, leaf: 0xd98a3a }`, or write one key.
Generators and code-made textures read it as `this.palette`. Set it before the models load; after a write, whatever is asked for next is built from the
new colors, while copies already placed keep theirs. `.glb` files never follow it, and a baked file (built with no palette) is skipped while the palette
has keys, unless its bake entry says `source: 'file'`.

Very detailed models (faces, sculpted shapes, hand-painted textures) are faster in Blender: export a GLB and register it (recipe 46).

## 2b. Many copies of one model: automatic batching
Nothing to write for what the engine places: `engine.batching` (core) covers world record views (props, templates, grid items, `world.present`),
`stream` builds and level files. When the same geometry + material (+ shadow flags) appears at least 8 times in one 64 m cell, those meshes are
drawn by one real `THREE.InstancedMesh` per cell; fewer stay plain meshes. Each placed object stays in the scene with its own userData, record,
collision and interactions; only its meshes are moved to layer 31 (not drawn), so `engine.raycast` / `pick` / photo return the original object,
not an instance index.

Objects your code makes and adds (`engine.scene.add(mesh)`, `engine.add(mesh)`, `engine.rigid.addBox / addBall / addHull(mesh)`) are never touched unless you ask: your own
`THREE.Raycaster`, scene walks and material swaps see exactly the meshes you made. Many static copies of your own mesh (fence posts, tiles, coins)
opt in with one flag on the root you add, set before adding it (or call `engine.batching.refresh(obj)` after). In dev, `engine.inspect.perf()` and
`describe().perf.batching.hint` say so when many identical meshes of yours draw one by one.
```js
for (const p of postSpots) { const m = new THREE.Mesh(postGeo, woodMat); m.position.copy(p); m.userData.batch = true; engine.scene.add(m); }
```
```js
const crate = engine.world.view('crate_3');
if (crate) {
  engine.batching.tint(crate, 0xff8080);       // recolor one copy (instance color; null restores)
  engine.batching.of(crate);                   // [{ mesh: InstancedMesh, index }], [] when drawn on its own
}
engine.batching.batches;                       // [{ mesh, cell, count, items }] for inspection
engine.batching.stats;                         // { batches, instances, saved, note?, hint? } (also describe().perf.batching)
engine.batching.enabled = false;               // global switch; createEngine({ batching: false }) never starts it, { minCount, cell } tunes it
```
- Move / hide / remove a copy as usual (`world.move`, `obj.visible = false`, `engine.remove`): its instance follows next frame; unloading a cell frees
  its batch.
- Opt out: `batch: false` on a prop / record entry, or `userData.batch = false` on a model a `world.present` build or stream build returns (clones
  inherit it, so set it on the prototype). Do this for models
  whose parts you animate or whose materials you swap; if you forget, the copy is taken out of its batch automatically with a one-time dev warning.
- Never batched: skinned, morphing or animated models, multi-material or transparent meshes, `ShaderMaterial`, meshes with children, and level
  geometry `hlod` registered (hlod owns far, batching owns near).

## 2c. Art iteration loop: edit -> hot swap -> gallery -> compare
Works for any model made in code (a hut, a weapon, a coral, a character body), in any art style; the tools only build and show, they add no picture.
For the models that matter (characters, main buildings, props repeated across the level), think through the parts and their proportions before
writing code, and afterwards look at the model on its own, not only inside the level: `threedog gallery --shots` draws each one from a single
three-quarter view under three lights. When something seems off, turn it on the live turntable (`threedog gallery`) to see it from another side.
- **Edit, see it in place**: keep generators in modules imported by the game's `assets.js` (for example an `art/` folder). Saving one (dev server) rebuilds
  its models and swaps every live copy in place: content props, template parts, pickups, vegetation instances, `assets.model` copies. Camera,
  player, time and world state stay; `describe().assetSwaps` and a toast say what changed. A collision box keeps its placed size until the next
  load; a file that `main.js` also imports directly reloads the page instead. Without the vite preset: `engine.debug.reloadAssets(newPacks)`.
- **Tune numbers live**: declare `params` (section 2a); the dev panel's models folder (`?panel=1`) shows them and every drag rebuilds the
  copies (`engine.assets.setParams(name, values)`). "write back", then `threedog tune write` (dry run; `--apply`) puts the values into the
  schema's `default` where the model is registered.
- **Review all at once**: `?gallery=1` on the dev page, or `threedog gallery`, puts every registered model and texture on a turntable under
  three neutral light setups (midday, low sun, overcast). `threedog gallery --shots` writes `.threedog/gallery/<name>-<light>.png` and an
  `index.html` of all of them, so one picture covers the whole set.
- **Outline and light/dark on their own**: `--shots --mode silhouette,value` adds `<name>-silhouette.png` (the model pure black on white) and
  `<name>-value.png` (the midday shot in grayscale) per asset, with facts printed and stored in `index.json`: `fill` (share of the frame),
  `boxFill` (share of its own bounding box), `aspect`, and luminance `p5` / `p50` / `p95` inside the outline. They are measurements, not
  grades. Principle for reading them: a shape the player must recognize at play distance usually still reads as a silhouette, and a
  narrow p5-p95 spread means hue carries the form; whether that is right depends on the game's picture and camera, so compare assets that must
  be told apart with each other rather than with a fixed number.
- **Compare with the reference**: `threedog picture compare <reference.png> .threedog/gallery/<name>-midday.png --out diff.png` gives numbers
  for one asset against its reference crop, the same way as for a whole screenshot (`recipes/35-picture-from-reference.md`).

## 2d. Where art comes from
The engine ships no art and picks no source: the game records its choice per kind (ground, vegetation, characters, props, effects, sounds) in
the DESIGN.md "Asset sources" row, and every source ends up the same way, as a name in an `engine.assets.manifest` pack.

| Source | Good for | How it enters |
|---|---|---|
| Code (sections 2 and 2a: three.js geometry, `mergeColored`, three.js materials) | blockout, props, variations, anything tuned by `params` | a generator function in the manifest |
| Blender -> glTF | sculpted or painted finish, rigs and clips | a `.glb` path; export settings, scale (1 unit = 1 m, Y-up, applied transforms), naming and which materials survive are in `recipes/46-blender-art-route.md` |
| Free libraries (for example Kenney and Quaternius models, Poly Haven textures and HDRIs) | a lot of consistent content fast | the files in `public/` or an asset pack (section 3b), then `threedog assets` |
| Your own earlier games | an effect, material, model or texture you already made and liked | `threedog lib list` / `lib pull` (below), or `threedog art copy ../earlier-game name` |
| AI-generated 3D / textures | one-off props, texture variations | export glTF / PNG, then the same checks as any file: `threedog assets check`, scale, origin, triangle count, UVs |

**Does it fit?** Every entry has one card, measured at `lib add`: what it needs, what it provides, which shared three.js values it writes, its size (1 unit = 1 meter, up axis, origin, texture color space), its style and a short usage; `threedog lib list <word> --card` prints it. Tag a style with `--style` in your own words (a pixel-art dungeon and a watercolor village both work): only tags can say that, and two entries with no tag in common are reported. After pulling several pieces, `threedog lib check` says what is missing and what clashes, and `threedog lib status` says which copies this game changed. Nothing is forced: fix a clash in your copy, or leave a note you meant.

**Your own library.** `threedog lib add <file|folder|exportName> -w earlier-game` keeps a piece of a finished game in `~/.threedog/library` (outside the engine; `THREEDOG_LIBRARY` or `--lib` moves it) with a summary, the use line and the backends it works on; `threedog lib list [words]` searches it, `threedog lib pull <name>` copies it into this game and prints the use line (a code entry: its files go to `plugins/<name>/` and pull writes `plugins/<name>.js`, the one wiring line that calls its factory, from the entry's plug line: `lib add --plug "makeWater({ size: 4 })"` sets it, otherwise it calls the exported function; change the arguments in that file), `threedog lib page` writes a page with all previews. Look here before writing an effect from scratch. A pulled entry is a copy with no link back and no update: change it to fit this game rather than keeping it as it was, or every game ends up looking alike.

**Rules (correctness and licensing):**
- Read the license of every asset you did not make, on the page you downloaded it from, before it goes into the game; a library can mix
  licenses per pack, and terms change. CC0 needs no credit; CC-BY needs the credit line it asks for; "personal use", "editorial" or no
  license at all means it cannot ship. For AI-generated output read the service's terms (commercial use, ownership, what the inputs were).
- Record each one in the game (a `CREDITS.md` at its root, or wherever the game keeps it): asset, source URL, author, license, date. Tell the
  user before adding an asset under a license other than CC0.
- An imported file passes `threedog assets check` (missing UVs, oversized textures) and the gallery before it is used in content.

**Principles (style, flexible):**
- Mixed sources read as one game when they share one texture language (flat color, painted, or photo-based; one texel density; one
  roughness range) and one palette. When a source does not match, re-material it: keep its shape and swap its materials for the game's own
  (`recipes/46-blender-art-route.md` section 5) or tint it from the palette, rather than adding a second style.
- AI-generated meshes usually need cleanup: merge stray parts, set the origin at the base, reduce triangles, and replace baked-in lighting in
  the texture so the game's lights decide the shading.
- Put a new asset next to the existing ones in `threedog gallery --shots` (and `--mode silhouette,value`) to see whether it stands apart.

## 2e. Plants on your own geometry and spots
Grass, flowers, bushes and trees need no model files and no random scatter: give `vegetation.define` a three.js geometry and the places you want. One instanced
mesh per species, wind, shadows, LOD and felling come with it; the geometry (and material) stay yours.
```js
import { THREE, vegetation } from 'threedog';   // collision() must be installed for the collider below
engine.use(vegetation({ area: { min: [-30, -30], max: [30, 30] } }));          // on any ground: setGround, a level, or the flat default
const crown = new THREE.IcosahedronGeometry(1.2, 1).translate(0, 3, 0);                     // geometry baked at its final shape; origin at the foot
engine.vegetation.define('tree', {
  geometry: crown, material: new THREE.MeshStandardMaterial({ color: 0x3f7a3a, flatShading: true }),   // omitted: engine.vegetation.material
  positions: [[-8, 4], [6, -3, 1.3], [10, 9, 0.8, 1.2]],                                    // [x, z] | [x, z, scale] | [x, z, scale, yaw], planted at the ground height
  wind: 0.2, castShadow: true, rule: { collider: 0.5 } });                                   // collider: a trunk radius players and NPCs cannot walk through
const hit = engine.vegetation.instanceAt(engine.actorPosition(), { radius: 2, species: 'tree' });   // the nearest one, or null
```
`define` with a model name returns a Promise; with a `geometry` it is immediate. Many small spots (grass) use `rule: { perChunk }` and `nearOnly: true` instead
of `positions`; recipe 10 section 4 has both, `densityMap` and felling (`removeInstance`).

## 3. Loading: what is it waiting for, what failed, does it block the start
Every asset load is a task in `engine.loading` (so are module init / `isReady`, the stream's nearby builds and the game's own steps). Each task has a
phase (`queued` → `download` → `decode` → `upload` / `build` → `done` | `failed`), progress, the error (file, HTTP status, a texture or `.bin` the
model references but could not load) and its source (which manifest, which path, file version, animation names).
Decide per entry what a failure means:
```js
engine.assets.manifest({
  name: 'forest',                                                // the source label in engine.loading (default 'manifest#1')
  models: {
    hero: { url: '/models/hero.glb', critical: true },          // the game cannot start without it: start() stops and says why
    bush: '/models/bush.glb',                                    // degradable (default): a gray placeholder, the game continues
    fern: { url: '/models/fern.glb', fallback: 'bush' },        // degradable, shows another entry instead
  },
});
const level = await engine.loading.track('level-data', () => fetch('/levels/1.json').then(r => r.json()));   // the game's own step, critical by default
```
- Finished is not succeeded: `describe().loading` has `done` (nothing pending) and `ok` (nothing failed, no missing references); `blocked` is true
  when a critical item failed before the start. `waiting` names the current item, e.g. `decoding model "hero" (/models/hero.glb, manifest "forest")`.
- `threedog loading` prints the same view (it answers while `start()` is still running or stuck); `threedog loading hero` shows one task with its
  source. Failures also go to `.threedog/errors.log` with the likely cause.
- The loading-screen part gets the current item as `text`; when a critical item fails it gets `failed` and stays up (class `.threedog-loading-failed`).
- Unregistered paths (`assets.model('/x.glb')`) and code-generated models do not fall back: the error goes to the caller, and the task shows it.

## 3b. Asset packs (a folder or npm package of files)
An asset pack is a manifest someone else wrote: `{ name, base, models, textures, sounds, fonts }`, names only, no code that runs at load. `base`
resolves the pack's relative paths (`'/x'` and full URLs stay as written), so the same pack works from `public/`, a CDN or `node_modules`:
```js
// public/packs/forest/pack.js, or the main file of an npm package `forest-assets`
export default { name: 'forest', base: '/packs/forest/', models: { oak: 'oak.glb', fern: { url: 'fern.glb', fallback: 'oak' } }, sounds: { creek: 'creek.ogg' } };
// an npm package lets vite find and emit each file: models: { oak: new URL('./oak.glb', import.meta.url).href }
// (keep such a package out of vite's dependency pre-bundling: optimizeDeps: { exclude: ['forest-assets'] })
import forest from 'forest-assets';
engine.assets.manifest(forest);                          // content and code now say 'oak', 'creek'
engine.assets.manifest({ name: 'mine', models: { oak: '/models/my-oak.glb' } });   // a later pack replaces a name it shares
```
A generator function is also an entry (`models: { pine: () => geometry }`): an asset pack exports its procedural models this way.

Fonts are entries too, and the UI names them instead of holding the file:
```js
const engine = createEngine({ canvas, ui: { fonts: ['pixel', 'pixelBold'], theme: { font: '"pixel", system-ui' } } });
engine.assets.manifest({ name: 'ui-fonts', base: '/fonts/', fonts: { pixel: 'pixel.woff2', pixelBold: { url: 'pixel-bold.woff2', family: 'pixel', weight: 700 } } });
```
`family` defaults to the asset name; the other keys are FontFace descriptors (`weight`, `style`, `unicodeRange`, ...). `start()` loads the fonts
`createEngine({ ui: { fonts } })` lists (an unknown name stops it with the line to add); other font entries load only on `engine.assets.font(name)` or with
`preload: true`. A file that fails falls back to the next family of `ui.theme.font` unless it is `critical`.

## 4. Verify
- `npm run check`: prop model names and place names are validated. After `npm run map`, GAMEMAP.md has a props table.
- Loading: `engine.loading.list({ phase: 'failed' })` should be empty; related test `npm test -- 加载可观察`.
- `describe().content.props` is the number of prop entries; when the player is near, named objects appear in `nearby`
  (`npm run shot -- / --pos x,z --describe-only`).
- Collision: `engine.collision.walkable({ x, z })` should be false at a prop's position.
- Baking: `npm run bake` prints each item's size; related test `npm test -- 烘焙`. To look at the picture: `npm run shot -- / --pos x,z`.

## 5. Deleting objects
`engine.remove(obj)` deletes an object and frees its GPU memory; `engine.detach(obj)` only takes it off for a while (add it back with `engine.add`).
Don't call `obj.removeFromParent()` or `scene.remove()` on meshes you built: their geometry and materials would leak.
(`thing.remove` (`40-scene.md`) deletes a registered object so that an undo can bring it back; `engine.remove` is final.)
