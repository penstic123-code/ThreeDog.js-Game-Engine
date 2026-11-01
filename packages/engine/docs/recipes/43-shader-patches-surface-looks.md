# Writing shader patches and surface looks

The default surface is flat: `lambert` plus vertex colors. This page is the three exits for changing that, from simplest to most open:
**1. parameters** in the material spec (nothing changes until you write them), **2. a named patch or GLSL snippet** you write, **3. your own
material** (a function or instance). Use the first that does the job.

## Material roles are open
`style.materials` maps a role name to a material. The engine asks for `default terrain vegetation character water pickup prop`; **any other
name is fine** (`wool`, `bark`, `lantern`): code asks for it with `engine.makeMaterial('wool', { color })`, an unlisted role uses `materials.default`.
Only a name very close to an existing one (`props`, `charcter`) warns, as a probable typo.

```js
materials: {
  default: { type: 'lambert' },
  wool:    { type: 'standard', roughness: 1, detail: { noise: 'grain', projection: 'triplanar', scale: 3, normal: 0.01 } },
  rock:    { type: 'standard', map: 'rock.png', normalMap: 'rock_n.png', roughnessMap: 'rock_r.png', repeat: 4 },
  prop:    (params, purpose, engine) => new THREE.MeshMatcapMaterial({ matcap: texture, color: params.color }),   // any Material
}
```
A **function** gets `(params, purpose, engine)`: the call's `params` (color, vertexColors...), the role asked for, and the engine; it returns any
three.js Material. A **spec** is plain data (`type: lambert | phong | standard | physical | toon | basic` plus material properties), layered over
`materials.default` when that is a spec too; keys the material has are set, spec keys below are handled by the engine.

## Exit 1: parameters in the spec
**Texture names.** A texture slot may be an asset name (`map`, `emissiveMap` are sRGB; `normalMap roughnessMap metalnessMap aoMap bumpMap alphaMap
displacementMap specularMap...` are linear). The engine loads it with `engine.assets.texture`, sets anisotropy, wrap and `repeat` (a number or `[x, y]`;
`wrap: 'repeat' | 'clamp' | 'mirror'`), and a neutral stand-in (flat normal, white) sits in the slot until the image arrives. A texture object works too.
A key the type lacks (`roughnessMap` on `lambert`) warns once with the type to use; a misspelled slot (`normalmap`) throws with the near name.
`style check` verifies the names against the asset pack (`materials.*.map` and the other slots, `materials.*.detail.texture`).

**`detail`**: grain, paper or strokes over the surface, in world space (needs no UVs). Off unless written; every number is a uniform, so
100 materials with different `scale` / `strength` / `direction` compile **one** program (tested: 8 variants, +0 programs).

| key | meaning |
|---|---|
| `noise` | `'grain'` (default) `'paper'` `'stroke'`; or `texture: 'name'` (asset name or a Texture), or `glsl` (below) |
| `projection` | `'world'` top-down (default, fine for ground) or `'triplanar'` (walls, rocks, characters) |
| `scale` `strength` | repeats per meter (0.25), color effect 0-1 (0.35) |
| `mode` `tint` | `'multiply'` (default) `'add'` `'mix'`; tint colors the sample |
| `direction` `stretch` | degrees; stretch along it (strokes default 6): a brush stroke is `{ noise: 'stroke', direction: 20 }` |
| `octaves` | 1-4 noise layers (2) |
| `normal` | relief height in meters (bumps the normal; 0 = off) |
| `roughness` | amount the sample moves roughness (`standard` / `physical`) |

Which channels (color, normal, roughness) are on is fixed when the material is made (it is part of the program); the numbers can change any time.
`style.terrain.detail` (`{ texture, scale, strength }`) is the same patch for the ground.

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

## Exit 2: your own GLSL
`detail.glsl` replaces the noise: `vec4 threedogDetailSample(vec2 p)` returns `vec4(color, height 0-1)`; `p` is already scaled, turned, stretched;
`uniforms: { uCells: 6 }` (numbers, colors, arrays, textures) are in scope. `lighting.glsl` replaces the three light effects:
`void threedogLighting(inout ReflectedLight light, vec3 normal, vec3 viewDir, vec3 sunDir, float sunShadow, vec3 albedo)` (view space; `sunShadow` 1 lit,
0 shadowed; change `light.directDiffuse` / `indirectDiffuse`, the lights are already summed).

For anything else write a **named patch** and add it with `applyEffects(material, { patches: [...] })` (or in a `materials` function):
```js
{ name: 'fuzz',                          // one name per effect; the same name again replaces it
  cacheKey: 'v1',                        // changes whenever the GLSL text changes, never for uniform values
  uniforms: { uFuzz: { value: 0.3 } },   // numbers live here, so materials with different values share a program
  needs: { patches: ['world'], data: ['vertexColors'] },   // 'world' gives `varying vec3 vThreedogWorld`; data = program inputs you read
  conflicts: ['wind'],                   // patches it cannot share a material with (checked when added)
  shadow: false,                         // true = the patch MOVES vertices, so its vertex code also runs in the shadow passes (wind does)
  glsl: { fragment: { pars: 'uniform float uFuzz;',            // pars = declarations at the top
                      color_fragment: 'diffuseColor.rgb *= 1.0 - uFuzz * 0.5;' } } }   // chunk name -> code placed after `#include <chunk>`
```
A chunk value may be `{ before, after }`. A missing chunk throws when the patch is added (`strict`), not as a silent no-op. Chunk names in three **0.187**
(read from `three/src/renderers/shaders`), in main-body order:

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

`MeshBasicMaterial` has no lights, so no `lights_*` chunks; `lambert` has no roughness chunks. `vThreedogWorld` is the world position (instancing and
batching included). Meshes with several patches stack them in the order added, in one program per distinct combination.

## Exit 3: your own material
A `materials` entry that is a Material instance (cloned per use, its patches kept) or a function returning one; `style.lighting` still shapes plain three.js
lit materials returned by it. Nothing else is applied: textures, `detail` and `lighting` keys are only read on specs, so call `applyEffects(material,
{ detail, patches })` yourself.

## Three complete looks
```js
const looks = {
  // wool: rough, fuzzy, soft light, a warm rim; one fine grain seen from every side
  wool: { type: 'standard', roughness: 1, detail: { noise: 'grain', projection: 'triplanar', scale: 4, octaves: 3, strength: 0.25, normal: 0.01 },
          lighting: { wrap: 0.5, rim: { color: 0xffd9a8, strength: 0.35, power: 2.5 } } },
  // leaves: toon bands, brush strokes along the wind, cool shade, a bit of transmitted light on the side away from the sun
  leaf: { type: 'toon', ramp: [0.45, 0.8, 1], soften: 0.25, detail: { noise: 'stroke', direction: 35, scale: 1.2, strength: 0.3, mode: 'add' },
          lighting: { shadowTint: { color: 0x5a6fb0, strength: 0.7 }, rim: { color: 0xb8e08a, strength: 0.3, shadowSide: 1 } } },
  // rock: a real texture set, plus a world-space grain that also roughens it
  rock: { type: 'standard', map: 'rock.png', normalMap: 'rock_n.png', roughnessMap: 'rock_r.png', repeat: 3,
          detail: { noise: 'paper', projection: 'triplanar', scale: 0.8, strength: 0.2, normal: 0.02, roughness: 0.3 } },
};
```
Fetch them with `engine.makeMaterial('wool')`. Check a pack with `threedog style check`; the pixel and program-count guarantees are in `tests/specs/surface.mjs`.
