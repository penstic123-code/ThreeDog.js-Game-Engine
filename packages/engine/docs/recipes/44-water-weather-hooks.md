# Water and rain/snow: depth color, foam, reflections, particles, lightning

```js
engine.use(water({ level: 2 }));
engine.water.material.color.set(0x3070a0);                       // the water's picture is a plain three.js material
engine.water.material.opacity = 0.7;
engine.water.uniforms.uWave.value = 1.5;                         // live: uWave uWaveScale uWaveSpeed uFresnel
engine.water.shader({ foam: true, depthColor: { shallow: 0x55ddcc, deep: 0x082040 } });
engine.water.normalMap('water-n', { scale: 0.4, repeat: 0.05, speed: [0.01, 0.006] });
```

For an AI that wants water or weather particles to look a way the defaults do not. `water()` takes the structure only (`sea`, `level`, `flat`, `size`,
`segments`); the water is neutral gray until your `picture/` code writes it. Lights, fog and the sky are in `38-environment-hooks.md`. Water that uses
none of `depthColor`, `foam`, `surface` keeps the plain shader and pays nothing (`tests/specs/appearance-water.mjs`). Four exits: a material write, a
uniform, a GLSL function you replace, or your own material.

## Water: material and uniforms
`engine.water.material` is shared by every water mesh and is a `MeshLambertMaterial` by default: color, opacity and anything else three.js has on it are
plain writes. Lambert has no highlight; for `shininess` / `specular` set your own Phong material (below). `engine.water.uniforms` are `{ value }` objects:

| Uniform | Default | What it does |
|---|---|---|
| `uWave` | 1 | multiplies the wave function (0 = flat) |
| `uWaveScale` | 1 | world position scale fed to the wave function |
| `uWaveSpeed` | 1 | time scale fed to the wave function |
| `uFresnel` | 0.5 | grazing angles blend toward the fog color, or the sky's horizon with no fog (0 = off) |

## Water: depth color and crest foam
```js fragment
engine.water.shader({ depthColor: { shallow: 0x55ddcc, deep: 0x082040 } });              // by 'view' (default): shallow looking down, deep at grazing angles
engine.water.shader({ depthColor: { shallow: 0x7fe0d0, deep: 0x0a3050, by: 'wave', curve: 1.5 } });   // shallow on the crests, deep in the troughs
engine.water.shader({ foam: { color: 0xffffff, start: 0.55, end: 0.85, opacity: 1 } });  // white on the wave tops; foam: true = these defaults
```
- `shader()` decides which GLSL exists, so it patches the engine's material again (one recompile; it stays the same material). Keys left out keep what an
  earlier call gave, `null` takes one back out. It refreshes `engine.water.patches` and `engine.water.uniforms`; `uWave`, `uWaveScale`, `uWaveSpeed`,
  `uFresnel` stay the same objects.
- `depthColor` replaces the material color (opacity stays). `'view'` is a fresnel-style blend by the view angle, `'wave'` blends by the wave height; neither
  needs a depth texture. `curve` bends the blend (above 1 keeps more of the shallow color). A color left out is a neutral gray (light for
  `shallow`, dark for `deep`): the engine picks no water color, so set both.
- `foam` uses the same wave height as the vertices: `start` / `end` are fractions of the peak height (`waveMax` of the `wave` function, default 0.29) where
  foam begins and is full. Foam is opaque even on transparent water. All numbers are uniforms (`engine.water.uniforms.uFoamStart.value`; also
  `uFoamColor`, `uFoamEnd`, `uFoamOpacity`, `uWaterShallow`, `uWaterDeep`, `uWaterCurve`).
- **Shore foam is not built in.** An accurate foam line where water meets land needs the distance to the ground under each pixel: a depth
  pre-pass (a `DepthTexture` render target of the scene without water) or a terrain height lookup, both cost a full extra pass or a texture
  read per pixel. Do it yourself with your own material: render the scene's depth to a target before the water draws
  (`material.onBeforeRender`), pass it as a uniform, and in your fragment compare the scene depth with this fragment's depth, both turned into meters with three's
  `perspectiveDepthToViewZ` (`#include <packing>`); foam
  where the difference is under about a meter. A cheap fake: `engine.addWaterBody` lakes have known radii, so a surface function can foam the
  ring `length(worldPos.xz - center) > radius - 1.0` (pass the center and radius as `uniforms`).

## Water: replace the wave or the surface function (GLSL)
```js
engine.water.shader({
  uniforms: { uBands: 4, uDeep: [0.05, 0.2, 0.4] },                 // numbers, colors, [x, y(, z, w)] arrays, textures; in both stages, live in engine.water.uniforms
  wave: {
    glsl: `float threedogWaterWave(vec3 p, float t) {               // p = world position * uWaveScale, t = time * uWaveSpeed
      return sin(p.x * 0.5 + t) * 0.2 + sin(p.z * 0.8 - t * 1.3) * 0.1; }`,   // height before uWave
    waveMax: 0.3,                                                   // its peak: foam and depthColor 'wave' divide by it
  },
  surface: `vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time) {
      float b = floor(facing * uBands) / uBands;                    // toon bands by view angle
      return vec4(mix(uDeep, vec3(0.4, 0.8, 0.9), b), base.a); }`,
});
```
- `wave` (a GLSL string, or `{ glsl, waveMax }`) replaces only the vertex motion; the rest of the built-in water stays. Copying the default
  (`modules/water/surface.js`, `WAVE`) draws pixel for pixel the same.
