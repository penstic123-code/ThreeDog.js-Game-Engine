# Materials, lights and models: the game's own picture

**In this recipe**: 0. Where the picture lives · 1. Materials are plain three.js · 1a. The engine's big pieces · 1b. Lights and stalls · 1c. The UI's picture ·
2. Using your own models instead of procedural ones · 2a. Reusing art · 2b. Wind, cloud shadows and season tint on your own materials ·
3. When the engine gets a new picture value · 4. Verify · 5. Sounds and music

```js
// picture/materials.js: the game's materials are its own three.js objects
const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.8 });
const crate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), wood);
engine.water.material.color.set(0x3070a0);          // a big engine piece hands out its material the same way
```

**The engine ships no art.** No default picture, character model, terrain drawing or terrain generator: until the game gives one, everything is a
plain neutral placeholder (a gray capsule for characters, a gray box for props and pickups, flat gray ground at y = 0, one white hemisphere light plus
one neutral directional light without shadows or tone mapping), and the console says once in dev what is missing and how to fix it.

## 0. Where the picture lives
The picture is code of the game: a `picture/` folder of plain three.js, and recipe 62 is its home. Any art direction fits: realistic, toon, pixel, painterly,
flat, noir. Not part of the picture: model / texture / sound files and procedural models content names (an **asset pack**, `engine.assets.manifest`, recipe 05
"Asset packs"), sounds (section 5), gameplay data and timing (a **content pack**, recipe 20; `calendar({ hoursPerDay })`).

Swapping the picture must never change the map or the rules, so a thing that changes the world (water level, terrain seed, a size) is a module option, and a
thing that only changes pixels is a write on the module's three.js material. The terrain generator `terrainPreset` / `riverAt` / `BIOMES` / `terrainStrings` is a
separate package, `@threedog/terrain-noise`, because the shape of the world is gameplay. Post effects such as `bloom` / `ao` / `outline` come from
`@threedog/post-effects` and go in as `plugins/` files (recipe 40 §1, chain order: recipe 52).

