# Owning lights, fog and exposure yourself

The normal way to change lights, fog, exposure and the sky is `engine.look.<part>.set` / `patch` ([recipe 52](52-look.md)): the sky keeps
driving them over the day, and your values sit on top. This page is the next step, for when that is not enough: your own fog math, exposure over
the day, extra sky layers, and taking a light or the fog away from the sky entirely. Sky basics are in `08-weather-sky.md`, clouds and ground color in
`36-sky-ground-plant-looks.md`, environment lighting in `34-environment-lighting.md`. Each section starts with the `look` call and ends with the exit.

```js
// 1. keyframes (default): style.sky.keyframes / style.exposure lists drive the day; nothing to write
// 2. a function of the frame context, fed by one call: any key marked fn (fog color / near / far / density, sky top / horizon / backdrop, lights, exposure)
engine.look.fog.set({ color: ({ state }) => state.boss ? '#400' : 'horizon' });  engine.look.state({ boss: true });
// 3. your own three.js sky (three/addons Sky, a ShaderMaterial dome, a skybox): never written; time / weather keep flowing through engine.uniforms
engine.look.sky.replace(mySky);  mySky.material.uniforms.sunPosition = engine.uniforms.uSunDir;   // the same Vector3, refreshed every frame
```

## Lights: override, take over, or switch off
The engine has one directional light (`engine.lights.sun`; moonlight at night, the shadows live on it) and one hemisphere
ambient (`engine.lights.hemi`). The sky module rewrites their color and intensity every frame from `style.sky.keyframes`,
so editing the three.js objects directly is overwritten (a dev warning says so). **Without the sky module** both lights are a bright placeholder
(hemi 1.2, white sun 2 at (40, 80, 30), no shadows).

```js
engine.look.lights.set({ sun: { color: '#ffd0a0', intensity: 1.4 }, hemi: { intensity: 0.5 } }, { owner: 'dusk' });   // 1. override, any hour
engine.mod('look.lights.sun.intensity', { owner: 'cave', mul: 0.3 });                                  // or a multiplier on top of the day cycle (recipe 52)

engine.look.lights.manual(['sun.intensity', 'sun.color']);   // 2. take over: the sky still aims the sun along the time of day and moves the shadow box
engine.lights.sun.color.set(0xffd0a0); engine.lights.sun.intensity = 1.4;   // yours now, never overwritten

engine.use(sky({ sun: false, hemisphere: false }));     // 3. switch off (a dungeon): both hidden, never touched; the dome still shows sun and moon
const torch = new THREE.PointLight(0xffa040, 6, 12); engine.add(torch);   // add your own lights before engine.start()
```

- `sky({ sun, hemisphere })`: `true` (default) the sky drives everything; `false` `visible = false`, no shadows, never touched (lightning no
  longer flashes the ambient either). Taking a value over is one call for every look value, `engine.look.<part>.manual(key)` (here
  `look.lights.manual('sun' | 'hemi' | 'sun.intensity' ...)`), not a sky() option; `manual(key, false)` hands it back.
- `createEngine({ lights: false })` goes one step further: the default sun and hemisphere are never put in the scene, `engine.lights.sun` / `hemi`
  stay as detached objects so nothing reads `undefined`. Use it for a scene lit entirely by your own lights.
- Shadows: only the engine sun's shadow is managed (`engine.look.shadow.set`). Your own `castShadow` lights work as in three.js, each costing its
  own shadow pass; `look.shadow.set({ enabled: false })` turns theirs off too and restores them after.
- Add or remove lights before `engine.start()`: a light count that changes mid-play recompiles every material (one long frame). Many lamps or
  torches: `lightPool({ point: 6 })` keeps a fixed number of real lights and moves them to the nearest sources (recipe 09, "Lights and stalls").

