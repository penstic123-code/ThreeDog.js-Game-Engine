# Lights, fog and exposure

Lights, fog and exposure are your own three.js code ([recipe 62](62-picture-code.md)): the sky computes signals and draws its dome, it writes none of them. This page covers what is left around
that: the placeholder lights, fog, the tone curve, extra sky layers. Sky basics are in `08-weather-sky.md`, clouds and ground color in
`36-sky-ground-plants.md`, environment lighting in `34-environment-lighting.md`.


## Lights: the placeholders, and your own
The engine has one directional light (`engine.lights.sun`) and one hemisphere (`engine.lights.hemi`): still white placeholders (sun 2 at (40, 80, 30) with soft shadows, hemi 1.2), so a scene
with no picture code is neutral gray and not black. Nothing moves them, with or without a sky.

```js
const engine = createEngine({ canvas, lights: false });                   // the placeholders stay out of the scene
const sun = new THREE.DirectionalLight(0xffd0a0, 2); engine.scene.add(sun, sun.target);   // add your own lights before engine.start()
engine.onRender(() => { sun.position.copy(engine.uniforms.uSunDir.value).multiplyScalar(100); sun.intensity = 2 * engine.uniforms.uDaylight.value * engine.uniforms.uWeatherLight.value; });
const torch = new THREE.PointLight(0xffa040, 6, 12); engine.add(torch);
```

- `createEngine({ lights: false })`: the default sun and hemisphere are never put in the scene, `engine.lights.sun` / `hemi`
  stay as detached objects so nothing reads `undefined`. Use it for a scene lit entirely by your own lights.
- Shadows: only the engine sun's box is managed. Your own `castShadow` lights work as in three.js, each costing its
  own shadow pass; `engine.shadows` (recipe 45) takes them when you hand them in, and `engine.shadows.enabled = false` turns every shadow off.
- Add or remove lights before `engine.start()`; what a change costs mid-play, and many lamps with `lightPool`: recipe 09 "Lights and stalls".

## Fog: plain three.js, signals, your own math
```js
const fog = engine.scene.fog = new THREE.Fog(0x99bbbb, 60, 220);        // or new THREE.FogExp2(color, density)
engine.onRender(() => {                                                 // a fog that follows the day and the weather: your picture/ code
  fog.color.copy(engine.uniforms.uSkyHorizon.value);
  fog.far = 220 / engine.uniforms.uWeatherFog.value;
});
```
There is no fog until your code makes one, and nothing writes it after that.

- Signals to read: `uSkyHorizon` is the color at the horizon, so fog in that color hides the line where the dome meets the ground; `uWeatherFog` is what the weather asks for, a
  multiplier your code applies; `uViewDistance` says how far the world is meant to be seen (`terrain({ viewFog: true })` writes it).
- Color, near, far and density are live. Adding or removing `scene.fog`, or changing its type, recompiles materials once: do it at a scene change, not every frame.
- Materials with `fog: false` (the dome) are not fogged.
- Your own fog math (height fog, a warm far haze): the `fogPars` and `fog` slots on a material, WebGL only (recipe 43), or your own `ShaderMaterial`:
  `applyEffects(material, { patches: [{ name: 'haze', slot: 'fog', glsl: 'float f = 1.0 - exp(-fogDensity * vFogDepth); gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.85, 0.7), f * 0.3);' }] })`.
- Check the result with `engine.describe('picture').picture.fog`; `threedog shot` says how much of the picture the fog makes up.

## Exposure and the tone curve
```js
engine.renderer.toneMappingExposure = 1.3;
engine.onRender(() => { engine.renderer.toneMappingExposure = 1 + 0.5 * (1 - engine.uniforms.uDaylight.value); });   // over the day: your picture/ code
engine.renderer.toneMapping = THREE.NeutralToneMapping;     // the curve; materials recompile on their next draw
```
The engine picks no curve: `renderer.toneMapping` stays three.js's default (`NoToneMapping`) until your code writes it. A curve of your own is a post effect in the `'tone'` slot (recipe 52).

## Extra sky layers: rainbow, aurora, color bands
`engine.sky.layer(name, spec)`, drawn on the dome after clouds and stars; none by default:

```js
engine.sky.layer('aurora', { blend: 'add', uniforms: { uAurora: [0.2, 1, 0.6] }, glsl: `vec4 threedogSkyLayer(vec3 d, float time, vec3 sunDir, float night){
  float band = smoothstep(0.25, 0.45, d.y) * (1.0 - smoothstep(0.55, 0.8, d.y));
  float n = threedogNoise(vec2(d.x * 4.0 + time * 0.05, d.z * 2.0));
  return vec4(uAurora, band * n * night); }` });
```
Signature `vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)` returns (rgb, amount). `blend: 'mix'` (default) or `'add'`;
`order` sorts layers (smaller first); `uniforms` like `clouds.uniforms`, live in `engine.sky.dome.material.uniforms.uAurora.value`. Each layer's function is
renamed (`threedogSkyLayer0`, `1`, ...), so layers from different parts of the game never clash. Whole replacement: `engine.sky.replace(panorama)` or
hide `engine.sky.dome` and add your own background.

## Water and weather particles
Water depth color, crest foam, wave / surface GLSL, reflections; rain and snow shape, size, density and shaders, the lightning picture, and
particles for the game's own weather (`engine.weather.define`): `44-water-weather-hooks.md`.
