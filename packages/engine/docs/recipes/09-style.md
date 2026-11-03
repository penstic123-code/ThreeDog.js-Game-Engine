# The game's style folder: changing the art

**In this recipe**: 0. Using a style · 0b. Composing a style from parts · 0c. What a style may not hold · 0d. Look plugins in a style folder · 1. Creating a new style ·
1b. Lights and stalls · 2. Using your own models instead of procedural ones · 2b. Wind, cloud shadows and season tint on your own… ·
3. When the engine gets a new "look parameter" · 4. Verify · 5. Sounds and music

**The engine ships no art.** No default style, character model, terrain look or terrain generator: with no style and no model everything is a
plain neutral placeholder (a gray capsule for characters, a gray box for props and pickups, flat gray ground at y = 0, one white hemisphere light plus
one neutral directional light without shadows or tone mapping), and the console says once in dev what is missing and how to fix it.

A game's style is a plain object its `style/` folder exports, passed in as `createEngine({ style })`. It holds **looks only**: colors,
materials and shaders, sky and lighting, post effects, UI look. Not part of it: model / texture / sound files and procedural models content names (an
**asset pack**, `engine.assets.manifest`, recipe 05 "Asset packs"), sounds (section 5), gameplay data and timing (a **content pack**, recipe 20;
`calendar({ hoursPerDay })`). Which key is read by whom is in the "style keys" table of `../CODEMAP.md`; the field list is in `../api/style.md`. Every
entry can be omitted; omitted entries are the neutral placeholders above (the city example passes no style at all). Write it as a plain object literal, no `@type` or `as const`: fields with a fixed set of words (`shading`, `mode`, `type` …) accept any string in the types, and a wrong word is reported by `threedog style check` with the fix.

## 0. Using a style
A game keeps its style in its `style/` folder (`style/index.js`; a new game starts with an empty one). Any art
direction fits: realistic, toon, pixel, painterly, flat, noir. The engine ships none (section 1).
```js
import { createEngine, presets, openWorld } from 'threedog';
import style from './style/index.js';                                      // the game's own look
import { terrainPreset, terrainStrings } from '@threedog/terrain-noise';   // the world shape is not a look: its own package
const engine = createEngine({ canvas, style, strings: terrainStrings });   // terrainStrings: names of the preset's ground types
engine.use(openWorld({ camera: 'follow', seed: 7, terrain: terrainPreset() }));   // noise terrain (hills, rivers, biomes) that your pack colors, see recipes/28
```
Procedural models are an asset pack, not part of the style (`engine.assets.manifest(assets)`; the world example keeps its in `examples/world/art/`). Post effects such as `bloom` / `ao` / `outline` come from
`@threedog/post-effects`. The terrain generator `terrainPreset` / `riverAt` / `BIOMES` /
`terrainStrings` is a separate package, `@threedog/terrain-noise`: the shape of the world is gameplay, so a style keeps only the colors of its
ground types (`terrain.colors`, `biomeColors`).

## 0b. Composing a style from parts
`style` may be a list of parts, deep-merged left to right into `engine.style`, so one pack's materials, another pack's sky and the game's own colors
mix without copying whole packs:
```js
import base from './style/index.js';
const dusk = { sky: { sunSize: 600, keyframes: myDuskKeyframes } };            // only these two sky fields change
const engine = createEngine({ canvas, style: [base, dusk, { ui: { accent: '#7fd3ff' }, post: null }] });
```
Rules (`core/styleParts.js`): plain `{ }` objects merge key by key at every depth; everything else replaces whole (arrays such as `sky.keyframes` and
`post`, functions, three.js objects); a key set to `null` removes it; `undefined` is ignored; nested lists flatten, so a pack can itself be a list of
parts; parts are never mutated. One object (not a list) is used as it is.
The merged style is the **style layer** of every look value (recipe 52 "How look values stack"): later parts win there and two parts never
conflict; a game's `look.<part>.set(...)` sits on top of it, and the weather and the sunset multiply whichever decides. A style starts the fog
distance (`sky.fog.far`) and the shadow filter (`sky.shadow.type`); there are no `createEngine` options for them.

