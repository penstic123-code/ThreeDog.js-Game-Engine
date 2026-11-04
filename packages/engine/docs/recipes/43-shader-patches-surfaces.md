# Writing shader patches and surfaces

**In this recipe**: Your own material · Patch a slot · Engine GLSL functions · Ready-made effects

A new game draws on WebGPU, where shaders are TSL: start with [recipe 56](56-webgpu-tsl.md), whose node materials and `tsl:` patch fields do these same jobs. This page is the GLSL route, for a game made with `threedog new-game --webgl`: **write your own material or `ShaderMaterial`**, or **patch a slot** of any material with your own GLSL. The picture is the
game's own; this page gives building blocks, not finished pictures. There is one entry for shader code: `applyEffects`.

```js
const fragmentShader = '#include <threedog_lighting>\n' + myFragmentBody;                                       // 3. engine GLSL, called inside 1 or 2
const mat = new THREE.ShaderMaterial({ uniforms: { ...engine.uniforms }, vertexShader, fragmentShader });                    // 1. your own shader
applyEffects(mat2, { patches: [{ name: 'tint', slot: 'color', glsl: 'diffuseColor.rgb *= 0.9;' }] });                         // 2. patch a slot
```

**1. Your own material or shader** works exactly as in three.js (`new THREE.MeshStandardMaterial`, `ShaderMaterial`, `onBeforeCompile`).
**2. Patch a slot**: a named piece of GLSL at a named place (`color`, `normal`, `lighting`, `output`...) on any material,
built-in or yours. **3. Engine GLSL functions** (`#include <threedog_wind>`, `<threedog_detail>`, `<threedog_lighting>`...) are tools you call inside 1 and 2:
a noise, a wrapped diffuse term, a fresnel edge. None of them is a picture. A picture is what your game's `picture/` code combines: its colors,
textures, light model and post. The default surface is flat (`lambert` plus vertex colors) until you write one.

## Your own material
Any `new THREE.*Material` is fine (THREE.md), and the engine patches nothing of yours: call `applyEffects(material, { wind, clouds, season, detail, patches })` for the
tools you want. To put one on an engine piece, set its `.material` and pass the piece's `.patches` so it keeps what the piece does (recipe 09 §1a):
```js
engine.water.material = applyEffects(new THREE.MeshPhongMaterial({ color: 0x3070a0, shininess: 90 }), { patches: engine.water.patches });
```

