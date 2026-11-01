# Water and weather look open points: depth color, foam, reflections, rain and snow, lightning, own particles

For an AI that wants water or weather particles to look a way the defaults do not. Water basics are the `water()` module and `style.water` (color, opacity, waves,
fresnel, normal map); lights, fog and the sky are in `38-environment-look-hooks.md`. Every default below draws exactly what it drew before
(checked pixel by pixel against the old shaders in `tests/specs/appearance-water.mjs`), and a style that writes none of the new keys gets the same
shader text, so it pays nothing. Three exits: a parameter, a GLSL function you replace, or your own material.

## Water: depth color and crest foam (parameters)
```js
water: {
  depthColor: { shallow: 0x55ddcc, deep: 0x082040 },              // by 'view' (default): shallow looking down, deep toward the horizon
  depthColor: { shallow: 0x7fe0d0, deep: 0x0a3050, by: 'wave', curve: 1.5 },   // shallow on the crests, deep in the troughs
  foam: { color: 0xffffff, start: 0.55, end: 0.85, opacity: 1 },  // white on the wave tops; foam: true = these defaults
}
```
- `depthColor` replaces `color` (opacity stays). `'view'` is a fresnel-style blend by the view angle, `'wave'` blends by the wave height; neither
  needs a depth texture. `curve` bends the blend (above 1 keeps more of the shallow color).
- `foam` uses the same wave height as the vertices: `start` / `end` are fractions of the peak height (`glsl.waveMax`, default 0.29) where
  foam begins and is full. Foam is opaque even on transparent water. All numbers are uniforms (`engine.water.material.uniforms.uFoamStart.value`).
- **Shore foam is not built in.** An accurate foam line where water meets land needs the distance to the ground under each pixel: a depth
  pre-pass (a `DepthTexture` render target of the scene without water) or a terrain height lookup, both cost a full extra pass or a texture
  read per pixel. Do it yourself through `style.water.material`: render the scene's depth to a target before the water draws
  (`material.onBeforeRender`), pass it as a uniform, and in your fragment compare the scene depth with this fragment's depth, both turned into meters with three's
  `perspectiveDepthToViewZ` (`#include <packing>`); foam
  where the difference is under about a meter. A cheap fake: `engine.addWaterBody` lakes have known radii, so a surface function can foam the
  ring `length(worldPos.xz - center) > radius - 1.0` (pass the center and radius as `uniforms`).

## Water: replace the wave or the surface function (GLSL)
```js
water: {
  uniforms: { uBands: 4, uDeep: [0.05, 0.2, 0.4] },                // numbers, colors, [x, y(, z, w)] arrays, textures; in both stages
  glsl: {
    wave: `float threedogWaterWave(vec3 p, float t) {               // p = world position * waveScale, t = time * waveSpeed
      return sin(p.x * 0.5 + t) * 0.2 + sin(p.z * 0.8 - t * 1.3) * 0.1; }`,   // height before waveHeight
    waveMax: 0.3,                                                   // its peak: foam and depthColor 'wave' divide by it
    surface: `vec4 threedogWaterSurface(vec4 base, float wave, float facing, vec3 worldPos, float time) {
      float b = floor(facing * uBands) / uBands;                    // toon bands by view angle
      return vec4(mix(uDeep, vec3(0.4, 0.8, 0.9), b), base.a); }`,
  },
}
```
- `wave` replaces only the vertex motion; the rest of the built-in water stays. Copying the default
  (`modules/water/surface.js`, `WAVE`) draws pixel for pixel the same.
- `surface` runs before lighting: `base` is the material color and opacity, `wave` the height at this point, `facing` 1 looking straight down and 0
  at grazing angles, `worldPos` the moved surface point. The result is lit, fogged and gets the grazing-angle fresnel like the default water.
  With `surface` written, `depthColor` / `foam` are not added (your function is the whole surface).
- A wrong signature throws with the right one; misspelled keys warn with the near name; `threedog style check` knows these keys.

## Water: your own material (reflections, refraction)
`style.water.material: (engine, { uniforms, waves, surface, normalMap }) => Material` replaces the whole water material; the engine still builds
the meshes, snaps the sea to the focus and scrolls the normal map. Reflections and refraction are not built in (each one renders the scene a
second time). three's `Reflector` addon works through this exit; the engine water is pre-rotated geometry, so the mirror gets the mesh's
matrix turned into the XY plane it expects:

