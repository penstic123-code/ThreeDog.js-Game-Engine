# Changing the art / writing a style pack

**The engine ships no art.** No default style, character model, terrain look or terrain generator: with no style pack and no model everything is a plain neutral placeholder (a gray capsule for characters, a gray box for props and pickups, flat gray ground at y = 0, one white hemisphere light plus one neutral directional light without shadows or tone mapping), and the console says once in dev what is missing and how to fix it.

A style pack is a plain object passed in as `createEngine({ style })`. It holds **looks only**: colors, the default character / pickup shapes, materials and shaders, sky and lighting, post effects, UI look. Not part of it: model / texture / sound files and procedural models content names (an **asset pack**, `engine.assets.manifest`, recipe 05 "Asset packs"), sounds (section 5), gameplay data and timing (a **content pack**, recipe 20; `sky({ hoursPerDay })`). Which key is read by whom is in the "style pack keys" table of `../CODEMAP.md`; the field list is in `../api/style.md`. Every entry can be omitted; omitted entries are the neutral placeholders above (the city example passes no style pack at all).

## 0. Installing the lowpoly style pack
The low-poly look is an optional package, `@threedog/style-lowpoly` (source in the monorepo: `packages/styles/lowpoly/`):
```sh
npm install @threedog/style-lowpoly
```
```js
import { createEngine, presets, openWorld } from 'threedog';
import lowpoly from '@threedog/style-lowpoly';
import { terrainPreset, terrainStrings } from '@threedog/terrain-noise';         // the world shape is not a look: its own package
const engine = createEngine({ canvas, style: lowpoly, strings: terrainStrings });   // terrainStrings: names of the preset's ground types
engine.use(openWorld({ camera: 'follow', seed: 7, terrain: terrainPreset() }));   // noise terrain (hills, rivers, biomes) that lowpoly colors, see recipes/28
```
Besides the style object it exports `assets` (an asset pack of procedural trees, rocks, grass, flowers: `engine.assets.manifest(assets)`; the same generators as a plain map are `models`) and the post effects `bloom` `outline` `ao`. The terrain generator `terrainPreset` / `riverAt` / `BIOMES` / `terrainStrings` is a separate package, `@threedog/terrain-noise`: the shape of the world is gameplay, so a style pack keeps only the colors of its ground types (`terrain.colors`, `biomeColors`).

## 0b. Composing a style from parts
`style` may be a list of parts, deep-merged left to right into `engine.style`, so one pack's materials, another pack's sky and the game's own colors mix without copying whole packs:
```js
import lowpoly from '@threedog/style-lowpoly';
const dusk = { sky: { sunSize: 600, keyframes: myDuskKeyframes } };            // only these two sky fields change
const engine = createEngine({ canvas, style: [lowpoly, dusk, { ui: { accent: '#7fd3ff' }, post: null }] });
```
Rules (`core/styleParts.js`): plain `{ }` objects merge key by key at every depth; everything else replaces whole (arrays such as `sky.keyframes` and `post`, functions, three.js objects); a key set to `null` removes it; `undefined` is ignored; nested lists flatten, so a pack can itself be a list of parts; parts are never mutated. One object (not a list) is used as it is.

## 1. Creating a new style pack
Copy `packages/styles/lowpoly/` to your game (or a new package `@threedog/style-toon`), edit the values in `index.js`, then switch to it in the game:
```js
import toon from './style/index.js';
const engine = createEngine({ canvas, style: toon });
```
Keys you will change most often:
| Key | What it controls |
|---|---|
| `materials` | The material per role. Three forms: a spec `{ default: { type: 'toon', steps: 3 }, water: { type: 'phong', shininess: 90 } }` (lambert / phong / standard / physical / toon / basic; a wrong type throws), any three.js material instance `water: new THREE.MeshMatcapMaterial({ matcap })` (cloned per use), or a function `prop: (params, role) => new THREE.ShaderMaterial({...})`. Style packs may create materials directly; games still go through `makeMaterial` |
| `antialias` | `false` for sharp pixel edges; omitted = on for desktop, off for phones (players can switch it in settings) |
| `post` | List of post effects, see 2c (lowpoly: `[outline(), ao(), bloom()]`; `outline({ enabled: true })` for a cartoon look) |
| `sky` `weather` `water` `terrain` `seasons` `clouds` | Sky keyframes (sun color and intensity over the day, fog color, shadows), rain and snow, water, terrain colors (`terrain.colors` palette, `terrain.biomeColors` ground type -> palette names, `terrain.steep` slope colors; a type with no color is gray; `terrain.config.shading: 'flat'` for facets, engine default smooth; `terrain.material` swaps the whole ground material, chunks have `uv` = world xz / chunk size; `water.material: (engine, { uniforms, waves, normalMap }) => Material` swaps the whole water surface, e.g. `applyEffects(new THREE.MeshToonMaterial({ color }), { clouds: false, patches: [waves] })` keeps the built-in waves), seasonal tints |
| `character` | Default character colors `colors`; `create(engine, colors)` builds the procedural character (lowpoly: its `shapes.js`; without it a gray capsule); `model` a registered model every character uses |
| `pickup` `particles` | Items on the ground (`pickup.model(item, { color, size })` returns an Object3D or geometry; without it a plain gray box), particle presets (dust smoke leaves splash sparks...) |
| `triggers` `grid` | Tool colors, not art: trigger zone wireframe (`debugColor`), grid placement preview (`ok` / `bad`). The engine has neutral defaults (gray; light = can place, dark = cannot); a pack may recolor them |
| `ui` | UI colors, `font` (a CSS font-family list), `fonts` (font asset names to load at start, the files in an asset pack: recipes/05 §3b), extra `css`, `templates` that replace a whole UI piece |