- `surface` runs before lighting: `base` is the material color and opacity, `wave` the height at this point, `facing` 1 looking straight down and 0
  at grazing angles, `worldPos` the moved surface point. The result is lit, fogged and gets the grazing-angle fresnel like the default water.
  With `surface` written, `depthColor` / `foam` are not added (your function is the whole surface).
- A wrong signature throws with the right one; misspelled keys throw with the near name.
- Your GLSL has no WebGPU form (the GLSL route is for `--webgl` games): on `renderer: 'webgpu'` start() names the patch. The built-in wave, depth color and foam run on both renderers.

## Water: normal map
`engine.water.normalMap(name, { scale, repeat, speed })` loads the texture by asset name onto the engine's material: `scale` is its strength, `repeat` tiles
per meter (rewrites the meshes' UVs once), `speed` the scroll `[x, z]` per second. Keys left out keep their value; the same name again only changes those;
`null` takes it off. It returns the texture, also readable as `engine.water.normalTexture`. A material of your own takes that texture itself
(`myMaterial.normalMap = engine.water.normalTexture`); the tiling and the scroll run whatever material draws.

## Water: your own material (reflections, refraction)
```js
engine.water.material = applyEffects(new THREE.MeshPhongMaterial({ color: 0x3070a0, shininess: 90, specular: 0xaaaaaa, transparent: true, opacity: 0.85 }),
  { patches: engine.water.patches });                               // keep the waves, the surface and the fresnel
engine.water.material = new THREE.ShaderMaterial({ uniforms: engine.water.uniforms, vertexShader, fragmentShader });   // or all your own
```
Setting `engine.water.material` swaps it on every water mesh, now and later, and draws it as given: the engine adds no patch, so `patches` is how waves
stay (pick from the list by `name` for only some: `waves`, `waterSurface`, `fresnel`; `waterSurface` needs `waves` before it). After a later `shader()` call
patch your material again; the engine only rebuilds its own. Your material reads `engine.water.uniforms` like the built-in one, and the engine still
builds the meshes, snaps the sea to the focus and scrolls the normal map. Reflections and refraction are not built in (each one renders the scene a
second time). three's `Reflector` addon works through this exit; the engine water is pre-rotated geometry, so the mirror gets the mesh's
matrix turned into the XY plane it expects:

```js
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

const mirror = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: 512, textureHeight: 512, color: 0x88aacc }), m = mirror.material;
const toPlane = new THREE.Matrix4().makeRotationX(-Math.PI / 2), back = new THREE.Matrix4().makeRotationX(Math.PI / 2);
let busy = false;
m.onBeforeRender = (renderer, scene, camera, geometry, mesh) => {
  if (busy) return; busy = true;                                      // the mirror's own render must not reflect again
  mirror.matrixWorld.copy(mesh.matrixWorld).multiply(toPlane);
  mesh.visible = false; mirror.onBeforeRender(renderer, scene, camera); mesh.visible = true;
  m.uniforms.textureMatrix.value.multiply(back);                      // undo the turn for the pre-rotated vertices
  busy = false;
};
engine.water.material = m;
```
- Cost: the whole scene drawn once more per frame per water mesh at `textureWidth` x `textureHeight` (shadows are not re-rendered). Use 256-512
  on phones; on `engine.tier === 'low'` keep the default material instead.
- One mirror plane: the material is shared, so water bodies at other levels need `water({ sea: false })` or their own mirror. The Reflector's
  shader has no waves or fog; for both, copy its `fragmentShader` into a `MeshPhongMaterial` patch that samples `tDiffuse` with `textureMatrix`.
- three's `Refractor` addon (next to `Reflector`) reads `matrixWorld` as an XY plane too, so the same adapter applies (not covered by a test).
- Tested: `tests/specs/appearance-water.mjs` renders this exact example and finds the reflected box in the mirror texture.

## Water: your own meshes (three's `Water` addon, your own geometry)
The water module's material is yours to swap, its meshes are not. For water drawn entirely your way, leave `water()` out and draw it in plain
three.js: the water data stays in the engine without the module. `engine.waterAt(x, z)` gives the surface height (water bodies first, then
`engine.waterLevel`), `engine.waterBodies` lists the lakes and ponds (`{ x, z, radius | hw, hd, level }`), and `water:add` / `water:remove` tell
you when one comes or goes, so swimming, buoyancy and anything else reading the water keep working.

## Weather particles: rain and snow parameters
`weather({ rain, snow })` (left-out keys keep the built-in picture):

```js
weather({ types,
  rain: { color: 0xa8b8d0, opacity: 0.6, length: 1.2, speed: 26, slant: 1.5, density: a => a * a },   // streaks; sparse in a drizzle
  // rain: { shape: 'soft', size: 10, maxSize: 6, sway: 0.3 },     // drops as soft sprites instead of streaks
  snow: { shape: 'soft', size: 28, maxSize: 7, speed: 1, sway: 3, count: 4000 },
  // snow: { texture: 'flake' },                                    // a sprite image replaces the shape
});
```
- `shape`: `'line'` (rain default; leans with the wind by `slant`, `length` meters) or a sprite: `'round'` (snow default), `'soft'`, `'square'`
  (`size` pixels at 3 m, capped at `maxSize`; drifts `sway` meters). `speed` is the fall in m/s.
- `density: amount => share`: how many particles show at a weather amount 0..1 (rain `a => min(1, a * 1.2)`, snow `() => 1`); opacity still
  follows the amount. `count` per system (default `weather({ particles })`, halved on low-tier devices). Coverage is `weather({ area })`.

At run time each system is in `engine.weather.particles`, and every number is a plain write, live on both renderers:
```js
const rain = engine.weather.particles.rain;
rain.spec.speed = 30; rain.spec.opacity = 0.3; rain.spec.slant = 2;              // read each frame; density too
rain.uniforms.uColor.value.set(0xa8b8d0); rain.uniforms.uLen.value = 1.2;        // sprites: uPx (size), uMaxPx (maxSize), uSwayAmp (sway)
rain.material = new THREE.ShaderMaterial({ uniforms: rain.uniforms, vertexShader: rain.material.vertexShader,
  fragmentShader: myFragment, transparent: true, depthWrite: false });           // your material, drawn as given; null gives the engine's back
engine.weather.overcastColor.set(0x667788); engine.weather.lightningBrightness = 0.5;
```
The fall and the follow-the-camera wrap live in the vertex shader, so a material of your own shares `uniforms` and keeps a vertex shader like it.

## Weather particles: replace the shaders (GLSL)
```js
weather({ types, snow: { uniforms: { uTint: [1, 0.85, 0.9] }, glsl: { fragment: `uniform float uOpacity;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep(0.1, 0.25, dot(d, d));               // a soft petal
  gl_FragColor = vec4(uTint, uOpacity * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}` } } });
```
`glsl.vertex` / `glsl.fragment` are the whole shader text; copy `modules/weather/shaders.js` (`lineVert lineFrag pointVert pointFrag`) as the
start. In scope: `uCam uSize uFallOff uOpacity uColor`; lines add `uWindDir uLen` and the attribute `aEnd` (0 head, 1 tail); sprites add
`uPx uMaxPx uSway uSwayAmp uMap uUseMap`. Your `uniforms` are declared for you; declare the built-in ones you use, as the copies do. Keep
the two `#include` lines so the color matches three's materials with and without post-processing. WebGPURenderer does not compile GLSL text: `engine.weather.define(field, { create })` with a node material there.

## Lightning picture
```js
weather({ types, lightning: f => f * f * 0.8 });                   // flash 1 at the strike -> sky flash amount (default flickers)
weather({ types, lightning: () => 0 });                            // no sky flash: draw your own bolt instead
engine.events.on('weather:lightning', () => spawnBolt());          // when it strikes stays the weather table's (lightning > 0.5)
```

## Particles of the game's own weather
A field of the game's own weather table (`ash`, `petals`, `sparks`) gets particles with `engine.weather.define(field, spec)`; the amount is
`engine.weather.current[field]`, so they fade in and out with the weather. The spec takes the rain / snow keys above (default: drifting
round sprites), or `create` for a system of your own:

```js
engine.use(sky(), weather({ types: { clear: {}, ashfall: { ash: 1, grey: 0.5, sun: 0.6 } } }));
engine.weather.define('ash', { shape: 'soft', color: 0x555555, size: 14, speed: 0.8, sway: 3 });
engine.weather.define('rain', { create: (engine, { area, count }) => {   // the same call replaces rain or snow
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: 0x99bbff }), count);
  return { object: drops, update(amount, { camera, time, wind }) { /* move the instances; shown while amount > 0.02 */ } };
} });
```
A field no type has throws with the table's fields. `define(field, null)` gives rain and snow back and removes any other field. Rain and snow are built
only when a type rains or snows, so a desert pays nothing.

The weather's effect on the picture stays on signals: `engine.uniforms.uWeatherLight`, `uWeatherFog`, `uRain`, `uSnow`, `uWind`, `uCloud`. The game's own light,
fog and wet-road code reads them; the weather writes no light and no fog.


A look that changes with depth (tint, opacity, foam) reads depth as the water level minus `engine.ground.height(x, z)`: once per vertex of a subdivided plane, or baked into an attribute a material reads.
