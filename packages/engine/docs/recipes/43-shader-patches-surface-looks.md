# Writing shader patches and surface looks

**In this recipe**: Your own material · Material roles are open · Patch a slot · Shortcut: spec keys that wire the functions

Lead with three.js: **write your own material or `ShaderMaterial`**, or **patch a slot** of any material with your own GLSL. The look is the
game's own; this page gives building blocks, not looks.

```js
const mat = new THREE.ShaderMaterial({ uniforms: { ...engine.uniforms }, vertexShader, fragmentShader });                    // 1. your own shader
applyEffects(mat2, { patches: [{ name: 'tint', slot: 'color', glsl: 'diffuseColor.rgb *= 0.9;' }] });                         // 2. patch a slot
fragmentShader: '#include <threedog_lighting>
...'                                                                      // 3. call engine GLSL inside 1 or 2
```

**1. Your own material or shader** works exactly as in three.js (`new THREE.MeshStandardMaterial`, `ShaderMaterial`, `onBeforeCompile`), as a
material role too (below). **2. Patch a slot**: a named piece of GLSL at a named place (`color`, `normal`, `lighting`, `output`...) on any material,
built-in or yours. **3. Engine GLSL functions** (`#include <threedog_wind>`, `<threedog_detail>`, `<threedog_lighting>`...) are tools you call inside 1 and 2:
a noise, a wrapped diffuse term, a fresnel edge. None of them is a look. A look is what your game's own shader or style combines: its colors,
textures, light model and post. The default surface is flat (`lambert` plus vertex colors) until you write one. A few spec keys wire one function
into a built-in material as a shortcut (last section); reach for them only when they already say what you want.

## Your own material
A `materials` entry that is a Material instance (cloned per use, its patches kept) or a function returning one; `style.lighting` still shapes plain three.js
lit materials returned by it. Nothing else is applied: textures, `detail` and `lighting` keys are only read on specs, so call `applyEffects(material,
{ detail, patches })` yourself when you want those tools. Outside a role, `new THREE.*Material` anywhere is fine (THREE.md).

## Material roles are open
`style.materials` maps a role name to a material. The engine asks for `default terrain vegetation character water pickup prop`; **any other
name is fine** (`cloth`, `metal`, `glass`): code asks for it with `engine.makeMaterial('cloth', { color })`, an unlisted role uses `materials.default`.
Only a name very close to an existing one (`props`, `charcter`) warns, as a probable typo.

```js
materials: {
  default: { type: 'lambert' },
  cloth:   { type: 'standard', roughness: 1, color: 0x8a6f5a },
  glass:   { type: 'physical', transmission: 1, roughness: 0.05, thickness: 0.2 },
  rock:    { type: 'standard', map: 'rock.png', normalMap: 'rock_n.png', roughnessMap: 'rock_r.png', repeat: 4 },
  prop:    (params, purpose, engine) => new THREE.MeshMatcapMaterial({ matcap: texture, color: params.color }),   // any Material
}
```
A **function** gets `(params, purpose, engine)`: the call's `params` (color, vertexColors...), the role asked for, and the engine; it returns any
three.js Material. A **spec** is plain data (`type: lambert | phong | standard | physical | toon | basic` plus material properties), layered over
`materials.default` when that is a spec too; keys the material has are set, spec keys below are handled by the engine.

## Patch a slot: your own GLSL
`detail.glsl` (the `detail` spec key, last section) replaces the noise: `vec4 threedogDetailSample(vec2 p)` returns `vec4(color, height 0-1)`; `p` is already scaled, turned, stretched;
`uniforms: { uCells: 6 }` (numbers, colors, arrays, textures) are in scope; `threedogDetailFootprint` is one pixel in pattern units (`fade` uses it; read it to fade your own sample). `lighting.glsl` replaces the three light effects:
`void threedogLighting(inout ReflectedLight light, vec3 normal, vec3 viewDir, vec3 sunDir, float sunShadow, vec3 albedo)` (view space; `sunShadow` 1 lit,
0 shadowed; change `light.directDiffuse` / `indirectDiffuse`, the lights are already summed).