## Fog: kind, color, density, your own math, or your own fog
```js
engine.look.fog.set({ far: 220, color: '#9bb' });                          // live: color, density, near, far, enabled, linear <-> exp2
engine.look.fog.set({ kind: 'height', height: 2, falloff: 0.08, density: 0.03 });   // valley mist; materials recompile once (below)
engine.look.fog.patch('fog', `vec4 threedogFog(vec3 c, float depth, vec3 p){
  float f = 1.0 - exp(-fogDensity * depth);
  return vec4(mix(c, vec3(1.0, 0.85, 0.7), f * 0.3), f); }`);              // warm far haze
engine.look.fog.manual();                                                  // the exit: the sky stops writing scene.fog (or assign your own: scene.fog = new THREE.Fog(...))
```
The same keys are the style layer `style.sky.fog` (or `sky({ fog })`), e.g. `fog: { kind: 'exp', color: 0xb8c4d0 }` or
`fog: { color: ({ sky }) => sky.isDay ? 0xc8d0d8 : 0x10141c }` (a function, evaluated each frame).

- `kind`: `'linear'` (default, near = 0.3 x far) | `'exp'` | `'exp2'` | `'height'`. `color`: `'horizon'` (default; the dome's lower band fades to
  the fog color, so the horizon line never shows) | color | `({ time, weather, season, state, sky }) => color` (near / far / density take a function too). `density` per meter (default derived from the fog distance);
  an explicit density is kept as given (weather multiplies `far`, which moves only the derived one).
- The `fog` hook replaces the fog math in every material, built-in or yours: `vec4 threedogFog(vec3 color, float depth, vec3 worldPos)` returns
  (fog rgb, amount 0..1). In scope: `fogColor`, `cameraPosition`, `fogNear` / `fogFar` (linear) or `fogDensity` (other kinds),
  `THREEDOG_FOG_HEIGHT`, `THREEDOG_FOG_FALLOFF`.
- How: `'exp'`, `'height'` and the hook are one named shader patch, `fog`, on the semantic slots `fogPars` / `fog` (recipe 43), put on
  every built-in material in this engine's scene (yours too: three's own fog would draw another curve; `describe().owned['fog.patch']` lists
  them). Changing them later works and recompiles those materials once, so do it at a scene change, not every frame. Color and density stay live
  uniforms. No custom uniforms (three copies fog uniforms into each material when it compiles); write constants. Materials with `fog: false`
  (the dome) are not fogged. Your own ShaderMaterial and sprites keep three's plain fog.
- Your own fog is plain three.js: `scene.fog = new THREE.Fog(...)` (or `FogExp2`), and the engine stops writing it (there is no
  `look.fog.replace`); `look.fog.manual()` keeps the engine's `scene.fog` and the sky never writes it again (set its color / near / far); `sky({ fog: false })` sets `scene.fog = null` (leave fog out of your materials with `fog: false` and fog in a
  post pass).
- Two engines on one page each patch their own scene's materials, so they may use different fog kinds and hooks. Nothing rewrites
  `THREE.ShaderChunk`; plain `linear` / `exp2` add no patch at all.

## Exposure over time, and the tone curve
```js
exposure: [[0, 1.6], [0.3, 1], [0.75, 1.1]]               // style: per time of day (0-1), wraps across midnight
exposure: ({ sky }) => sky.isDay ? 1 : 1.5                      // or a function, evaluated by the sky module every frame
engine.look.tone.set({ exposure: 1.3 });                    // at run time: number, keyframes or function (replaces the style's)
engine.renderer.toneMapping = THREE.NeutralToneMapping;     // the curve: plain three.js; materials recompile on their next draw
```
A plain number is set once (no per-frame work). Keyframes and functions need the sky module (it knows the time of day). The curve is written
once when the engine creates its renderer (`style.toneMapping`, else AgX) and never again, so a direct write stays.

## Extra sky layers: rainbow, aurora, color bands
`style.sky.layers` (at run time `engine.look.sky.patch('layer:aurora', { glsl, blend })`, recipe 52), drawn on the dome
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
