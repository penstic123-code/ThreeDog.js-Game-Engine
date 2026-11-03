# Sky, ground and plant looks: what a style can change

For an AI turning a reference picture into a style and hitting "the engine draws it this way". Colors and materials are in `09-style.md`, the
order of work in `35-style-from-reference.md`. This page lists the places where the *shape* of a look was fixed in engine code and is now a style
setting. Each table lists the engine default; a style that sets nothing here gets those defaults. Styles hold looks only
(rule R34): none of these settings move a hill, a river or a species list.

## Sky clouds: `style.sky.clouds`
| Key | Meaning | Default |
|---|---|---|
| `color`, `shade`, `coverage`, `scale`, `speed` | lit color, shaded color, cover (multiplies the weather's cloud amount), size, drift speed | |
| `kind` | `'plane'` cheap, 3 noise samples. `'cumulus'` billowy, 8 noise samples per cloudy sky pixel, flatter projection (clouds fill the whole sky instead of crowding at the horizon), the sun side of each cloud is lit and the underside shaded | `'plane'` |
| `horizon` | added to `dir.y` before projecting; smaller = clouds shrink and crowd more towards the horizon | plane 0.08, cumulus 0.5 |
| `fade` | `[from, to]` in `dir.y`: invisible below `from`, full above `to` | plane `[0, 0.18]`, cumulus `[0, 0.12]` |
| `opacity`, `softness` | cloud alpha; width of the cloud edge | 0.9 / 0.3 (cumulus 0.95 / 0.35) |
| `noise` | plane only: `{ scales: [2.7, 6.1], weights: [0.6, 0.3, 0.1] }`, the two finer layers' frequency and the mix of the three | as shown |
| `relief` | cumulus only: contrast of the sun-side light | 5 |

Why a thin band at the horizon with `plane`: the plane projection divides by height, so near the horizon one screen pixel covers a lot of cloud plane
and the noise is dense and small; overhead one pixel covers little and the same coverage looks sparse. For a sky full of big clouds use
`kind: 'cumulus'`, or raise `horizon` (0.3-0.6) and lower `scale`. Cost: both are one 2D pass over the dome (no ray marching); cumulus is about
2.7x the noise work of plane on the cloudy pixels (pixels below the horizon or with no cloud cover skip it). Cloud shadows on the ground
(`style.clouds.shadow`, a separate setting) follow the same weather cover, so more clouds still means more shadow.

```js fragment
sky: { clouds: { kind: 'cumulus', coverage: 1, scale: 0.45, color: 0xfff4e4, shade: 0x8a9cb8, speed: [0.003, 0.001] } }
```

### Your own cloud function
`engine.look.sky.patch('clouds', glsl | { glsl, uniforms })` is the one way in (a `glsl` key in `style.sky.clouds` throws and names it). The GLSL must define this function; the dome calls it for every upper-hemisphere pixel with cover above 0.01, then does `mix(sky, rgb, a)`:
```glsl
vec4 threedogClouds(vec3 dir, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover)
// dir: unit view direction, dir.y > 0. sunDir: towards the sun (the moon is opposite). night: 0 day .. 1 night.
// lit / shade: clouds.color / clouds.shade. cover: weather cloud amount * clouds.coverage.
// return: rgb = final cloud color (dim it at night yourself), a = opacity (apply your own horizon fade).
```
In scope: the GLSL noise helpers `float threedogHash(vec2 p)` and `float threedogNoise(vec2 p)`, the built-in cloud uniforms (`uCloudScale`, `uCloudSpeed`, `uCloudHorizon`, `uCloudFade`...) and
the patch's `uniforms` (declared for you; number, `THREE.Color`, `THREE.Vector2/3/4`, array of 2-4 numbers, or `THREE.Texture`). Change one later
with `engine.sky.dome.material.uniforms.uEdge.value = 0.1`. A bad `kind`, GLSL without the function, or an unsupported uniform value throws with the fix.
Flat painted cloud blobs with a hard edge, multiplied by a texture:
```js
// style: clouds: { color: 0xfff1dc, shade: 0x9aa8c4 }; the function goes through the hook
engine.look.sky.patch('clouds', { uniforms: { uPaper: paperTexture, uEdge: 0.06 },   // paperTexture: any THREE.Texture, repeat wrapping
  glsl: `vec4 threedogClouds(vec3 d, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover){
    vec2 p = d.xz / (d.y + 0.5) * 0.4 + vec2(0.004, 0.002) * time;
    float n = threedogNoise(p) * 0.65 + threedogNoise(p * 2.3 + 5.0) * 0.35;
    float a = smoothstep(1.0 - cover, 1.0 - cover + uEdge, n);                          // hard edge
    float up = clamp(0.5 + (n - threedogNoise(p + sunDir.xz * 0.1)) * 6.0, 0.0, 1.0);  // sun side
    vec3 c = mix(shade, lit, up) * texture2D(uPaper, p * 3.0).rgb * (0.35 + 0.65 * (1.0 - night));
    return vec4(c, a * smoothstep(0.0, 0.1, d.y));
  }` });
```

## Ground color: `style.terrain.variation`
Terrain colors are baked by the (worker) generator from the palette: two palette colors blended by a noise, a small brightness grain, and an
optional layer of large patches. The defaults are shown (plain data, so it travels to the workers; unknown keys throw):
```js fragment
terrain: { colors: { ... }, biomeColors: { ... },
  variation: {
    blend:   { size: 33, strength: 1 },          // wavelength in m of the two-color noise; strength > 1 = harder contrast, < 1 = flatter
    jitter:  { size: 0.33, min: 0.92, range: 0.12 },   // grain cell in m; darkest multiplier; how much brighter it can get (0 range = no grain)
    patches: { size: 90, strength: 0.15, levels: 0, tint: 0xb59a5a },   // optional (example values): a second, large layer of color blocks
  } }
```
`patches` is off unless given. It is a noise much larger than `blend`; `levels: 4` snaps it to 4 flat steps (hard-edged color blocks instead of a
soft blend); without `tint` it lightens and darkens the ground, with `tint` it pulls the color towards the tint where the noise is high. Vertex colors
interpolate across a chunk cell (4 m at the default resolution), so blocks smaller than that blur; for crisp blocks use `shading: 'texture'`
(recipe 37) or a texture (next). Which combination fits which look, and ground that looks wrong up close: recipe 53.

### Your own ground material
`style.terrain.material` (a Material or `(engine) => Material`) replaces the ground material. Chunk geometry has `uv = world xz / chunk size`, continuous
across chunk borders (checked by `tests/specs/appearance.mjs`), so a repeating texture is seamless whatever chunk it lands in; cloud shadows and
season tint are added to your material. `texture.repeat.set(8, 8)` = 8 tiles per chunk. Without UVs (steep sides stretch a top-down map), project
from the world position in a patch instead (`needs.patches: ['world']` gives `vThreedogWorld`):
```js
material: engine => applyEffects(new THREE.MeshLambertMaterial({ vertexColors: true }), { clouds: false, patches: [{
  name: 'triplanar', needs: { patches: ['world'] }, uniforms: { uTex: { value: groundTexture }, uTexScale: { value: 0.1 } },   // groundTexture: repeat wrapping
  glsl: { fragment: { pars: 'uniform sampler2D uTex; uniform float uTexScale;',
    color_fragment: `vec3 n = abs(normalize(cross(dFdx(vThreedogWorld), dFdy(vThreedogWorld)))); n /= n.x + n.y + n.z;
      diffuseColor.rgb *= texture2D(uTex, vThreedogWorld.zy * uTexScale).rgb * n.x + texture2D(uTex, vThreedogWorld.xz * uTexScale).rgb * n.y
        + texture2D(uTex, vThreedogWorld.xy * uTexScale).rgb * n.z;` } } }] })
```
A procedural noise texture is a `THREE.DataTexture` filled in a loop (`wrapS = wrapT = THREE.RepeatWrapping`, `colorSpace = THREE.SRGBColorSpace`,
`needsUpdate = true`). The lighter alternative is a detail layer, `style.terrain.detail` / `look.ground.set({ detail })`: the same object as a
material spec's `detail` (`noise: 'grain' | 'paper' | 'stroke' | 'dabs'`, or `texture: 'name'`, or your own `glsl`; `scale`, `strength`, `fade`
...; keys in recipe 43), with no material of your own. Which to pick: recipe 53.

