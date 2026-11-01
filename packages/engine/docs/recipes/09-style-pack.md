# Changing the art / writing a style pack

**The engine ships no art.** No default style, character model, terrain look or terrain generator: with no style pack and no model everything is a
plain neutral placeholder (a gray capsule for characters, a gray box for props and pickups, flat gray ground at y = 0, one white hemisphere light plus
one neutral directional light without shadows or tone mapping), and the console says once in dev what is missing and how to fix it.

A style pack is a plain object passed in as `createEngine({ style })`. It holds **looks only**: colors, the default pickup shape,
materials and shaders, sky and lighting, post effects, UI look. Not part of it: model / texture / sound files and procedural models content names (an
**asset pack**, `engine.assets.manifest`, recipe 05 "Asset packs"), sounds (section 5), gameplay data and timing (a **content pack**, recipe 20;
`sky({ hoursPerDay })`). Which key is read by whom is in the "style pack keys" table of `../CODEMAP.md`; the field list is in `../api/style.md`. Every
entry can be omitted; omitted entries are the neutral placeholders above (the city example passes no style pack at all). Write it as a plain object literal, no `@type` or `as const`: fields with a fixed set of words (`shading`, `mode`, `type` …) accept any string in the types, and a wrong word is reported by `threedog style check` with the fix.

## 0. Using a style pack
A style pack is a plain object (or a package that exports one): yours in `style/index.js`, a folder you copy, or a published package. Any art direction fits:
realistic, toon, pixel, painterly, flat, noir. The engine ships none; `threedog new-style` starts an empty one (section 1).
```js
import { createEngine, presets, openWorld } from 'threedog';
import yourPack from './style/index.js';                                   // or: import yourPack from 'a-published-pack'
import { terrainPreset, terrainStrings } from '@threedog/terrain-noise';   // the world shape is not a look: its own package
const engine = createEngine({ canvas, style: yourPack, strings: terrainStrings });   // terrainStrings: names of the preset's ground types
engine.use(openWorld({ camera: 'follow', seed: 7, terrain: terrainPreset() }));   // noise terrain (hills, rivers, biomes) that your pack colors, see recipes/28
```
A pack may also export an asset pack (procedural models: `engine.assets.manifest(assets)`). Post effects such as `bloom` / `ao` / `outline` come from
`@threedog/post-effects` (style packs never import each other; R34 checks). The terrain generator `terrainPreset` / `riverAt` / `BIOMES` /
`terrainStrings` is a separate package, `@threedog/terrain-noise`: the shape of the world is gameplay, so a style pack keeps only the colors of its
ground types (`terrain.colors`, `biomeColors`).

## 0b. Composing a style from parts
`style` may be a list of parts, deep-merged left to right into `engine.style`, so one pack's materials, another pack's sky and the game's own colors
mix without copying whole packs:
```js
import basePack from './style/index.js';
const dusk = { sky: { sunSize: 600, keyframes: myDuskKeyframes } };            // only these two sky fields change
const engine = createEngine({ canvas, style: [basePack, dusk, { ui: { accent: '#7fd3ff' }, post: null }] });
```
Rules (`core/styleParts.js`): plain `{ }` objects merge key by key at every depth; everything else replaces whole (arrays such as `sky.keyframes` and
`post`, functions, three.js objects); a key set to `null` removes it; `undefined` is ignored; nested lists flatten, so a pack can itself be a list of
parts; parts are never mutated. One object (not a list) is used as it is.

**Post effects by name.** `post` is a list, so `{ post: [myGrain] }` replaces everything before it. To add to or trim the list use the two helpers
(exported by `threedog`); they are parts too:
```js
import { createEngine, postAdd, postRemove } from 'threedog';
import basePack from './style/index.js';
import { bloom } from '@threedog/post-effects';
createEngine({ canvas, style: [basePack, postAdd(myGrain, bloom({ strength: 0.6 })), postRemove('ao')] });
```
`postAdd(...effects)` appends; an effect whose `name` is already in the list (`'bloom'`, `'ao'`, `'outline'`) replaces that one in place.
`postRemove(...names)` drops effects by name. `{ post: null }` still clears the list; `{ post: [...] }` still replaces it whole.

**Retinting the procedural models.** `style.palette` holds the colors the trees, rocks, grass and flowers are built from (the keys are the pack's own, e.g. `bark`, `leaf`, `rock`,
`grassTip`...; see `basePack.palette`). One part changes them all:
`style: [basePack, { palette: { leaf: 0xd98a3a } }]` (autumn); keys left out keep the pack's colors. A generator of your own written
with `function` (not an arrow) reads `this.palette`; the palette is part of the model cache key, so a changed palette rebuilds. `.glb` files and
models baked earlier keep their colors.

