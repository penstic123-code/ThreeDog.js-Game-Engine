# Changing the art / writing a style pack

A style pack is a plain object passed in as `createEngine({ style })`. Everything about how the engine and its modules look and sound is read from it (which key is read by whom is in the "style pack keys" table of `../CODEMAP.md`).
Every entry can be omitted; omitted entries fall back to neutral gray (the city example passes no style pack at all). The field list is in `../api/style.md`.

## 1. Creating a new style pack
Copy `styles/lowpoly/` to `styles/toon/`, edit the values in `index.js`, then switch to it in the game:
```js
import toon from 'threedog/styles/toon';
const engine = createEngine({ canvas, style: toon });
```
Keys you will change most often:
| Key | What it controls |
|---|---|
| `materials` | The material per role. Three forms: a spec `{ default: { type: 'toon', steps: 3 }, water: { type: 'phong', shininess: 90 } }` (lambert / phong / standard / physical / toon / basic; a wrong type throws), any three.js material instance `water: new THREE.MeshMatcapMaterial({ matcap })` (cloned per use), or a function `prop: (params, role) => new THREE.ShaderMaterial({...})`. Style packs may create materials directly; games still go through `makeMaterial` |
| `antialias` | `false` for sharp pixel edges; omitted = on for desktop, off for phones (players can switch it in settings) |
| `post` | List of post effects, see 2c (lowpoly: `[outline(), ao(), bloom()]`; `outline({ enabled: true })` for a cartoon look) |
| `sky` `weather` `water` `terrain` `seasons` `clouds` | Sky keyframes, rain and snow, water, terrain colors (`terrain.config.shading: 'flat'` for facets, engine default smooth; `terrain.material` swaps the whole ground material, chunks have `uv` = world xz / chunk size; `water.material: (engine, { uniforms, waves, normalMap }) => Material` swaps the whole water surface, e.g. `applyEffects(new THREE.MeshToonMaterial({ color }), { clouds: false, patches: [waves] })` keeps the built-in waves), seasonal tints |
| `character` | Default character colors `colors`; `create(engine, colors)` builds the procedural character (lowpoly: `styles/lowpoly/shapes.js`; without it a gray capsule) |
| `pickup` `particles` `triggers` | Items on the ground (`pickup.model(item, { color, size })` returns an Object3D or geometry; without it a plain box), particle presets (dust smoke leaves splash sparks...), trigger zone wireframes |
| `sounds` `ambience` `music` | Sound effect files (synthesized if omitted), ambience, background music tracks |
| `ui` | UI colors, fonts `fontFaces`, extra `css`, `templates` that replace a whole UI piece |
| `models` | Procedural models: name -> generator function (vegetation and props refer to them by name) |

Lights: every engine has `engine.lights = { sun, hemi }` (neutral without sky; the sky module drives the same two). For your own lighting hide or retune them and add three.js lights.

## 2. Using your own models instead of procedural ones
Two ways:
```js
// a) replace the generator function in the style pack's models (returns a geometry or Object3D); content keeps using the same name
models: { ...models, pine: () => myPineGeometry() },
// b) a glTF file: register it in the game's manifest, and props use the asset name directly (content looks in style.models first, then in assets)
engine.assets.manifest({ models: { well: '/models/well.glb' } });
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
import lowpoly, { bloom, outline } from 'threedog/styles/lowpoly';
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
Hard rule 1: a module only writes a neutral gray fallback and reads `engine.style.xxx ?? fallback`, **and the real value is added to `styles/lowpoly/index.js` at the same time** (with a one-line comment saying what it means),
and the new field gets a doc comment in `types/style.d.ts` (`docs/api/` is generated from there). Materials always go through `makeMaterial('role', { color })`, leaving the surface feel to `style.materials[role]`.

## 4. Verify
- `npm run check`: the hard-rule check reports "material created directly" (in engine modules, games and examples; style packs are allowed) and "non-gray fallback color"; the type check catches misspelled keys in the style pack.
- `npm run map`: the "style pack keys" table in CODEMAP is updated.
- Take screenshots only when the look changed, and compare two times of day: `npm run shot -- / --time 12:00`, `npm run shot -- / --time 18:30` (images go to .threedog/shots/).
- It must still run without a style pack: `npm test -- 小城`.

## 5. Sounds and music
Sound files are named in the style pack like models; play effects with `engine.audio` and background tracks with `engine.music` (installed with `music()`), so a style swap changes the sound too. Ambient loops by place and weather come from `engine.ambience`.