```js
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

water: { material: () => {
  const mirror = new Reflector(new THREE.PlaneGeometry(1, 1), { textureWidth: 512, textureHeight: 512, color: 0x88aacc }), m = mirror.material;
  const toPlane = new THREE.Matrix4().makeRotationX(-Math.PI / 2), back = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  let busy = false;
  m.onBeforeRender = (renderer, scene, camera, geometry, mesh) => {
    if (busy) return; busy = true;                                    // the mirror's own render must not reflect again
    mirror.matrixWorld.copy(mesh.matrixWorld).multiply(toPlane);
    mesh.visible = false; mirror.onBeforeRender(renderer, scene, camera); mesh.visible = true;
    m.uniforms.textureMatrix.value.multiply(back);                    // undo the turn for the pre-rotated vertices
    busy = false;
  };
  return m;
} }
```
- Cost: the whole scene drawn once more per frame per water mesh at `textureWidth` x `textureHeight` (shadows are not re-rendered). Use 256-512
  on phones; on `engine.tier === 'low'` return the default-looking material instead.
- One mirror plane: the material is shared, so water bodies at other levels need `water({ sea: false })` or their own mirror. The Reflector's
  shader has no waves or fog; for both, copy its `fragmentShader` into a `MeshPhongMaterial` patch that samples `tDiffuse` with `textureMatrix`.
- three's `Refractor` addon (next to `Reflector`) reads `matrixWorld` as an XY plane too, so the same adapter applies (not covered by a test).
- Tested: `tests/specs/appearance-water.mjs` renders this exact example and finds the reflected box in the mirror texture.

## Weather particles: rain and snow parameters
`style.weather.rain` / `snow` (left-out keys keep the built-in look; the defaults are pixel for pixel the old ones):

```js
weather: {
  rain: { color: 0xa8b8d0, opacity: 0.6, length: 1.2, speed: 26, slant: 1.5, density: a => a * a },   // streaks; sparse in a drizzle
  // rain: { shape: 'soft', size: 10, maxSize: 6, sway: 0.3 },     // drops as soft sprites instead of streaks
  snow: { shape: 'soft', size: 28, maxSize: 7, speed: 1, sway: 3, count: 4000 },
  // snow: { texture: 'flake' },                                    // a sprite image replaces the shape
}
```
- `shape`: `'line'` (rain default; leans with the wind by `slant`, `length` meters) or a sprite: `'round'` (snow default), `'soft'`, `'square'`
  (`size` pixels at 3 m, capped at `maxSize`; drifts `sway` meters). `speed` is the fall in m/s.
- `density: amount => share`: how many particles show at a weather amount 0..1 (rain `a => min(1, a * 1.2)`, snow `() => 1`); opacity still
  follows the amount. `count` per system (default `weather({ particles })`, halved on low-tier devices). Coverage is `style.weather.area`.
- The numbers are uniforms: `engine.weather.systems.get('rain').uniforms.uColor.value.set(0xff0000)` works at run time.

## Weather particles: replace the shaders (GLSL)
```js
snow: { uniforms: { uTint: [1, 0.85, 0.9] }, glsl: { fragment: `uniform float uOpacity;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = 1.0 - smoothstep(0.1, 0.25, dot(d, d));               // a soft petal
  gl_FragColor = vec4(uTint, uOpacity * a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}` } }
```
`glsl.vertex` / `glsl.fragment` are the whole shader text; copy `modules/weather/shaders.js` (`lineVert lineFrag pointVert pointFrag`) as the
start. In scope: `uCam uSize uFallOff uOpacity uColor`; lines add `uWindDir uLen` and the attribute `aEnd` (0 head, 1 tail); sprites add
`uPx uMaxPx uSway uSwayAmp uMap uUseMap`. Your `uniforms` are declared for you; declare the built-in ones you use, as the copies do. Keep
the two `#include` lines so the color matches three's materials with and without post-processing.

## Lightning look
```js
weather: { lightning: f => f * f * 0.8 }                           // flash 1 at the strike -> sky flash amount (default flickers)
weather: { lightning: () => 0 }                                    // no sky flash: draw your own bolt instead
engine.events.on('weather:lightning', () => spawnBolt());          // when it strikes stays the weather table's (lightning > 0.5)
```

## Particles of the game's own weather
A field of the game's own weather table (`ash`, `petals`, `sparks`) gets particles with `engine.look.weather.replace({ [field]: spec })`; the amount is
`engine.weather.current[field]`, so they fade in and out with the weather. The spec takes the rain / snow keys above (default: drifting
round sprites), or `create` for a system of your own:

```js
engine.use(sky(), weather({ types: { clear: {}, ashfall: { ash: 1, grey: 0.5, sun: 0.6 } } }));
engine.look.weather.replace({ ash: { shape: 'soft', color: 0x555555, size: 14, speed: 0.8, sway: 3 } });
engine.look.weather.replace({ rain: { create: (engine, { area, count }) => {   // the same call replaces rain or snow
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03), new THREE.MeshBasicMaterial({ color: 0x99bbff }), count);
  return { object: drops, update(amount, { camera, time, wind }) { /* move the instances; shown while amount > 0.02 */ } };
} } });
```
A field no type has throws with the table's fields. Rain and snow are built only when a type rains or snows, so a desert pays nothing.

> Water and weather are also look parts (`engine.look.water`, `engine.look.weather`): recipes/52-look.md, "Water, weather, post".