## Patch a slot: your own GLSL
Write a **named patch** that names a **slot** (where the code goes) and add it with `applyEffects(material, { patches: [...] })`:
```js fragment
{ name: 'tint', slot: 'color', glsl: 'diffuseColor.rgb *= 0.9;' }                                   // one slot
{ name: 'sway', slot: 'position', shadow: true, glsl: 'transformed.x += sin(position.y) * 0.1;' }  // moves vertices: the shadow follows
{ name: 'glow', pars: 'uniform float uGlow;', uniforms: { uGlow: { value: 0.5 } },
  glsl: { color: 'diffuseColor.rgb *= 0.95;', output: 'outgoingLight += uGlow * 0.1;' } }          // several slots; pars = declarations
```
The full form, with every field:
```js fragment
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
Slots (the one table is `render/slots.js`; the engine's own wind, clouds, season, detail, lighting and cascades use the same names, and on WebGPU
the same names map to node properties through a patch's `tsl` field, recipe 56). An unknown slot throws with this list.

<!-- slots:begin (generated from render/slots.js slotTable(); threedog check R42 compares) -->
| slot | GLSL (WebGL) | WebGPU (NodeMaterial) | in scope | meaning |
|---|---|---|---|---|
| `position` | after `begin_vertex` | `positionNode` | transformed (vec3, object space, write), position, normal, uv | move vertices in object space, before skinning / instancing / the model matrix; WebGPU: the same place (the engine runs the chain before three's instancing; a game's own positionNode still applies after it) |
| `shadowPosition` | after `begin_vertex` (shadow passes) | `castShadowPositionNode` | transformed (vec3, object space, write), position | vertex code for the shadow passes only (depth / point-light distance), replacing this patch's position code there |
| `clipPosition` | after `project_vertex` | `vertexNode` | transformed, mvPosition (view space), gl_Position (clip space, write) | after projection: snap or offset on screen, or write world-space varyings |
| `map` | after `map_fragment` | `colorNode` | diffuseColor (vec4, write; the map applied, vertex colors not yet) | the base color / texture, before vertex colors and every color patch |
| `color` | after `color_fragment` | inside `setupDiffuseColor` | diffuseColor (vec4, write; map and vertex colors already applied), vUv when the material has a map | the surface (diffuse) color before lighting |
| `normal` | after `normal_fragment_maps` | inside `setupNormal` | normal (vec3, view space, write), faceDirection, vViewPosition | the shading normal (bump, detail) after normal / bump maps |
| `roughness` | after `roughnessmap_fragment` | `roughnessNode` | roughnessFactor (float, write); MeshStandard / MeshPhysical only | roughness after the roughness map |
| `emissive` | after `emissivemap_fragment` | `emissiveNode` | totalEmissiveRadiance (vec3, write), diffuseColor | emitted light after the emissive map |
| `lightsPars` | after `shadowmap_pars_fragment` | WebGL only | declarations; three's light structs, getShadow() and directionalLights[] are already declared | functions that call three's light / shadow helpers (pars goes before them); WebGPU: TSL has no declaration area: the light's direction and shadow come to the lighting slot's direct(light, ctx) hook |
| `lightingModel` | replace `lights_fragment_begin` | WebGL only | geometryPosition, geometryNormal, material, reflectedLight; your code replaces three's light loop | replace how lights are summed (one patch per material may take it); WebGPU: use the lighting slot's hooks { start, light, direct, after }, or a NodeMaterial with your own setupLightingModel |
| `lighting` | after `lights_fragment_end` | inside `setupLightingModel` | reflectedLight.directDiffuse / directSpecular / indirectDiffuse (write), normal, diffuseColor, vViewPosition | after lights are summed: cloud shadows, wrap, shadow tint, rim; WebGPU: hooks { start, light, direct, after }: light(light, ctx) returns a new color for one light before three lights the surface with it (what GLSL does by wrapping three's light info in lightsPars), direct(light, ctx) sees each light in three's loop and adds to its own sums, which join the summed light at the patch's place in the list, then its after() runs: the same order as WebGL |
| `output` | before `opaque_fragment` | inside `setupOutput` | outgoingLight (vec3, write), diffuseColor.a | the final lit color, before fog and tone mapping |
| `fogPars` | after `fog_pars_fragment` | WebGL only | declarations; fogColor and fogNear / fogFar or fogDensity are already declared (inside #ifdef USE_FOG) | fog functions that read three's fog uniforms (wrap them in #ifdef USE_FOG); WebGPU: fog on WebGPU is scene.fogNode, set by the game |
| `fog` | replace `fog_fragment` | WebGL only | gl_FragColor (write, tone mapped already), fogColor, vFogDepth, fogNear / fogFar or fogDensity (inside #ifdef USE_FOG) | replace how fog mixes into the final color (one patch per material may take it); WebGPU: fog on WebGPU is scene.fogNode, set by the game |
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
| `cacheKey` | Changes whenever the GLSL text changes (defines, branches), never for uniform values; the program key joins every patch's `name=cacheKey` in order | same name + cacheKey with different code throws. On WebGPU the program also follows the identity of each `tsl` function, so make it once and reuse it: one written fresh per material costs a program per material |
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
| `#include <threedog_uniforms>` | declares every engine uniform: `uTime`, `uWind`, `uWindFreq`, `uWindAmp`, `uCloud`, `uCloudShadow`, `uCloudScale`, `uCloudSpeed`, `uFoliageTint`, `uGroundTint`, `uFoliageMix`, `uGroundMix`, `uCover` (snow / ash cover amount alone: x foliage, y ground), `uSunDir`, `uSunColor`, `uDaylight`, `uTimeOfDay` (include once, in each stage that uses them) |
| `#include <threedog_wind>` | `vec3 threedogWind(vec3 position, vec3 origin, float amplitude)`: object-space sway offset, higher vertices sway more; `origin` is the object's world origin (its phase) |
| `#include <threedog_cloudShadow>` | `float threedogCloudShadow(vec3 worldPos)`: light factor 0-1 under the drifting clouds |
| `#include <threedog_season>` | `vec3 threedogSeason(vec3 color, int kind)`: season tint, kind 0 foliage, 1 ground |