**Post effects are plugins.** A style brings each post effect as a file in its `style/plugins/` folder (`10-bloom.js: export default bloom()`,
listed with `plugins: import.meta.glob('./plugins/*.js', { eager: true })`), the same file a game's `plugins/` folder takes: both go through
`engine.look.post.add`, the one way into the chain (recipe 52). Each part's plugins stay grouped under the part's name, so one pack's effect is
switched off with `engine.plugins.off('<pack>/<file>')` or `look.post.set({ bloom: false })`, and `plugins: null` drops the earlier parts' plugins.
There is no `style.post` list (it was a second way in, with its own on / off rules).

**Retinting the procedural models.** `style.palette` holds the colors the trees, rocks, grass and flowers are built from (the keys are the pack's own, e.g. `bark`, `leaf`, `rock`,
`grassTip`...; see `base.palette`). One part changes them all:
`style: [base, { palette: { leaf: 0xd98a3a } }]` (autumn); keys left out keep the base colors. A generator of your own written
with `function` (not an arrow) reads `this.palette`; the palette is part of the model cache key, so a changed palette rebuilds. `.glb` files and
models baked earlier keep their colors.

## 0c. What a style may not hold
Swapping the style must never change the map or the rules, only how they look. So these are **not** style fields, and a dev run throws an error
naming where each goes:
- water level, whether there is a sea, the water mesh size: `style.water.level / sea / size` -> `engine.use(water({ level, sea, size }))`.
  The other way round, a look value is never a module option: water color, waves, normal map (`style.water.*`), sky keyframes, sun, moon, stars
  (`style.sky.*`) and terrain `normals` (`style.terrain.config.normals`) are set in the style, and at run time with `engine.look.water` /
  `look.sky` / `look.ground` `.set(...)`; `water({ color })`, `sky({ moonSize })`, `terrain({ normals })` throw naming that call
- terrain shape and size (seed, chunk size, resolution, water level, height functions): `style.terrain.config.*` -> `terrain({ ... })`. The looks
  in `terrain.config` are `shading` (`'smooth'` | `'texture'` | `'flat'`), `colorResolution`, `normals` and `normalFn` (recipe 37); at run time
  `engine.look.ground.set({ shading, colors, variation, detail })` (recipe 52)
Quality settings are not world state and may stay in a style (shadow `mapSize` and `low` overrides, water `segments`); players can override them in
settings. A game's `style/` folder is also checked by `threedog check` (R34).

## 0d. Look plugins in a style folder
One folder = one style: starting values, the material per role, and optional look plugins. A plugin is a file exporting the same shapes as the
game's `plugins/` folder (recipe 40 §1): a three.js `Pass`, a `Material` (its `name` is the role), a material patch `{ slot, glsl, roles }` (plugged with `look.materials.add`),
an `Object3D`, or a look module (a sky or vegetation look with `replaces`). The style lists them in `plugins`, and the engine plugs them through
`engine.plugins`, the same loader as the game's folder, so a plugin file works alone in `plugins/` or inside any number of style folders unchanged:
```js
// style/index.js            style/plugins/10-paper.js: export default new ShaderPass(PaperShader)
export default {            // style/plugins/20-stone.js: export default Object.assign(new THREE.MeshToonMaterial({ color: 0x777777 }), { name: 'stone' })
  name: 'ink', exposure: 1.1, materials: { wood: { type: 'lambert', color: 0x8a5a36 } },
  plugins: import.meta.glob('./plugins/*.js', { eager: true }),   // without Vite: { paper: { default: paperPass } }
};
```
They sit **under** the game: a style plugin's material and patch are on the style layer of `engine.look.materials`, so the game's
`look.materials.set / replace` and the game's own plugins win. Names are `<style>/<file>` (`ink/10-paper`); `engine.plugins.off('ink')` takes
all of the style's plugins out, `off('ink/10-paper')` one; `describe().slots` lists them with `style ink: plugins/...`. `off('ink')` turns off
the pack's **plugins only**: its starting values (`exposure`, `fog`, the `materials` table and the other fields of `style/index.js`) are the
style itself and stay; the `off()` result and the off rows of `describe().slots` say so. To drop those too, start with another style.
Each plugin is its own owner (`style:ink/10-paper`), the pack only groups them: switching one off takes out only what that file wrote, and
the others keep theirs. Two plugins that write the same key on the same layer (two Materials named `stone`) are a `shared-conflict` naming
both files in development; to let one win on purpose, say so in that file: `export const replaces = '10-stone';` (the other is unplugged
while this one is on, and comes back when it goes off; `plugins.list()` shows `replacedBy`). In a list of parts each
part's plugins stay under that part's name, and `{ plugins: null }` drops the earlier parts'. The personal library (`threedog lib`) stores a
plugin once; `lib pull` puts its code in `plugins/<name>/` with the wiring file `plugins/<name>.js`, and copying both into a style folder's `plugins/` is all it takes to bundle it.