Lights: every engine has `engine.lights = { sun, hemi }`, plain three.js lights. Without a style pack they are a neutral placeholder (white hemisphere + neutral directional light, no shadows); the look (sun color and intensity curves, sky colors, fog, shadow softness, exposure, tone mapping) comes from the style pack's `sky`, `exposure` and `toneMapping`, and the sky module drives the same two lights. For your own lighting hide or retune them and add three.js lights.

**Lights and stalls.** three.js builds one shader program per material for each light setup. `engine.start()` compiles everything visible behind the loading screen (`engine.startup.compileMs`), but adding or removing a light later, or toggling `visible` on one, changes the setup and compiles again: a frame can freeze for hundreds of milliseconds. Keep the number of lights fixed: create them up front and fade with `intensity` (0 = off, no recompile). In dev the console warns (code `light-recompile`) when programs were compiled in a frame where the lights changed.

For many torches, street lamps, campfires, muzzle flashes or neon signs use the light pool: a fixed number of real lights, created once at install, moves to the sources that matter most (near the camera, bright, high `priority`) and fades with intensity, so the light setup never changes. Install it before `engine.start()` so the startup compile covers its lights:
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
`engine.lightPool.usage()` (and `describe().lightPool`) lists which source each real light holds; `focus` measures from the player instead of the camera. Options and handle: `../api/lightPool.md`.

## 2. Using your own models instead of procedural ones
Models are assets, not style keys: content names them, an asset pack maps the names to files or generators. Register a later manifest with the same name to swap one:
```js
engine.assets.manifest(lowpolyAssets);   // import { assets as lowpolyAssets } from '@threedog/style-lowpoly': pine, rock, flower... built in code
engine.assets.manifest({ name: 'mine', models: { pine: () => myPineGeometry(), well: '/models/well.glb' } });   // replaces pine, adds well
```
Vegetation takes a geometry (`geometry: await engine.assets.geometry('pine')`, the first mesh in the model) or a whole model with one material per mesh, e.g. bark trunk + alpha-cut leaf cards:
`engine.vegetation.add('oak', { model: await engine.assets.model('oak'), wind: 0.02 })` (still one draw call per part; felling hides every part). For the import workflow see `10-blender-level.md`.
`mergeColored(parts, { flat: false })` keeps smooth normals; UVs survive when every part has them.
A generator in `models` may also return an Object3D with its own materials; those are used as they are.