## 0c. What a style may not hold
Swapping the style must never change the map or the rules, only how they look. So these are **not** style fields, and a dev run throws an error
naming where each goes:
- water level, whether there is a sea, the water mesh size: `style.water.level / sea / size` -> `engine.use(water({ level, sea, size }))`
- terrain shape and size (seed, chunk size, resolution, water level, height functions): `style.terrain.config.*` -> `terrain({ ... })`. The looks
  in `terrain.config` are `shading` (`'smooth'` | `'texture'` | `'flat'`), `colorResolution`, `normals` and `normalFn` (recipe 37); at run time
  `engine.look.ground.set({ shading, colors, variation, detail })` (recipe 52)
Quality settings are not world state and may stay in a style (shadow `mapSize` and `low` overrides, water `segments`); players can override them in
settings. Packs under `packages/styles/**` are also checked by `threedog check` (R34).

## 1. Creating a new style pack
Run `threedog new-style` (or copy any pack folder into your game or a package of your own), edit the values in `index.js`, then switch to it in the game:
```js
import toon from './style/index.js';
const engine = createEngine({ canvas, style: toon });
```
**A material role is a free label inside the style, not a fixed list.** `makeMaterial('anything', { color })` is always legal: a role the style does not
name falls back to `materials.default`, and a new role (`'lantern'`, `'roof'`) becomes real the moment the style adds `materials.lantern`. The engine
warns only when a name looks like a typo of a known role (`'buidling'`).