## 1. Creating a new style
Edit your game's `style/index.js` (`threedog new-game` makes it empty, every key commented out; fill one section at a time). To try a second look,
copy the folder (`style-toon/`) and point `createEngine` at it; `threedog style check style-toon` (a folder path; with no argument it checks the game's `style/`) finds mistakes before you look at pixels:
```js
import toon from './style-toon/index.js';
const engine = createEngine({ canvas, style: toon });
```
**A material role is a free label inside the style, not a fixed list.** `makeMaterial('anything', { color })` is always legal: a role the style does not
name falls back to `materials.default`, and a new role (`'lantern'`, `'roof'`) becomes real the moment the style adds `materials.lantern`. The engine
warns only when a name looks like a typo of a known role (`'buidling'`).

Keys you will change most often:
| Key | What it controls |
|---|---|
| `materials` | The material per role. Three forms: a spec `{ default: { type: 'toon', steps: 3 }, water: { type: 'phong', shininess: 90 } }` (lambert / phong / standard / physical / toon / basic; a wrong type throws), any three.js material instance `water: new THREE.MeshMatcapMaterial({ matcap })` (cloned per use), or a function `prop: (params, role) => new THREE.ShaderMaterial({...})`. The table is the style layer of `engine.look.materials`, the one entry `makeMaterial(role)` reads: the game changes a role with `look.materials.set / replace` (recipe 52), never by editing `engine.style.materials` |
| `antialias` | `false` for sharp pixel edges; omitted = on for desktop, off for phones (players can switch it in settings) |
| `post` | List of post effects (e.g. `[outline(), ao(), bloom()]`; `outline({ enabled: true })` draws edge lines); slots, the effects package, `fuse`, outline modes: [recipe 52](52-look.md#post-effect-chain) |
| `sky` `weather` `water` `terrain` `seasons` `clouds` | Sky keyframes (sun color and intensity over the day, fog color, shadows), rain and snow, water, terrain colors (`terrain.colors` palette, `terrain.biomeColors` ground type -> palette names, `terrain.steep` slope colors; a type with no color is gray; `terrain.config`: `shading` `'smooth'` (engine default) | `'texture'` (per-chunk color map) | `'flat'` (facets), `colorResolution`, `normals`, `normalFn`, recipe 37; `terrain.detail` a detail layer, recipe 53; `terrain.material` swaps the whole ground material, chunks have `uv` = world xz / chunk size; `water.material: (engine, { uniforms, waves, normalMap }) => Material` swaps the whole water surface, e.g. `applyEffects(new THREE.MeshToonMaterial({ color }), { clouds: false, patches: [waves] })` keeps the built-in waves), seasonal tints |
| `character` | `animation.fade`: skeletal animation transition seconds. Bodies are assets, not style: `createPlayer({ model })` with a registered model, a GLB asset name or `{ rig }`; part colors are material roles or `{ colors }` per character (recipe 13). Without a model a gray capsule |
| `pickup` `particles` | Items on the ground: look values only (`color`, `size`, `lift`; the shape is an asset model name, recipe 03), particle presets (dust smoke leaves splash sparks...) |
| `triggers` `grid` | Tool colors, not art: trigger zone wireframe (`debugColor`), grid placement preview (`ok` / `bad`). The engine has neutral defaults (gray; light = can place, dark = cannot); a pack may recolor them |
| `ui` | UI colors, `font` (a CSS font-family list), `fonts` (font asset names to load at start, the files in an asset pack: recipes/05 §3b), extra `css`, `templates` that replace a whole UI piece |

## 1b. Lights and stalls
Every engine has `engine.lights = { sun, hemi }`, plain three.js lights. Without a style they are a neutral placeholder (white
hemisphere + neutral directional light, no shadows); the look (sun color and intensity curves, sky colors, fog, shadow softness, exposure, tone
mapping) comes from the style's `sky`, `exposure` and `toneMapping`, and the sky module drives the same two lights. At run time:
`engine.look.lights.set(...)` (recipe 52); to light the world yourself: recipe 38. `toneMapping` is read once, when the engine creates its
renderer; later the curve is plain three.js (`engine.renderer.toneMapping = ...`).

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
camera. Options and handle: `../api/lightPool.md`. Windows and signs that light up at night (many materials, no real light each):
`engine.look.materials.glow('window', { night: 2 })` (recipe 52 "Night glow").

Top-down or side-view games whose light should spread over the floor and stop at walls (soft shadows, any number or shape of emissive
lights) can copy the optional 2D radiance cascades example instead: `examples/rc2d/` (README there: when it fits, cost, limits). It is not a module.

## 2. Using your own models instead of procedural ones
Models are assets, not style keys: content names them, an asset pack maps the names to files or generators. Register a later manifest with the same
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
`material.clone()` does not carry patches (three's `Material.copy` skips `onBeforeCompile`): a pack's Material instance in `materials` is fine
(`makeMaterial` keeps its patches); when you clone one yourself, apply the effects to the clone again.
What a patch declares (`needs`, `conflicts`, `shadow`, `cacheKey`) and the chunk names: recipe 43, "Patch a slot". Textures by asset name are
material spec keys (recipe 48); the engine GLSL functions you can call in your own shader, and the spec keys that wire some of them in as a shortcut: recipe 43.

## 3. When the engine gets a new "look parameter"
Hard rule 1: a module only writes a neutral gray fallback and reads `engine.style.xxx ?? fallback`, **and the real value is added to a style
(its `index.js`) at the same time** (with a one-line comment saying what it means),
and the new field gets a doc comment in `types/style.d.ts` (`docs/api/` is generated from there). Materials always go through
`makeMaterial('role', { color })`, leaving the surface feel to the role in `engine.look.materials` (the style's `materials` table is its style layer). Whose style: `engine.makeMaterial('role', { color })` uses that
engine's pack; the free `makeMaterial()` uses the first engine created (fine for one engine, a dev warning when two packs run). Engine code and styles always
go through the engine (`water.material(engine, ...)`, a generator's `this.engine`), so two engines never share materials.
Look parameters only: a field that changes the world (a level, a size, a seed) goes to the module's options, not the style (section 0c).

## 4. Verify
- `npm run check`: R14 reports "creates a material directly" in engine code (games, examples and styles are plain three.js and not checked) and R39
  "non-gray fallback color"; the type check catches misspelled keys in the style.
- `npm run map`: the "style keys" table in CODEMAP is updated.
- Take screenshots only when the look changed, and compare two times of day: `npm run shot -- / --time 12:00`, `npm run shot -- / --time 18:30`
  (images go to .threedog/shots/).
- It must still run without a style: start once with `createEngine({ canvas })` and no `style` (gray placeholders, one console note per missing piece).

## 5. Sounds and music (the game's, not the style's)
Sounds are game config, passed to `createEngine({ audio: { sounds, ambience, music, footsteps, levels } })` and read back as `engine.audio.config`; a
style carries none. The engine plays nothing the game did not name. Buses, sounds by name, the ambience rule table, music rules, footsteps and
ducking: `recipes/31-audio.md`.