## Plants and wind
Audit of what the vegetation code fixes, split into mechanism (stays) and look (made a setting):

| Where | What | Kind |
|---|---|---|
| `Vegetation.define` | per species: `wind` amplitude, `rule`, `positions`, `densityMap`, `lodRing`, `maxRing`, `nearOnly`, `castShadow`, `shadowRing`, `material`, `effects` | already options (game content) |
| `GroundChunks`, `VegetationLook` (`modules/vegetation/look.js`) | one InstancedMesh per species per chunk; rings decide LOD swap, draw distance, shadow distance; 3 ms placement budget; collision lag | mechanism, stays (the whole look is replaceable: recipe 28 section 6) |
| wind sway shape | two sines (speed `1.2 + 0.6*uWind` and `2.9`, spatial phase from the instance origin), height-weighted, lean with wind strength | look: **`engine.look.wind.patch('sway', glsl)`** replaces it |
| wind speed | `uWindFreq` | already `style.wind.frequency` |
| season tint | `diffuseColor.rgb *= tint` (default) or a blend towards the tint; colors from `style.seasons` | look, both settings: `style.seasons.mode: 'multiply' \| 'mix'` (+ `strength`); see recipe 43 |
| defaults | `castShadow` = not `nearOnly`, `shadowRing` 1, `lodRing` 1 | per-species options, set them in the species |

```js
engine.look.wind.patch('sway', { uniforms: { uSteps: 3 },    // stepped sway: plants snap between 3 poses instead of a smooth sine; before vegetation.define
  glsl: `void threedogWind(inout vec3 transformed, vec3 ip, vec3 position){
    float s = floor(sin(uTime * uWindFreq + ip.x * 0.3 + ip.z * 0.2) * uSteps) / uSteps;
    transformed.x += s * max(position.y, 0.0) * THREEDOG_WIND_AMP * uWind;
  }` });
```
`threedogWind` receives the vertex (`transformed`, object space), `ip` (world position of this plant's origin, so each plant has its own phase) and
`position`; `uTime`, `uWind` (weather), `uWindFreq` and `THREEDOG_WIND_AMP` (the species' amplitude) are in scope. It applies to every material made by
`vegetation.define` that has `wind` set, and the shadow sways with it. A missing function throws with the signature. The same object works in code:
`applyEffects(mat, { wind: { amplitude: 0.03, glsl, uniforms } })`.

Cost, measured with software rendering (relative numbers only): 10,000 grass blades of 6 triangles in one InstancedMesh draw in 1 call; per frame
about 120 ms with no wind, default wind and a custom sway alike, so the sway function is not where grass time goes (vertex count and fill are).
Reduce grass cost with `rule.perChunk`, `maxRing` and `nearOnly`, not the wind.

## What is still fixed
Season tint is multiplicative. Cloud *shadows* on the ground (`threedog_clouds_pars_fragment`) keep their two-noise shape; only strength, scale and
speed are style settings. Grass has no billboard or blade-shape setting: give `vegetation.define` your own `geometry` or `model`.