For anything else write a **named patch** that names a **slot** (where the code goes) and add it with `applyEffects(material, { patches: [...] })`
(or in a `materials` function, or `look.materials.patch(name, patch, { roles })`):
```js
{ name: 'tint', slot: 'color', glsl: 'diffuseColor.rgb *= 0.9;' }                                   // one slot
{ name: 'sway', slot: 'position', shadow: true, glsl: 'transformed.x += sin(position.y) * 0.1;' }  // moves vertices: the shadow follows
{ name: 'glow', pars: 'uniform float uGlow;', uniforms: { uGlow: { value: 0.5 } },
  glsl: { color: 'diffuseColor.rgb *= 0.95;', output: 'outgoingLight += uGlow * 0.1;' } }          // several slots; pars = declarations
```
The full form, with every field:
```js
{ name: 'fuzz',                          // one name per effect; the same name again replaces it
  slot: 'color',                         // where the code goes (table below)
  glsl: 'diffuseColor.rgb *= 1.0 - uFuzz * 0.5;',
  pars: 'uniform float uFuzz;',          // declarations at the top of every stage the patch touches (or { vertex, fragment })
  cacheKey: 'v1',                        // changes whenever the GLSL text changes, never for uniform values
  uniforms: { uFuzz: { value: 0.3 } },   // numbers live here, so materials with different values share a program
  needs: { patches: ['world'], data: ['vertexColors'] },   // 'world' gives `varying vec3 vThreedogWorld`; data = program inputs you read
  conflicts: ['wind'],                   // patches it cannot share a material with (checked when added)
  shadow: false }                        // true = the patch MOVES vertices, so its vertex code also runs in the shadow passes (wind does)
```
Slots (the one table is `render/slots.js`; the engine's own wind, clouds, season, detail, lighting and cascades use the same names, and the WebGPU
path will map the same names to node properties, so a patch written today keeps its meaning). An unknown slot throws with this list.

