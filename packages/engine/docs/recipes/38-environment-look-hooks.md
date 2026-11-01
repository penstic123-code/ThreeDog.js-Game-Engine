# Environment look open points: lights, fog, exposure, sky layers

For an AI that wants lighting, fog or the sky to look a way the defaults do not. Sky basics are in `08-weather-sky.md`, clouds and ground color in
`36-sky-ground-plant-looks.md`, environment lighting in `34-environment-lighting.md`. Every default below draws exactly what it drew before
(checked pixel by pixel in `tests/specs/appearance-env.mjs`). Each knob has three exits: a parameter, a GLSL function you replace, or turning the
engine's part off and bringing your own three.js objects.

## Lights: let the sky drive them, drive them yourself, or switch them off
The engine has one directional light (`engine.lights.sun`, also `engine.sky.sun`; moonlight at night, the shadows live on it) and one hemisphere
ambient (`engine.lights.hemi` = `engine.sky.hemi`). The sky module rewrites their color and intensity every frame from `style.sky.keyframes`,
so editing them directly is overwritten (a dev warning says so). Choose per light:

```js
engine.use(sky({ sun: 'manual' }));                     // the sky still aims the sun along the time of day and moves the shadow box
engine.sky.sun.color.set(0xffd0a0); engine.sky.sun.intensity = 1.4;   // yours now, never overwritten

engine.use(sky({ sun: false, hemisphere: false }));     // a dungeon: both hidden, never touched; the dome still shows sun and moon
const torch = new THREE.PointLight(0xffa040, 6, 12); engine.add(torch);   // add your own lights before engine.start()
```

- Default `true`: the sky drives everything (as before). `'manual'`: color and intensity are the game's; the sun keeps its direction and shadow box.
  `false`: `visible = false`, no shadows, never touched (lightning no longer flashes the ambient either).
- Shadows: only the engine sun's shadow is managed (size, bias, snapping via `engine.sky.setShadow`). Your own `castShadow` lights work as in
  three.js, each costing its own shadow pass; `engine.setShadows(false)` turns theirs off too and restores them after.
- Add or remove lights before `engine.start()`: a light count that changes mid-play recompiles every material (one long frame). Many torches:
  `lightPool()`. Brightness tweaks without giving up the keyframes: `engine.sky.modify('cave', { sun: 0.3, ambient: 0.4 })`.

## Fog: kind, color, density, or your own math
`style.sky.fog` (a look; `sky({ fog })` overrides it):

```js
fog: { kind: 'exp2' }                                     // three's FogExp2, density derived so it reaches as far as the linear fog did
fog: { kind: 'height', height: 2, falloff: 0.08, density: 0.03 }   // valley mist: thick below y = 2, thinning 8% per meter above
fog: { kind: 'exp', color: 0xb8c4d0 }                     // own color: the dome's lower band fades to it, so the horizon line never shows
fog: { color: sky => sky.isDay ? 0xc8d0d8 : 0x10141c }    // a function, evaluated each frame
fog: { kind: 'exp', glsl: `vec4 threedogFog(vec3 c, float depth, vec3 p){
  float f = 1.0 - exp(-fogDensity * depth);
  return vec4(mix(c, vec3(1.0, 0.85, 0.7), f * 0.3), f); }` }   // warm far haze
```

- `kind`: `'linear'` (default, near = 0.3 x far) | `'exp'` | `'exp2'` | `'height'`. `color`: `'horizon'` (default) | color | `(sky) => color`.
  `density` per meter (default derived from `engine.fogFar`); weather fog divides it, `engine.setFogFar` still moves the derived one.
- `glsl` replaces the fog math in every material, built-in or yours: `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)` returns
  (fog rgb, amount 0..1). In scope: `fogColor`, `cameraPosition`, `fogNear` / `fogFar` (linear) or `fogDensity` (other kinds),
  `THREEDOG_FOG_HEIGHT`, `THREEDOG_FOG_FALLOFF`.
- How it works and its limits: `'exp'`, `'height'` and `glsl` replace three's `fog_*` shader chunks once at install (three caches programs by
  material settings, not by source, so the fog model cannot change mid-play; color and density stay live). No custom uniforms (three copies fog
  uniforms into each material when it compiles); write constants. Materials with `fog: false` (the dome) are not fogged; the dome follows the
  fog color as above. A ShaderMaterial of your own gets the same fog when it sets `fog: true` and includes the fog chunks.
- Whole replacement: `sky({ fog: 'manual' })` creates `scene.fog` once and never writes it (set its color / near / far, or assign your own
  object); `sky({ fog: false })` sets `scene.fog = null` (leave fog out of your materials with `fog: false` and fog in a post pass). Default
  `true` = the sky drives it. This is a sky() option, not a style key.
- Two engines on one page share three's fog chunks: the same custom `kind` / `height` / `falloff` / `glsl` is fine (reference counted, the
  originals return when the last one is disposed); a different custom setting throws. Plain `linear` / `exp2` do not touch the chunks.

## Exposure and tone mapping over time
```js
exposure: [[0, 1.6], [0.3, 1], [0.75, 1.1]]               // style: per time of day (0-1), wraps across midnight
exposure: sky => sky.isDay ? 1 : 1.5                       // or a function, evaluated by the sky module every frame
engine.setExposure(1.3);                                    // at run time: number, keyframes or function (replaces the style's)
engine.setToneMapping('agx');                               // 'aces' | 'agx' | 'neutral' | 'none'; materials recompile on their next draw
```
A plain number behaves as before (set once, no per-frame work). Keyframes and functions need the sky module (it knows the time of day).

## Extra sky layers: rainbow, aurora, painted bands
`style.sky.layers` (or `sky({ layers })`), drawn on the dome after clouds and stars; none by default (the dome shader text is then unchanged):

```js
layers: [{ blend: 'add', uniforms: { uAurora: [0.2, 1, 0.6] }, glsl: `vec4 threedogSkyLayer(vec3 d, float time, vec3 sunDir, float night){
  float band = smoothstep(0.25, 0.45, d.y) * (1.0 - smoothstep(0.55, 0.8, d.y));
  float n = threedogNoise(vec2(d.x * 4.0 + time * 0.05, d.z * 2.0));
  return vec4(uAurora, band * n * night); }` }]
```
Signature `vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)` returns (rgb, amount). `blend: 'mix'` (default) or `'add'`;
`order` sorts layers (smaller first); `uniforms` like `clouds.uniforms`, live in `engine.sky.dome.material.uniforms.uAurora.value`. Each layer's function is
renamed (`threedogSkyLayer0`, `1`, ...), so layers from different style parts never clash. Whole replacement: `style.sky.skybox` (a panorama) or
hide `engine.sky.dome` and add your own background.

## Water and weather particles
Water depth color, crest foam, wave / surface GLSL, reflections; rain and snow shape, size, density and shaders, the lightning look, and
particles for the game's own weather (`engine.weather.define`): `44-water-weather-look-hooks.md`.