Keys you will change most often:
| Key | What it controls |
|---|---|
| `materials` | The material per role. Three forms: a spec `{ default: { type: 'toon', steps: 3 }, water: { type: 'phong', shininess: 90 } }` (lambert / phong / standard / physical / toon / basic; a wrong type throws), any three.js material instance `water: new THREE.MeshMatcapMaterial({ matcap })` (cloned per use), or a function `prop: (params, role) => new THREE.ShaderMaterial({...})`. Style packs may create materials directly; games still go through `makeMaterial` |
| `antialias` | `false` for sharp pixel edges; omitted = on for desktop, off for phones (players can switch it in settings) |
| `post` | List of post effects (e.g. `[outline(), ao(), bloom()]`; `outline({ enabled: true })` draws edge lines); slots, the effects package, `fuse`, outline modes: [recipe 52](52-look.md#post-effect-chain) |
| `sky` `weather` `water` `terrain` `seasons` `clouds` | Sky keyframes (sun color and intensity over the day, fog color, shadows), rain and snow, water, terrain colors (`terrain.colors` palette, `terrain.biomeColors` ground type -> palette names, `terrain.steep` slope colors; a type with no color is gray; `terrain.config`: `shading` `'smooth'` (engine default) | `'texture'` (per-chunk color map) | `'flat'` (facets), `colorResolution`, `normals`, `normalFn`, recipe 37; `terrain.detail` a detail layer, recipe 53; `terrain.material` swaps the whole ground material, chunks have `uv` = world xz / chunk size; `water.material: (engine, { uniforms, waves, normalMap }) => Material` swaps the whole water surface, e.g. `applyEffects(new THREE.MeshToonMaterial({ color }), { clouds: false, patches: [waves] })` keeps the built-in waves), seasonal tints |
| `character` | `animation.fade`: skeletal animation transition seconds. Bodies are assets, not style: `createPlayer({ model })` with a registered model, a GLB asset name or `{ rig }`; part colors are material roles or `{ colors }` per character (recipe 13). Without a model a gray capsule |
| `pickup` `particles` | Items on the ground (`pickup.model(item, { color, size })` returns an Object3D or geometry; without it a plain gray box), particle presets (dust smoke leaves splash sparks...) |
| `triggers` `grid` | Tool colors, not art: trigger zone wireframe (`debugColor`), grid placement preview (`ok` / `bad`). The engine has neutral defaults (gray; light = can place, dark = cannot); a pack may recolor them |
| `ui` | UI colors, `font` (a CSS font-family list), `fonts` (font asset names to load at start, the files in an asset pack: recipes/05 §3b), extra `css`, `templates` that replace a whole UI piece |

## 1b. Lights and stalls
Every engine has `engine.lights = { sun, hemi }`, plain three.js lights. Without a style pack they are a neutral placeholder (white
hemisphere + neutral directional light, no shadows); the look (sun color and intensity curves, sky colors, fog, shadow softness, exposure, tone
mapping) comes from the style pack's `sky`, `exposure` and `toneMapping`, and the sky module drives the same two lights. At run time:
`engine.look.lights.set(...)` (recipe 52); to light the world yourself: recipe 38.

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
camera. Options and handle: `../api/lightPool.md`.

## 2. Using your own models instead of procedural ones
Models are assets, not style keys: content names them, an asset pack maps the names to files or generators. Register a later manifest with the same
name to swap one:
```js
engine.assets.manifest(yourAssets);   // assets from an asset pack you have: trees, rocks, flowers... built in code
engine.assets.manifest({ name: 'mine', models: { pine: () => myPineGeometry(), well: '/models/well.glb' } });   // replaces pine, adds well
```
Vegetation takes a geometry (`geometry: await engine.assets.geometry('pine')`, the first mesh in the model) or a whole model with one material per
mesh, e.g. bark trunk + alpha-cut leaf cards:
`engine.vegetation.add('oak', { model: await engine.assets.model('oak'), wind: 0.02 })` (still one draw call per part; felling hides every part). For
the import workflow see `10-blender-level.md`.
`mergeColored(parts, { flat: false })` keeps smooth normals; UVs survive when every part has them.
A generator in `models` may also return an Object3D with its own materials; those are used as they are.

## 2b. Wind, cloud shadows and season tint on your own materials
The engine's shader effects are named patches that work on any material that has the usual three.js chunks (WebGL only):
```js
import { applyEffects } from 'threedog';
const leaves = applyEffects(new THREE.MeshToonMaterial({ color: 0x5a8a3a }), { wind: 0.03, season: 'foliage' });   // clouds default on
engine.vegetation.add('bush', { geometry, material: leaves });   // vegetation adds them itself; effects: false keeps the material untouched
```
The shadow sways with the wind automatically. Your own effect (pixel snapping, dissolve...) is a patch too, and stacks with the built-in ones and with
the material's own `onBeforeCompile`:
`applyEffects(mat, { patches:
[{ name: 'snap', cacheKey: 64, uniforms, glsl: { vertex: { pars: '...', project_vertex: '...code after #include <project_vertex>' } } }] })`.
A missing `#include` anchor throws. A hand-written `ShaderMaterial` can `#include <threedog_wind_vertex>`, `<threedog_clouds_pars_fragment>` etc. (see
`render/effects.js`) with `engine.uniforms` as its uniforms.
`material.clone()` does not carry patches (three's `Material.copy` skips `onBeforeCompile`): a pack's Material instance in `materials` is fine
(`makeMaterial` keeps its patches); when you clone one yourself, apply the effects to the clone again.
What a patch declares (`needs`, `conflicts`, `shadow`, `cacheKey`) and the chunk names: recipe 43, exit 2. Textures by asset name, `detail`,
shadow tint, rim light and toon ramps are material spec keys: recipe 48 (keys), recipe 43 (what they do).

## 3. When the engine gets a new "look parameter"
Hard rule 1: a module only writes a neutral gray fallback and reads `engine.style.xxx ?? fallback`, **and the real value is added to a style pack
(its `index.js`) at the same time** (with a one-line comment saying what it means),
and the new field gets a doc comment in `types/style.d.ts` (`docs/api/` is generated from there). Materials always go through
`makeMaterial('role', { color })`, leaving the surface feel to `style.materials[role]`. Whose style: `engine.makeMaterial('role', { color })` uses that
engine's pack; the free `makeMaterial()` uses the first engine created (fine for one engine, a dev warning when two packs run). Engine code and style packs always
go through the engine (`pickup.model(item, { color, size }, engine)`, `water.material(engine, ...)`), so two engines never share materials.
Look parameters only: a field that changes the world (a level, a size, a seed) goes to the module's options, not the style (section 0c).

## 4. Verify
- `npm run check`: the hard-rule check reports "material created directly" (in engine modules, games and examples; style packs are allowed) and
  "non-gray fallback color"; the type check catches misspelled keys in the style pack.
- `npm run map`: the "style pack keys" table in CODEMAP is updated.
- Take screenshots only when the look changed, and compare two times of day: `npm run shot -- / --time 12:00`, `npm run shot -- / --time 18:30`
  (images go to .threedog/shots/).
- It must still run without a style pack: start once with `createEngine({ canvas })` and no `style` (gray placeholders, one console note per missing piece).

## 5. Sounds and music (the game's, not the style pack's)
Sounds are game config, passed to `createEngine({ audio: { sounds, ambience, music, footsteps, levels } })` and read back as `engine.audio.config`; a
style pack carries none. The engine plays nothing the game did not name. Buses, sounds by name, the ambience rule table, music rules, footsteps and
ducking: `recipes/31-audio.md`.