## 1. Materials are plain three.js
`new THREE.MeshStandardMaterial(...)`, `MeshToonMaterial`, `ShaderMaterial`, `onBeforeCompile`: all work as in any three.js project, and a plain material gets fog and
cascaded shadows by itself. Keep them in `picture/materials.js` by name, and let other code ask for `picture.materials.wall`, so a change of picture touches one folder.
```js
// Solid prop with vertex colors (merged model)
const prop = new THREE.MeshLambertMaterial({ vertexColors: true });

// See-through, double-sided
const banner = new THREE.MeshLambertMaterial({ color: 0xd04a3a, transparent: true, opacity: 0.8, side: THREE.DoubleSide });

// Glowing lamp
const lamp = new THREE.MeshStandardMaterial({ color: 0x6b5a40, emissive: 0xffc070, emissiveIntensity: 1.2 });

// Toon with an explicit light ramp: three.js's gradientMap; rampTexture takes grays, dark to light, and how far the bands melt (0-1). three's toon reads only
// the red channel, so a colored ramp needs celLighting on the WebGPU route (recipe 56); on WebGL a colored shade is a lighting patch (recipe 43)
import { rampTexture } from 'threedog';
const skin = new THREE.MeshToonMaterial({ color: 0xe8a0a0, gradientMap: rampTexture([0.25, 0.6, 1], 0.2) });
```
**Textures by asset name.** `engine.assets.texture(name)` returns a promise of a `THREE.Texture`; a data map (normal, roughness, ao) takes `{ color: false }`. The
`assets.useTexture` form fills a slot when the image arrives and warns once if it fails, so the material can be used at once. Tiling is three.js:
```js
const rock = new THREE.MeshStandardMaterial({ roughness: 0.9 });
engine.assets.useTexture('rock.png', t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4); rock.map = t; rock.needsUpdate = true; });
engine.assets.useTexture('rock_n.png', t => { rock.normalMap = t; rock.needsUpdate = true; }, { opts: { color: false } });
```
Changing what compiles into the program (`vertexColors`, `flatShading`, `transparent`, adding a map) after the first render needs `material.needsUpdate = true`, as in
three.js. `material.clone()` does not carry engine patches (three's `Material.copy` skips `onBeforeCompile`): apply the effects to the clone again.
Grain, your own GLSL and the engine's shader functions on these materials: section 2b and recipe 43.

## 1a. The engine's big pieces
Terrain, water, plants, rain and snow, pickups and grid layers keep their engineering in the engine and hand out their picture as plain three.js. The same four doors on each:

| Door | What it is | Example |
|---|---|---|
| `.material` | The three.js material it draws with; set it and it swaps on every mesh, drawn as given (nothing added behind your back) | `engine.terrain.material`, `engine.vegetation.material`, `engine.pickups.material`, `layer.material`, `engine.weather.particles.rain.material` |
| `.uniforms` | Plain `{ value }` objects for what the shader reads, written directly and live | `engine.water.uniforms.uWave.value = 1.5` |
| `.patches` | The engine's shader patches for that piece, so your own material keeps its behavior | `engine.water.material = applyEffects(new THREE.MeshPhongMaterial(), { patches: engine.water.patches })` |
| Module options and a plain method | Values baked when the module builds (terrain colors, normal map tiling) | `terrain({ colors })`, `engine.terrain.recolor({ colors })`, `engine.water.normalMap(name, { repeat })` |

Each piece's own recipe has its details: water and weather 44, terrain 37, plants 36, pickups 03, grids 29.

## 1b. Lights and stalls
The placeholder lights and your own: recipe 38. This section is what a changing light setup costs.

three.js builds one shader program per material for each light setup. `engine.start()` compiles everything visible behind the
loading screen (`engine.startup.compileMs`), but adding or removing a light later, or toggling `visible` on one, changes the setup and compiles again:
a frame can freeze for hundreds of milliseconds. Keep the number of lights fixed: create them up front and fade with `intensity` (0 = off, no
recompile). In dev the console warns (code `light-recompile`) when programs were compiled in a frame where the lights changed.

For many torches, street lamps, campfires, muzzle flashes or neon signs use the light pool: a fixed number of real lights, created once at install,
moves to the sources that matter most (near the camera, bright, high `priority`) and fades with intensity, so the light setup never changes. Install
it before `engine.start()` so the startup compile covers its lights:
```js
import { lightPool } from 'threedog';
engine.use(lightPool({ point: 8 }));          // 8 PointLights; lightPool({ spot: 2, shadows: 1 }) adds spots / lets one point light cast
for (const t of torches) engine.lightPool.add(t, {   // an Object3D is followed; a position stays put
  color: 0xffa040, intensity: 4, distance: 8,
  flicker: (time, i) => 0.85 + 0.15 * Math.sin(time * 13 + i),
  glow: t.getObjectByName('halo'),           // stand-in while it has no real light: its material's opacity / emissiveIntensity fades to 0 as the light fades in
});
const flash = engine.lightPool.add(gun.muzzle, { intensity: 0, priority: 5, distance: 6 });
flash.set({ intensity: 8 }); /* next frame */ flash.set({ intensity: 0 });   // muzzle flash: no light is created
```
`engine.lightPool.usage()` (and `describe().lightPool`) lists which source each real light holds; `focus` measures from the player instead of the
camera. Options and handle: `../api/lightPool.md`. Windows and signs that light up at night need no real light each: see below.

### Night glow: emissive that follows daylight
Lit windows, neon signs, lamp bulbs, glowing mushrooms, screens. `engine.uniforms.uNight` is 0 by day and 1 at night, on the curve `dusk` lamps fade on
(the calendar's daylight, else the sky's sun), so a window and the lamp outside it switch on together. One write per material per frame; the color stays the
material's `emissive`:
```js
// picture/glow.js
const windows = new THREE.MeshLambertMaterial({ color: 0x202020, emissive: 0xffcc66 });
const neon = new THREE.MeshStandardMaterial({ emissive: 0x33ccff });
engine.onFrame(() => {
  const night = engine.uniforms.uNight.value, day = engine.uniforms.uDaylight.value;
  windows.emissiveIntensity = 2 * night;
  neon.emissiveIntensity = 0.4 + 2.6 * (1 - THREE.MathUtils.smoothstep(day, 0, 0.6));   // its own dusk: faintly lit by day, on while the sky is still bright
});
```
Share one Material between the meshes that glow together. Models built later bring their own copies: collect them when the model is made
(`model.traverse(o => { if (o.material?.name === 'window') glowing.add(o.material); })`, a `Set` the frame loop walks), and take them out when it leaves. `uNight`
starts at daylight 0.3, roughly 17:00 to 18:00 and back in the morning: a starting value, not a rule. Judge it in shots at dusk.

**Headroom: why a glow turns into glare.** What reaches the tone curve is the emissive color times `emissiveIntensity`. A near-white color
(`#ffe6c0`) has no headroom: all three channels already sit near 1, so multiplied past 1 they clip to the same white under tone mapping, and
bloom spreads that white over what is around it (a lit sign becomes a white block with a smear). A saturated color at a lower intensity still
reads as light: its strongest channel carries the brightness, the others keep the hue, and bloom carries the halo. The numbers above are the
examples' current values, not targets. Judge the result with the picture check of `threedog shot` or `threedog snap` at night: it names each
glowing material and light that blows pixels out, with its current emissive and intensity and how much detail is lost under it, as a fact to
weigh against what the game wants (some games want a blinding sign).
For the light those windows throw on the street, add a few `lightPool` sources above; a pool source's `glow` stand-in is for one object near one light.

Top-down or side-view games whose light should spread over the floor and stop at walls (soft shadows, any number or shape of emissive
lights) can copy the optional 2D radiance cascades example instead: `examples/rc2d/` (README there: when it fits, cost, limits). It is not a module.

## 1c. The UI's picture
`createEngine({ ui: { theme, css, fonts, templates } })`: `theme` sets the colors and the `font` of the default parts (they are CSS variables), `css` adds your own
rules, `fonts` lists font asset names to load at start (the files sit in an asset pack: recipe 05 §3b), `templates` replace a whole UI piece. Parts and their keys: recipe 26.

## 2. Using your own models instead of procedural ones
Models are assets: content names them, an asset pack maps the names to files or generators. Register a later manifest with the same
name to swap one:
```js
engine.assets.manifest(yourAssets);   // assets from an asset pack you have: trees, rocks, flowers... built in code
engine.assets.manifest({ name: 'mine', models: { pine: () => myPineGeometry(), well: '/models/well.glb' } });   // replaces pine, adds well
```
Vegetation takes a geometry (`geometry: await engine.assets.geometry('pine')`, the first mesh in the model) or a whole model with one material per
mesh, e.g. bark trunk + alpha-cut leaf cards:
`engine.vegetation.define('oak', { model: await engine.assets.model('oak'), wind: 0.02 })` (still one draw call per part; felling hides every part). For
the import workflow see `10-blender-level.md`.
`mergeColored(parts, { flat: false })` keeps smooth normals; UVs survive when every part has them.
A generator in `models` may also return an Object3D with its own materials; those are used as they are.

### 2a. Reusing art from somewhere else: copy it in, do not depend on it
Art code you already have (generator modules such as `art/my-crate.js` from an earlier game, a folder of your own, files someone gave you, a package
you installed) is reused by **copying** it into this game. The copy is the game's own: edit it freely; nothing links back and nothing updates it.
```sh
threedog art list ../earlier-game                  # modules, exported functions with their first JSDoc line, asset files (uses its art/ folder)
threedog art copy ../earlier-game crate lamp       # by file or function name; none = every module
threedog art copy ../earlier-game crate --dry      # what would be written, nothing written
```
It copies the named modules, every local file they import and every texture / model file they name ('./wood.png', `new URL(...)`, '/models/x.glb'
from the source's `public/`), rewrites relative import paths to the new layout (outside-the-art-folder helpers land in `art/shared/`), keeps package
imports and lists them, and prints the `engine.assets.manifest` lines to register the generators. An existing file with different content stops the
whole copy (nothing written) unless `--force`. The engine ships no art library and names no source: which art to reuse is yours to choose.
GLB files from Blender are copied the same way and checked with recipe 46 section 3.

## 2b. Wind, cloud shadows and season tint on your own materials
The engine's shader effects are named patches that work on any material that has the usual three.js chunks (WebGL only):
```js
import { applyEffects } from 'threedog';
const leaves = applyEffects(new THREE.MeshToonMaterial({ color: 0x5a8a3a }), { wind: 0.03, season: 'foliage' });   // clouds default on
engine.vegetation.define('bush', { geometry, material: leaves });   // vegetation adds them itself; effects: false keeps the material untouched
```
The shadow sways with the wind automatically. Your own effect (pixel snapping, dissolve...) is a patch too, and stacks with the built-in ones and with
the material's own `onBeforeCompile`:
`applyEffects(mat, { patches:
[{ name: 'snap', cacheKey: 64, uniforms, glsl: { vertex: { pars: '...', project_vertex: '...code after #include <project_vertex>' } } }] })`.
A missing `#include` anchor throws. A hand-written `ShaderMaterial` can `#include <threedog_wind_vertex>`, `<threedog_clouds_pars_fragment>` etc. (see
`render/effects.js`) with `engine.uniforms` as its uniforms.
What a patch declares (`needs`, `conflicts`, `shadow`, `cacheKey`), the chunk names and the engine GLSL functions you can call in your own shader: recipe 43.

## 3. When the engine gets a new picture value
For engine developers. Hard rule 1: a module shows neutral gray until the game writes something. It makes its material with `neutralMaterial(what, params)` from
`render/neutral.js` and hands it out through the doors of section 1a. A shader-side value is a `{ value }` in `.uniforms`; a value baked at build time is a module option, with
one plain method when it can change at run time. There is no table of picture values to add to. A value that changes the world (a level, a size, a seed) is a module option only.

## 4. Verify
- `npm run check`: R14 reports "creates a material directly" in engine code (games and examples are plain three.js and not checked), R35 a reach into the old look
  table, R39 a "non-gray fallback color".
- Take screenshots only when the picture changed, and compare two times of day: `npm run shot -- / --time 12:00`, `npm run shot -- / --time 18:30`
  (images go to .threedog/shots/). Against a reference picture: `threedog picture compare` (recipe 60).
- It must still run with no picture code: start once with `createEngine({ canvas })` (gray placeholders, one console note per missing piece).

## 5. Sounds and music (the game's, not the picture's)
Sounds are game config, passed to `createEngine({ audio: { sounds, ambience, music, footsteps, levels } })` and read back as `engine.audio.config`. The engine plays
nothing the game did not name. Buses, sounds by name, the ambience rule table, music rules, footsteps and ducking: `recipes/31-audio.md`.