To change the cloud shadow or the season tint on the engine's own materials (not only in your shader), replace the term: `engine.terms.cloudShadow({ glsl, tsl })` / `engine.terms.season(kind => ({ glsl, tsl }))`, or `false` to drop it (recipe 52).
| `#include <threedog_detail>` | `vec4 threedogDetailNoise(vec2 p, int kind, float octaves)`: the detail noises, kind 0 grain, 1 paper, 2 stroke, 3 dabs, returns (gray rgb, height 0-1); `vec3 threedogDetailBump(vec3 surfPos, vec3 surfNorm, float h, float k, float faceDir)`: screen-space bump. No uniforms. `p` is yours: world xz for a pattern fixed to the ground (it shrinks with distance), `gl_FragCoord.xy / 3.0` for one the same size all over the screen (3-pixel cells; device pixels, so it follows the pixel ratio) |
| `#include <threedog_lighting>` | `vec3 threedogWrapDiffuse(float nl, float wrap, vec3 lightColor, float shadow, vec3 albedo)` (light to add), `vec3 threedogShadowTint(vec3 ambient, vec3 tint, float strength, float soft, float nl, float shadow)` (the new ambient), `vec3 threedogRim(vec3 normal, vec3 viewDir, vec3 color, float strength, float power, float shadowSide, float nl)` (light to add); nl = dot(normal, sunDir), shadow 1 lit / 0 shadowed. No uniforms |

```glsl
#include <threedog_uniforms>
#include <threedog_wind>
void main() { vec3 p = position + threedogWind(position, (modelMatrix * vec4(0, 0, 0, 1)).xyz, 0.05); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }
```
The `detail` effect below calls these same functions, so a value tuned on a material reads the same in your shader. To give a material another cloud shadow or
season tint, leave the engine's out (`clouds: false`, no `season`) and write your own patch with these functions. Combining tools into a picture is per game: write it in its `picture/` code.
The pixel and program-count guarantees are in `tests/specs/surface.mjs`.

## Ready-made effects: `detail`, light shaping, seasons
Each one puts a function above on a built-in material, with its numbers as uniforms. They are building blocks with fixed shapes (four noise kinds, one tint model),
not finished pictures: combine them with your own colors, textures and patches, and when one does not give what you want, write the shader yourself and call the same function there.

**`detail`**: `applyEffects(material, { detail: { noise: 'paper', strength: 0.4 } })`. A noise pattern, a texture or your own GLSL laid over the surface in world space (needs no UVs). Every number is a uniform, so
100 materials with different `scale` / `strength` / `direction` compile **one** program on WebGL (tested: 8 variants, +0 programs).
WebGPURenderer keys its program by the patch's uniform objects instead: materials with the same `detail` options share one
patch object, so they share one program there too (tested: 8 materials, 1 build); different numbers build one each. Sharing
means one set of values: a uniform changed on one of them changes all that share those options.

| key | meaning |
|---|---|
| `noise` | `'grain'` (default) `'paper'` `'stroke'` `'dabs'` (soft oval dabs, no direction); or `texture: 'name'` (asset name or a Texture), or `glsl`: `vec4 threedogDetailSample(vec2 p)` returns `vec4(color, height 0-1)`; `p` is already scaled, turned, stretched, `uniforms: { uCells: 6 }` (numbers, colors, arrays, textures) are in scope, and `threedogDetailFootprint` is one pixel in pattern units (`fade` uses it; read it to fade your own sample) |
| `projection` | `'world'` top-down (default, fine for ground), `'triplanar'` (walls, rocks, characters) or `'screen'`: on the screen pixels, so the grain is the same size near and far (illustration, print, painted pictures); world and triplanar grain shrinks with distance and `fade` takes it out |
| `scale` `strength` | repeats per meter (0.25; with `'screen'` pixels per pattern cell, 2), color effect 0-1 (0.35) |
| `mode` `tint` | `'multiply'` (default) `'add'` `'mix'`; tint colors the sample |
| `direction` `stretch` | degrees; stretch along it (strokes default 6): a brush stroke is `{ noise: 'stroke', direction: 20 }` |
| `octaves` | 1-4 noise layers (2) |
| `normal` | relief height in meters (bumps the normal; 0 = off) |
| `roughness` | amount the sample moves roughness (`standard` / `physical`) |
| `fade` | default `true`: the effect fades out where its pattern is smaller than a pixel (far, grazing), so it does not shimmer; `false` keeps it |