## 2b. Wind, cloud shadows and season tint on your own materials
The engine's shader effects are named patches that work on any material that has the usual three.js chunks (WebGL only):
```js
import { applyEffects } from 'threedog';
const leaves = applyEffects(new THREE.MeshToonMaterial({ color: 0x5a8a3a }), { wind: 0.03, season: 'foliage' });   // clouds default on
engine.vegetation.add('bush', { geometry, material: leaves });   // vegetation adds them itself; effects: false keeps the material untouched
```
The shadow sways with the wind automatically. Your own effect (pixel snapping, dissolve...) is a patch too, and stacks with the built-in ones and with the material's own `onBeforeCompile`:
`applyEffects(mat, { patches: [{ name: 'snap', cacheKey: 64, uniforms, glsl: { vertex: { pars: '...', project_vertex: '...code after #include <project_vertex>' } } }] })`.
A missing `#include` anchor throws. A hand-written `ShaderMaterial` can `#include <threedog_wind_vertex>`, `<threedog_clouds_pars_fragment>` etc. (see `render/effects.js`) with `engine.uniforms` as its uniforms.
`material.clone()` does not carry patches (three's `Material.copy` skips `onBeforeCompile`): a pack's Material instance in `materials` is fine (`makeMaterial` keeps its patches); when you clone one yourself, apply the effects to the clone again.

Patches on one material must agree. Each patch declares what it relies on, and a bad combination throws when it is added (or logs once at compile):
| Field | Meaning | Checked |
|---|---|---|
| `needs.data` | Program inputs the code reads: `'instancing'`, `'instancingColor'`, `'vertexColors'`, `'skinning'`, `'batching'` | when the program compiles (console.error once per material) |
| `needs.patches` | Patches it builds on, e.g. `['world']` for the `vThreedogWorld` varying (world position; `applyEffects` adds `world` itself when a patch needs it) | when added |
| `conflicts` | Patch names it cannot share a material with | when added, both ways |
| `uniforms` | A uniform name belongs to one patch; share `engine.uniforms` (`uTime`, `uWind`, `uCloud`...) instead of making your own `uTime` | when added |
| `shadow` | Render steps: without it the color pass only; `true` also runs its vertex code in the depth (sun / spot shadows) and distance (point-light shadows) passes | - |
| `cacheKey` | Changes whenever the GLSL text changes (defines, branches), never for uniform values; the program key joins every patch's `name=cacheKey` in order | same name + cacheKey with different code throws |
```js
applyEffects(mat, { wind: 0.03, season: 'foliage', patches: [{ name: 'ripple', needs: { patches: ['world'] }, conflicts: ['wind'],
  glsl: { fragment: { color_fragment: 'diffuseColor.rgb *= 0.9 + 0.1 * sin(vThreedogWorld.x);' } } }] });   // throws: 'wind' and 'ripple' cannot be combined
```

## 2c. Post effects (slots)
Post-processing is an ordered list of named effects. Each runs in a slot, then by `order` (low first):
`scene` (replaces the scene render, one at a time, e.g. pixelation) -> `hdr` (linear color: outline, AO, bloom) -> tone mapping -> `ldr` (sRGB: LUT, palette, grain, vignette) -> `final` (FXAA / SMAA).
An effect is `{ name, slot, order, params, create(ctx) => pass, update?(pass, params) }`; under WebGL the pass is any three.js postprocessing Pass. It is built the first time it is on.
```js
import lowpoly, { bloom, outline } from '@threedog/style-lowpoly';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
const toon = { ...lowpoly, post: [outline({ enabled: true, thickness: 1.5 }), bloom({ strength: 0.2 }),
  { name: 'lut', slot: 'ldr', params: { lut: myLut }, create: ({ params }) => new LUTPass({ lut: params.lut }) }] };
// at runtime (settings, photo mode, a game's own effect):
engine.post.get('bloom')?.set({ strength: 0.6 });
engine.post.enable('outline', false);          // also engine.post.enable('antialias', false)
const h = engine.post.add(myVignette, { slot: 'ldr', order: 10 }); h.remove();
```
An effect that reads scene depth (`needsDepth: true`, e.g. `outline`) must run before any pass that swaps buffers (a `ShaderPass`, a scene-slot `RenderPixelatedPass`, the tone-mapping output): only the buffer the scene render wrote holds scene depth. A chain that breaks this throws when the effect is added or enabled, naming both effects; give the depth reader a lower `order`.
`createEngine({ post: { bloom: false } })` overrides an effect's startup on/off; `costly: true` effects start off on low-tier devices. MSAA (`antialias`) works with every effect on.
The settings menu shows `bloom` / `ao` toggles only when the style pack registers effects with those names.

## 3. When the engine gets a new "look parameter"
Hard rule 1: a module only writes a neutral gray fallback and reads `engine.style.xxx ?? fallback`, **and the real value is added to the lowpoly pack (its `index.js`) at the same time** (with a one-line comment saying what it means),
and the new field gets a doc comment in `types/style.d.ts` (`docs/api/` is generated from there). Materials always go through `makeMaterial('role', { color })`, leaving the surface feel to `style.materials[role]`.

## 4. Verify
- `npm run check`: the hard-rule check reports "material created directly" (in engine modules, games and examples; style packs are allowed) and "non-gray fallback color"; the type check catches misspelled keys in the style pack.
- `npm run map`: the "style pack keys" table in CODEMAP is updated.
- Take screenshots only when the look changed, and compare two times of day: `npm run shot -- / --time 12:00`, `npm run shot -- / --time 18:30` (images go to .threedog/shots/).
- It must still run without a style pack: `npm test -- 小城`.

## 5. Sounds and music (the game's, not the style pack's)
Sounds are game config, passed to `createEngine({ audio: { sounds, ambience, music, footsteps, levels } })` and read back as `engine.audio.config`; a style pack carries none. The engine plays nothing the game did not name. Buses, sounds by name, the ambience rule table, music rules, footsteps and ducking: `recipes/31-audio.md`.