<!-- slots:begin (generated from render/slots.js slotTable(); threedog check R42 compares) -->
| slot | GLSL (WebGL, today) | WebGPU node (phase 2) | in scope | meaning |
|---|---|---|---|---|
| `position` | after `begin_vertex` | `positionNode` | transformed (vec3, object space, write), position, normal, uv | move vertices in object space, before skinning / instancing / the model matrix |
| `shadowPosition` | after `begin_vertex` (shadow passes) | `castShadowPositionNode` | transformed (vec3, object space, write), position | vertex code for the shadow passes only (depth / point-light distance), replacing this patch's position code there |
| `clipPosition` | after `project_vertex` | `vertexNode` | transformed, mvPosition (view space), gl_Position (clip space, write) | after projection: snap or offset on screen, or write world-space varyings |
| `map` | after `map_fragment` | `colorNode (before vertex colors)` | diffuseColor (vec4, write; the map applied, vertex colors not yet) | the base color / texture, before vertex colors and every color patch |
| `color` | after `color_fragment` | `colorNode` | diffuseColor (vec4, write; map and vertex colors already applied), vUv when the material has a map | the surface (diffuse) color before lighting |
| `normal` | after `normal_fragment_maps` | `normalNode` | normal (vec3, view space, write), faceDirection, vViewPosition | the shading normal (bump, detail) after normal / bump maps |
| `roughness` | after `roughnessmap_fragment` | `roughnessNode` | roughnessFactor (float, write); MeshStandard / MeshPhysical only | roughness after the roughness map |
| `emissive` | after `emissivemap_fragment` | `emissiveNode` | totalEmissiveRadiance (vec3, write), diffuseColor | emitted light after the emissive map |
| `lightsPars` | after `shadowmap_pars_fragment` | `(TSL Fn)` | declarations; three's light structs, getShadow() and directionalLights[] are already declared | functions that call three's light / shadow helpers (pars goes before them) |
| `lightingModel` | replace `lights_fragment_begin` | `LightingModel (setupLightingModel)` | geometryPosition, geometryNormal, material, reflectedLight; your code replaces three's light loop | replace how lights are summed (one patch per material may take it) |
| `lighting` | after `lights_fragment_end` | `lightsNode (wrapped)` | reflectedLight.directDiffuse / directSpecular / indirectDiffuse (write), normal, diffuseColor, vViewPosition | after lights are summed: cloud shadows, wrap, shadow tint, rim |
| `output` | before `opaque_fragment` | `outputNode` | outgoingLight (vec3, write), diffuseColor.a | the final lit color, before fog and tone mapping |
| `fogPars` | after `fog_pars_fragment` | `fogNode (TSL Fn)` | declarations; fogColor and fogNear / fogFar or fogDensity are already declared (inside #ifdef USE_FOG) | fog functions that read three's fog uniforms (wrap them in #ifdef USE_FOG) |
| `fog` | replace `fog_fragment` | `fogNode` | gl_FragColor (write, tone mapped already), fogColor, vFogDepth, fogNear / fogFar or fogDensity (inside #ifdef USE_FOG) | replace how fog mixes into the final color (one patch per material may take it) |
<!-- slots:end -->

Several patches in one slot run in the order added. A compile error names the patch and slot:
`[threedog] shader error in patch 'fuzz' (slot color), fragment shader: ERROR: 0:812: 'uFuz' : undeclared identifier | ...`.

**Shader hot reload (dev).** Keep GLSL in its own file and import it as text: `import fuzz from './fuzz.glsl?raw'` (also `.vert`, `.frag`, `.vs`,
`.fs`), then use it as a patch's `glsl` or a `ShaderMaterial`'s `fragmentShader` / `vertexShader`. Under `npm run dev` the vite preset serves the file
inside `// threedog:begin file=<path>` markers; saving it recompiles every material holding its text (`engine.debug.reloadGlsl`; a patch gets a new
cacheKey so the old program is not reused) without reloading the page, and a compile error names the file line:
`shader error in file shaders/fuzz.glsl:4, patch 'fuzz' (slot color)`. Text copied into your own `onBeforeCompile` closure cannot be found: the page
reloads instead. Builds get the plain text. Plain Vite equivalent: `import.meta.hot.accept('./fuzz.glsl?raw', m => { mat.fragmentShader = m.default; mat.needsUpdate = true; })`.
`MeshBasicMaterial` has no lights, so no `normal` / `lighting` slots; `lambert` has no `roughness`. A slot the material lacks throws when the patch is added.
`vThreedogWorld` is the world position (instancing and batching included); it comes from the engine's `world` patch. A patch whose GLSL reads
`vThreedogWorld` gets `world` added in front of it even without `needs` (a one-time dev note asks for the `needs: { patches: ['world'] }` line, which
says the same thing in the patch itself). Meshes with several patches stack them in one program per distinct combination.

The `normal` slot also fixes a three.js rule that surprises card and grass art: with `side: THREE.DoubleSide` three flips the normal of every back
face (`faceDirection`), so a blade or card whose normals all point up shades dark from the side you see its back. Keep the authored normal by
writing it back in the `normal` slot, e.g. `normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);` (up in view space) or
`normal *= faceDirection;` (undo the flip).

Patches on one material must agree. Each patch declares what it relies on, and a bad combination throws when it is added (or logs once at compile):

| Field | Meaning | Checked |
|---|---|---|
| `needs.data` | Program inputs the code reads: `'instancing'`, `'instancingColor'`, `'vertexColors'`, `'skinning'`, `'batching'` | when the program compiles (console.error once per material) |
| `needs.patches` | Patches it builds on, e.g. `['world']` for the `vThreedogWorld` varying (world position; the engine adds `world` itself when a patch needs it or its code reads `vThreedogWorld`) | when added |
| `conflicts` | Patch names it cannot share a material with | when added, both ways |
| `uniforms` | A uniform name belongs to one patch; share `engine.uniforms` (`uTime`, `uWind`, `uCloud`...) instead of making your own `uTime` | when added |
| `shadow` | Render steps: without it the color pass only; `true` also runs its vertex code in the depth (sun / spot shadows) and distance (point-light shadows) passes | - |
| `cacheKey` | Changes whenever the GLSL text changes (defines, branches), never for uniform values; the program key joins every patch's `name=cacheKey` in order | same name + cacheKey with different code throws |
```js
applyEffects(mat, { wind: 0.03, season: 'foliage', patches: [{ name: 'ripple', needs: { patches: ['world'] }, conflicts: ['wind'],
  slot: 'color', glsl: 'diffuseColor.rgb *= 0.9 + 0.1 * sin(vThreedogWorld.x);' }] });   // throws: 'wind' and 'ripple' cannot be combined
```

**Exit: raw three.js anchors** (WebGL only, plain three.js knowledge). Where no slot fits, `glsl: { vertex|fragment: { <chunk>: code } }` puts
code after `#include <chunk>` (a value may be `{ before, after, replace }`; the key `pars` is declarations at the top of that stage). A missing chunk
throws when the patch is added, not as a silent no-op. Chunk names in three **0.187** (read from `three/src/renderers/shaders`), in main-body order:

| stage | chunk | what is in scope after it |
|---|---|---|
| vertex | `begin_vertex` | `transformed` (object space; wind moves it here) |
| vertex | `project_vertex` | `mvPosition`, `gl_Position` |
| vertex | `worldpos_vertex` | `worldPosition` (only when shadows, env maps or transmission need it) |
| fragment | `map_fragment` `color_fragment` | `diffuseColor` (rgb after the map, then the vertex colors) |
| fragment | `roughnessmap_fragment` `metalnessmap_fragment` | `roughnessFactor`, `metalnessFactor` (standard / physical) |
| fragment | `normal_fragment_begin` `normal_fragment_maps` | `normal` (view space), `faceDirection`; `vViewPosition` = minus the view-space position |
| fragment | `emissivemap_fragment` | `totalEmissiveRadiance` |
| fragment | `lights_fragment_begin` ... `lights_fragment_end` | `reflectedLight.directDiffuse / indirectDiffuse / directSpecular / indirectSpecular`; after `_end` they are final |
| fragment | `opaque_fragment` | `outgoingLight` and `gl_FragColor`; (called `output_fragment` before r154) |

### Engine effects in your own ShaderMaterial
```js
const mat = new THREE.ShaderMaterial({ uniforms: { ...engine.uniforms, uMine: { value: 1 } }, vertexShader, fragmentShader });
```
The engine never patches a ShaderMaterial of yours; call its effects as functions instead (the automatic patches call the same ones):
`fragmentShader: '#include <threedog_detail>\nvoid main(){ gl_FragColor = vec4(threedogDetailNoise(vW.xz, 1, 2.0).rgb, 1.0); }'`

| include | function |
|---|---|
| `#include <threedog_uniforms>` | declares every engine uniform: `uTime`, `uWind`, `uWindFreq`, `uWindAmp`, `uCloud`, `uCloudShadow`, `uCloudScale`, `uCloudSpeed`, `uFoliageTint`, `uGroundTint`, `uFoliageMix`, `uGroundMix` (include once, in each stage that uses them) |
| `#include <threedog_wind>` | `vec3 threedogWind(vec3 position, vec3 origin, float amplitude)`: object-space sway offset, higher vertices sway more; `origin` is the object's world origin (its phase) |
| `#include <threedog_cloudShadow>` | `float threedogCloudShadow(vec3 worldPos)`: light factor 0-1 under the drifting clouds |
| `#include <threedog_season>` | `vec3 threedogSeason(vec3 color, int kind)`: season tint, kind 0 foliage, 1 ground |
| `#include <threedog_detail>` | `vec4 threedogDetailNoise(vec2 p, int kind, float octaves)`: the detail noises, kind 0 grain, 1 paper, 2 stroke, 3 dabs, returns (gray rgb, height 0-1); `vec3 threedogDetailBump(vec3 surfPos, vec3 surfNorm, float h, float k, float faceDir)`: screen-space bump. No uniforms. `p` is yours: world xz for a pattern fixed to the ground (it shrinks with distance), `gl_FragCoord.xy / 3.0` for one the same size all over the screen (3-pixel cells; device pixels, so it follows the pixel ratio) |
| `#include <threedog_lighting>` | `vec3 threedogWrapDiffuse(float nl, float wrap, vec3 lightColor, float shadow, vec3 albedo)` (light to add), `vec3 threedogShadowTint(vec3 ambient, vec3 tint, float strength, float soft, float nl, float shadow)` (the new ambient), `vec3 threedogRim(vec3 normal, vec3 viewDir, vec3 color, float strength, float power, float shadowSide, float nl)` (light to add); nl = dot(normal, sunDir), shadow 1 lit / 0 shadowed. No uniforms |

```glsl
#include <threedog_uniforms>
#include <threedog_wind>
void main() { vec3 p = position + threedogWind(position, (modelMatrix * vec4(0, 0, 0, 1)).xyz, 0.05); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }
```
The `detail` and `lighting` patches on built-in materials call these same functions, so a value tuned in `look.surface` reads the same in your shader.

Combining tools into a look is per game: write it in the game's style or its own material code.
Check a pack with `threedog style check`; the pixel and program-count guarantees are in `tests/specs/surface.mjs`.

## Shortcut: spec keys that wire the functions (`detail`, `lighting`, `ramp`)
Each key below puts one of the functions above into a built-in material, with its numbers as uniforms. They are building blocks with
fixed shapes (four noise kinds, one tint model, a band ramp), not finished looks: combine them with your own colors, textures and patches,
and when a key does not give what you want, write the shader yourself (sections above) and call the same function there.

The accepted spec keys, texture slots, `repeat` / `wrap` and who wins between pack and call: recipe 48. How texture names load: the engine
fetches the asset with `engine.assets.texture` (`map`, `emissiveMap` sRGB, the other slots linear), sets anisotropy, wrap and repeat, and a neutral
stand-in (flat normal, white) sits in the slot until the image arrives. `style check` verifies the names against the asset pack. This page
covers the keys that add shader code: `detail`, `lighting`, toon `ramp`, seasons.

**`detail`**: a noise pattern, a texture or your own GLSL laid over the surface in world space (needs no UVs). Off unless written; every number is a uniform, so
100 materials with different `scale` / `strength` / `direction` compile **one** program (tested: 8 variants, +0 programs).

| key | meaning |
|---|---|
| `noise` | `'grain'` (default) `'paper'` `'stroke'` `'dabs'` (soft oval dabs, no direction); or `texture: 'name'` (asset name or a Texture), or `glsl` (below) |
| `projection` | `'world'` top-down (default, fine for ground), `'triplanar'` (walls, rocks, characters) or `'screen'`: on the screen pixels, so the grain is the same size near and far (illustration, print, painted looks); world and triplanar grain shrinks with distance and `fade` takes it out |
| `scale` `strength` | repeats per meter (0.25; with `'screen'` pixels per pattern cell, 2), color effect 0-1 (0.35) |
| `mode` `tint` | `'multiply'` (default) `'add'` `'mix'`; tint colors the sample |
| `direction` `stretch` | degrees; stretch along it (strokes default 6): a brush stroke is `{ noise: 'stroke', direction: 20 }` |
| `octaves` | 1-4 noise layers (2) |
| `normal` | relief height in meters (bumps the normal; 0 = off) |
| `roughness` | amount the sample moves roughness (`standard` / `physical`) |
| `fade` | default `true`: the effect fades out where its pattern is smaller than a pixel (far, grazing), so it does not shimmer; `false` keeps it |

Which channels (color, normal, roughness) are on is fixed when the material is made (it is part of the program); the numbers can change any time.
The ground takes the same object as `style.terrain.detail` / `look.ground.set({ detail })`; which detail suits which ground: recipe 53.

**`lighting`** shapes the light after it is summed. three has no "shadow color": a shadow only removes the sun's light. The patch reads the first
directional light (the sun; three sorts shadow casters first) and its shadow value for the pixel:

| key | effect |
|---|---|
| `shadowTint: { color, strength, soft }` | shadowed or sun-averted parts shift hue towards `color`, same brightness. `soft` = terminator width |
| `rim: { color, strength, power, shadowSide }` | fresnel edge light added to the ambient part; `shadowSide: 1` = only away from the sun (a cool back light) |
| `wrap` | half-lambert: `(n.l + wrap) / (1 + wrap)` from the sun |

Limits: one directional light; point and spot lights are untouched; cloud shadows do not count as shadow for `shadowTint`; `wrap` does not follow a toon
ramp. Put it on every lit material of the pack with `style.lighting` (same keys; a material's own `lighting` wins, `lighting: false` opts out).
**Toon** takes `ramp: [0.3, 0.65, 1]` (grays = light strength per band) or colors (a cool band in the shade), `soften: 0..1` melts the bands; `steps` still works.

**Seasons**: `style.seasons: { mode: 'mix', strength: 0.5, autumn: { foliage: 0xd98a3a } }`. `multiply` (default) multiplies the color on, which turns
orange-on-green muddy; `mix` moves the surface `strength` of the way to the color.

To change these from code at run time (`materials`, `surface`, `ground`, `wind` look parts), see recipe 52.
