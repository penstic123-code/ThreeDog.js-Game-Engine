# Owning lights, fog and exposure yourself

The normal way to change lights, fog, exposure and the sky is `engine.look.<part>.set` / `patch` ([recipe 52](52-look.md)): the sky keeps
driving them over the day, and your values sit on top. This page is the next step, for when that is not enough: your own fog math, exposure over
the day, extra sky layers, and taking a light or the fog away from the sky entirely. Sky basics are in `08-weather-sky.md`, clouds and ground color in
`36-sky-ground-plant-looks.md`, environment lighting in `34-environment-lighting.md`. Each section starts with the `look` call and ends with the exit.

## Lights: override, take over, or switch off
The engine has one directional light (`engine.lights.sun`, also `engine.sky.sun`; moonlight at night, the shadows live on it) and one hemisphere
ambient (`engine.lights.hemi` = `engine.sky.hemi`). The sky module rewrites their color and intensity every frame from `style.sky.keyframes`,
so editing the three.js objects directly is overwritten (a dev warning says so). **Without the sky module** both lights are a bright placeholder
(hemi 1.2, white sun 2 at (40, 80, 30), no shadows).

```js
engine.look.lights.set({ sun: { color: '#ffd0a0', intensity: 1.4 }, hemi: { intensity: 0.5 } }, { owner: 'dusk' });   // 1. override, any hour
engine.sky.modify('cave', { sun: 0.3, ambient: 0.4 });                               // or a multiplier on top of the day cycle (recipe 52)

engine.use(sky({ sun: 'manual' }));                     // 2. take over: the sky still aims the sun along the time of day and moves the shadow box
engine.sky.sun.color.set(0xffd0a0); engine.sky.sun.intensity = 1.4;   // yours now, never overwritten

engine.use(sky({ sun: false, hemisphere: false }));     // 3. switch off (a dungeon): both hidden, never touched; the dome still shows sun and moon
const torch = new THREE.PointLight(0xffa040, 6, 12); engine.add(torch);   // add your own lights before engine.start()
```

- `sky({ sun, hemisphere })`: `true` (default) the sky drives everything; `'manual'` color and intensity are the game's, the sun keeps its
  direction and shadow box; `false` `visible = false`, no shadows, never touched (lightning no longer flashes the ambient either).
- `createEngine({ lights: false })` goes one step further: the default sun and hemisphere are never put in the scene, `engine.lights.sun` / `hemi`
  stay as detached objects so nothing reads `undefined`. Use it for a scene lit entirely by your own lights.
- Shadows: only the engine sun's shadow is managed (`engine.look.shadow.set`). Your own `castShadow` lights work as in three.js, each costing its
  own shadow pass; `engine.setShadows(false)` turns theirs off too and restores them after.
- Add or remove lights before `engine.start()`: a light count that changes mid-play recompiles every material (one long frame). Many lamps or
  torches: `lightPool({ point: 6 })` keeps a fixed number of real lights and moves them to the nearest sources (recipe 09, "Lights and stalls").

## Fog: kind, color, density, your own math, or your own fog
```js
engine.look.fog.set({ far: 220, color: '#9bb' });                          // live: color, density, near, far, enabled, linear <-> exp2
engine.look.fog.set({ kind: 'height', height: 2, falloff: 0.08, density: 0.03 });   // valley mist; before the first frame (below)
engine.look.fog.patch('fog', `vec4 threedogFog(vec3 c, float depth, vec3 p){
  float f = 1.0 - exp(-fogDensity * depth);
  return vec4(mix(c, vec3(1.0, 0.85, 0.7), f * 0.3), f); }`);              // warm far haze
engine.look.fog.replace('manual');                                         // the exit: the sky stops writing scene.fog (or pass a THREE.Fog)
```
The same keys are the style layer `style.sky.fog` (or `sky({ fog })`), e.g. `fog: { kind: 'exp', color: 0xb8c4d0 }` or
`fog: { color: sky => sky.isDay ? 0xc8d0d8 : 0x10141c }` (a function, evaluated each frame).

- `kind`: `'linear'` (default, near = 0.3 x far) | `'exp'` | `'exp2'` | `'height'`. `color`: `'horizon'` (default; the dome's lower band fades to
  the fog color, so the horizon line never shows) | color | `(sky) => color`. `density` per meter (default derived from the fog distance);
  weather fog divides it, `engine.setFogFar` still moves the derived one.
- The `fog` hook replaces the fog math in every material, built-in or yours: `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)` returns
  (fog rgb, amount 0..1). In scope: `fogColor`, `cameraPosition`, `fogNear` / `fogFar` (linear) or `fogDensity` (other kinds),
  `THREEDOG_FOG_HEIGHT`, `THREEDOG_FOG_FALLOFF`.
- Limits: `'exp'`, `'height'` and the hook replace three's `fog_*` shader chunks once (three caches programs by material settings, not by
  source), so they only work before the first frame (style, `sky({ fog })`, or right after `createEngine`); later they throw. Color and density
  stay live. No custom uniforms (three copies fog uniforms into each material when it compiles); write constants. Materials with `fog: false`
  (the dome) are not fogged. A ShaderMaterial of your own gets the same fog when it sets `fog: true` and includes the fog chunks.
- Your own fog: `look.fog.replace('manual')` or `sky({ fog: 'manual' })` creates `scene.fog` once and never writes it (set its color / near /
  far, or assign your own object); `sky({ fog: false })` sets `scene.fog = null` (leave fog out of your materials with `fog: false` and fog in a
  post pass).
- Two engines on one page share three's fog chunks: the same custom `kind` / `height` / `falloff` / hook is fine (reference counted); a different
  custom setting throws. Plain `linear` / `exp2` do not touch the chunks.

## Exposure and tone mapping over time
```js
exposure: [[0, 1.6], [0.3, 1], [0.75, 1.1]]               // style: per time of day (0-1), wraps across midnight
exposure: sky => sky.isDay ? 1 : 1.5                       // or a function, evaluated by the sky module every frame
engine.look.tone.set({ exposure: 1.3 });                    // at run time: number, keyframes or function (replaces the style's)
engine.look.tone.set({ mapping: 'agx' });                   // 'aces' | 'agx' | 'neutral' | 'none'; materials recompile on their next draw
```
A plain number is set once (no per-frame work). Keyframes and functions need the sky module (it knows the time of day).

## Extra sky layers: rainbow, aurora, color bands
`style.sky.layers` (or `sky({ layers })`; at run time `engine.look.sky.patch('layer:aurora', { glsl, blend })`, recipe 52), drawn on the dome
after clouds and stars; none by default:

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
particles for the game's own weather (`engine.look.weather.replace`): `44-water-weather-look-hooks.md`.