Which channels (color, normal, roughness) are on is fixed when the material is made (it is part of the program); the numbers can change any time.
The ground takes the same object as `terrain({ detail })`, its live numbers are `engine.terrain.uniforms`; which detail suits which ground: recipe 53.

**Light shaping** is a patch in the `lighting` slot, after the lights are summed. three has no "shadow color": a shadow only removes the sun's light. The ready-made form:
```js
applyEffects(mat, { lighting: { wrap: 0.4, shadowTint: { color: 0x4060a0, strength: 0.6, soft: 0.3 }, rim: { color: 0xffe0b0, strength: 0.4, power: 3, shadowSide: 0 } } });
applyEffects(mat, { lighting: { glsl: 'void threedogLighting(inout ReflectedLight light, vec3 normal, vec3 viewDir, vec3 sunDir, float sunShadow, vec3 albedo){ ... }' } });   // your own function
```
All numbers are uniforms, and materials with the same options share one program. Written by hand, the first directional
light is the sun (three sorts shadow casters first), so a patch reads it there and calls `threedogRim`, `threedogWrapDiffuse` or `threedogShadowTint`:
```js
const rim = { name: 'rim', slot: 'lighting', pars: '#include <threedog_lighting>', glsl: `
  #if NUM_DIR_LIGHTS > 0
    float nl = dot(normal, directionalLights[0].direction);
    reflectedLight.indirectDiffuse += threedogRim(normal, normalize(vViewPosition), vec3(0.5, 0.6, 0.8), 0.4, 3.0, 1.0, nl);
  #endif` };
applyEffects(material, { patches: [rim] });
```
The sun's shadow for this pixel needs three's `getShadow`, which the `lightsPars` slot can call; `shadowTint` moves the shaded side's hue, same brightness:
```js
const shade = { name: 'shade', pars: '#include <threedog_lighting>', glsl: {
  lightsPars: `float sunShadow() {
    #if NUM_DIR_LIGHT_SHADOWS > 0 && defined(USE_SHADOWMAP)
      return receiveShadow ? getShadow(directionalShadowMap[0], directionalLightShadows[0].shadowMapSize, directionalLightShadows[0].shadowIntensity,
        directionalLightShadows[0].shadowBias, directionalLightShadows[0].shadowRadius, vDirectionalShadowCoord[0]) : 1.0;
    #else
      return 1.0;
    #endif
  }`,
  lighting: `
    #if NUM_DIR_LIGHTS > 0
      float nl = dot(normal, directionalLights[0].direction);
      reflectedLight.indirectDiffuse = threedogShadowTint(reflectedLight.indirectDiffuse, vec3(0.4, 0.5, 1.0), 0.6, 0.3, nl, sunShadow());
    #endif` } };
```
Limits: one directional light; point and spot lights are untouched; cloud shadows do not count as shadow here; wrap does not follow a toon `gradientMap`. Numbers that should
change live go in the patch's `uniforms`. A toon light ramp is three.js's `gradientMap`; `rampTexture(ramp, soften)` makes one (recipe 09 §1).

**Seasons**: `applyEffects(material, { season: 'foliage' })` (or `'ground'`) tints with the `uFoliageTint` / `uGroundTint` signals: `uFoliageMix` / `uGroundMix` 0 multiplies the tint on, above 0 moves the surface that far toward it.
