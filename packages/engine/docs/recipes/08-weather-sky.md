# Add weather or change the sky

**In this recipe**: 1. Switching weather · 2. The game's own weather table · 3. Sky colors, sun, stars (and the sky color for your own shader) · 4. Time and brightness (how a game's value and the weather multiply) · 5. Verify · 6. Day and night in game logic · 7. Wet roads

Modules: `sky()` (draws day/night from `engine.calendar`, sun and moon, fog; the time itself is `calendar()`, recipe 06), `weather()` (needs sky; the game's weather types, smooth transitions, rain and snow,
lightning). All look data lives in the style; the engine has only a neutral fallback.

```js
// 1. keyframes (default): style.sky.keyframes / style.exposure lists drive the day; nothing to write
// 2. a function of the frame context, fed by one call: any key marked fn (fog color / near / far / density, sky top / horizon / backdrop, lights, exposure)
engine.look.fog.set({ color: ({ state }) => state.boss ? '#400' : 'horizon' });  engine.look.state({ boss: true });
// 3. your own three.js sky (three/addons Sky, a ShaderMaterial dome, a skybox): never written; time / weather keep flowing through engine.uniforms
engine.look.sky.replace(mySky);  mySky.material.uniforms.sunPosition = engine.uniforms.uSunDir;   // the same Vector3, refreshed every frame
```

WebGPU (recipe 56): same dome and fog kinds as node materials. Hooks take `{ glsl, tsl: (ctx) => vec4 }` ([52](52-look.md#tsl-forms)); GLSL alone throws `[webgpu-needs-tsl]`. Own sky: three's `SkyMesh` via `look.sky.replace`.

The sky follows one contract: **inputs** `{ time, weather, season, day, state, sky }` (state = what the game gave `engine.look.state(...)`),
**outputs** sun direction / color / intensity, hemisphere, fog, environment, exposure and background, plus the shared `engine.uniforms`
(`uSunDir`, `uDaylight`, `uTimeOfDay`, `uWind`, `uCloud`, season tints) and events (`day:start`, `season:change`, `weather:change`) that wind,
rain and vegetation read. The keyframes are only the default implementation: a function replaces one key, `replace` the whole dome, and
everything else keeps running (`replace` swaps the one thing a part draws; the whole sky module with time, lights and fog is
`engine.use(mySky(), { replaces: 'sky' })`, recipe 52 [verbs](52-look.md#verbs)). The function gets `{ time, weather, season, day, state, sky }`: write `({ sky }) => sky.isDay ? ...`.

### Your own sky object: what `look.sky.replace(obj)` does with it
The engine hides its dome, adds `obj` to the scene root when it has no parent yet (and removes it again on `replace(null)` only then), and from
then on **never moves, scales or writes it**: it does not follow the camera, is not scaled to the far plane and is not exempted from culling.
(The built-in dome does all three itself: an `onBeforeRender` copies the camera position and scales it to `0.9 × camera.far`.) So a dome of
your own must, on its own:

- **contain the camera and stay inside the far plane**: either a fixed sphere big enough for everywhere the camera goes (radius < `camera.far`,
  which the engine pulls in to the view range unless you take it: `engine.look.view.manual('far')`), or one that follows the camera; or skip
  depth altogether as below, so the radius no longer matters;
- **compute the view direction per pixel from world space**: pass `worldPosition - cameraPosition` (linear, safe to interpolate) as the
  varying and do every non-linear step (normalize, `atan`, projecting onto a cloud plane, noise) in the fragment shader. A direction taken from
  the vertex's local `position`, or a non-linear value computed per vertex, is wrong once the dome is off-centre or its triangles are big:
  that is where arcs bend and seams show at the corners of the sphere's faces;
- draw behind everything: `gl_Position = clip.xyww` (depth 1), `depthWrite: false`, `frustumCulled = false`, `renderOrder` well below the scene,
  `side: THREE.BackSide`, `fog: false`.

```js
const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: { uTop: { value: new THREE.Color('#3b6fb6') }, uLow: { value: new THREE.Color('#cfe3f2') } },
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vDir = w.xyz - cameraPosition;                       // linear: interpolates correctly; normalize in the fragment shader
      gl_Position = (projectionMatrix * viewMatrix * w).xyww;   // depth 1: never clipped by far, never in front of anything
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uTop, uLow; varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      gl_FragColor = vec4(mix(uLow, uTop, smoothstep(0.0, 0.6, d.y)), 1.0);
      #include <colorspace_fragment>
    }`,
}));
sky.frustumCulled = false; sky.renderOrder = -1000;
sky.onBeforeRender = (r, s, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };   // centred on the camera: any radius works
engine.look.sky.replace(sky);
```
Time of day still reaches it through `engine.uniforms` (`uSunDir`, `uDaylight`, `uTimeOfDay` ...): put them in its `uniforms` to follow the day.

## 1. Switching weather / automatic weather (main.js)
```js
engine.weather.set('rain', { seconds: 20 });          // transition to rain over 20 seconds (a type of the game's table, see 2)
engine.weather.set('storm', { seconds: 0 });          // at once: the full storm before the next step (a screenshot or test right after the call)
engine.weather.setAuto(true);            // change weather at random (openWorld({ camera: 'follow', autoWeather: true }) also works)
engine.events.on('weather:lightning', () => { /* thunder */ });
```

## 2. The game's own weather table (example: a desert)
`weather({ types })` is the whole list of the game's weather; without it there is only a calm `clear` (the engine assumes no climate). Seven temperate
ones (clear cloudy overcast rain storm snow fog) are an opt-in preset: `weather(presets.weather.temperate)`; extend with
`types: { ...presets.weather.temperate.types, dust: {...} }`.
The preset supplies types and an `autoPool`; the weather changes by itself only with `auto: true` (or `engine.weather.setAuto(true)`). To pin one
for a picture: `engine.weather.set('clear')`, or a shot's `--weather clear` (it also turns `auto` off); a shot prints the weather under the picture.
Left-out fields are calm (no cloud, rain, snow, grey, lightning; sun, fog, wind 1). The style's `style.weather.types` only fills fields the game's
table leaves out, for types the game has (the table's own numbers win, a preset counts as the game's). There is no patch option for one field
of a preset type: spread that one type, `const T = presets.weather.temperate.types; weather({ types: { ...T, rain: { ...T.rain, fog: 0.5 } } })`.
```js
import { createEngine, presets, sky, weather } from 'threedog';
engine.use(sky(), weather({
  types: { clear: { cloud: 0.1 }, dust: { cloud: 0.5, sun: 0.6, fog: 0.35, wind: 2.2, grey: 0.4, heat: 1 } },   // heat: a field of the game's own, blends too
  autoPool: ['clear', 'clear', 'dust'],     // candidates for automatic weather (repeats = higher probability; default: each type once)
}));
engine.weather.set('dust', { seconds: 15 });  engine.weather.current.heat;   // 0..1 during the change
```
Fields: `cloud` cloud cover 0-1, `sun` sunlight multiplier, `fog` fog distance multiplier (smaller = denser fog), `wind` wind strength, `rain`/`snow`
0-1, `grey` how gray the sky turns, `lightning` lightning. A table where nothing rains or snows builds no particles.
With openWorld the weather module is already installed; pass its options through the preset: `openWorld({ camera: 'follow', weather: { types, autoPool } })`.

## 3. Changing sky colors, sun, stars (style)
`sky.keyframes` in the style (your pack's `index.js`):
`[time 0-1, zenith color, horizon color (= fog color), sunlight color, sunlight intensity, ambient intensity]`, interpolated by time; the rows
run from time 0 to time 1 (both midnight: the first row at 0, the last at 1 with the same values), else the sky throws. What each column drives
(and which light carries the moonlight) is in `api/style.md` under `keyframes`;
also `sunSize sunGlow moonSize starDensity clouds skybox shadow` (defaults and ranges in `api/style.md` too; `hoursPerDay` is timing, so it is a
`calendar()` option, not a style key). At run time every look key of `style.sky` is a `look.sky` param, one entry per value:
`engine.look.sky.set({ keyframes, moonSize, starScale, orbitTilt, dim: { stars: false } })`, a panorama is `engine.look.sky.replace('pano')`.
`sky()` takes only how the game lights its world (`time`, `fog`, `sun`, `hemisphere`, plus the `shadow` / `environment` blocks); `sky({ moonSize })`
throws naming the `look.sky.set` call.
**Day and night brightness** come from two columns: sunlight intensity and ambient intensity. With no `sky.keyframes` the sky uses a neutral gray
curve (night from 19:12 to 04:48, moonlight 0.4, ambient 0.35 against 3 / 1.2 at noon). The ambient column is the whole diffuse fill: the engine's neutral room
environment (the light Standard / Lambert / Phong materials get from `scene.environment`) takes the share `look.lights` `env.share` (0..1) of
it and the hemisphere light the rest, so a dark-night pack is dark on PBR surfaces too and the sun keeps its contrast by day. `env.intensity` keeps
one meaning, the absolute `scene.environmentIntensity`: a game or pack that writes it under a sky gets that value as written (fixed, not following
the day; the hemisphere light then keeps the whole budget, `describe().look.env.source.mode` `'absolute'`). `describe().look.env.source` says which map lights
them (`room` / `sky` / `asset:<name>` / `game`) and `followsTime`; `look.env.replace('sky')` builds it from the dome instead (outdoor reflections
show the sky, not a studio; it darkens by itself), an asset map is a fixed photo and does not follow. Check with `shot --time 12:00` and `--time 22:00`.
The look of rain and snow is in `style.weather.rain / snow` (shape, density, shaders, the game's own particles: recipe 44).

### Sky color for my shader (horizon color, zenith color)
A shader of your own that should meet the sky (a sea fading to the horizon, distant cards, a reflection) reads the colors the sky draws this frame:
`engine.uniforms.uSkyHorizon` and `engine.uniforms.uSkyTop` (`THREE.Color`, linear). They hold the keyframes, a `look.sky.set({ top, horizon })`,
the weather's grey tint and lightning; with `style.sky.backdrop` the horizon is the backdrop color. The fog in its default color (`'horizon'`) is
this same color every frame, at night and in rain too; it differs only when the game sets `look.fog.set({ color })`, or takes the fog
(`look.fog.manual()`, `scene.fog = ...`). Share the object, do not copy it in `onFrame`: `onFrame` runs before the sky updates, so a copy is one
frame old (after a time jump, the first picture shows the old hour's color).
```js
const sea = new THREE.ShaderMaterial({ uniforms: { uHorizon: engine.uniforms.uSkyHorizon, uTop: engine.uniforms.uSkyTop, uSunDir: engine.uniforms.uSunDir },
  fragmentShader: '... gl_FragColor = vec4(mix(base, uHorizon, fresnel), 1.0); #include <tonemapping_fragment> #include <colorspace_fragment>' /* ... */ });
engine.uniforms.uSkyHorizon.value.getHexString();   // read it in JS too (game logic, a HUD swatch)
```
`look.sky.value('horizon')` is the override a game set (`null` = the keyframes), not the drawn color.

## 4. Time and brightness (game code)
```js
await engine.skip({ to: '19:30' });   // jump forward to a time: timers, calendar.at / daily, day:start fire on the way (needs a calendar dayLength; recipe 06)
engine.mod('clock.rate', { owner: 'game', set: 0 });   // the calendar and calendar seconds stop together, so the sky stops moving (set: 2 = double speed; remove() undoes it); game seconds per day: calendar({ dayLength: 600 }); the three kinds of time are in recipe 06
engine.look.fog.set({ far: 300 });        // base fog distance (meters); weather multiplies it; terrain({ viewFog: true }) writes the layer below
```
**The sky draws the calendar's time; it does not own it.** Day, time of day and seasons are the `calendar()` module (recipe 06 "The time table");
the sky reads `engine.calendar.timeOfDay` each frame to place the sun and blend the keyframes, and `engine.calendar.season` for the season tint.
Without a calendar, `sky({ time: '18:30' })` draws that one fixed time (an arena, a museum diorama, a space station window); with a calendar,
`sky({ time })` throws (start the day with `calendar({ time })`). A game that draws its own sky (a skybox shader, a 2D painted backdrop) keeps the
calendar and reads it the same way; a game indoors keeps the calendar and installs no sky.
Fixed dusk in an open world: `openWorld({ time: 18.5 / 24, ... })` (a 0-1 fraction of the day; goes to the calendar) and do not pass
`calendar: presets.calendar.cycle` (the template does; the cycle is what moves the clock). `engine.sky.isDay` is `sunHeight > 0` with `sunHeight = sin((timeOfDay - 0.25) * 2π)`: true strictly between timeOfDay 0.25 and 0.75 (06:00 to 18:00 on the default 24-hour face; with `hoursPerDay: H` the same fractions, 0.25H to 0.75H), false at exactly 06:00 and 18:00, so 18:30 already reads as "night" in `describe().time.isDay`. `daylight` = `max(0, sunHeight)`. Keyframes only change colors, not this flip.
`engine.calendar.isDay` / `daylight` are the same formula from the clock (they work with no sky); the sky's are what it draws (its fixed time without a calendar).
A day-night cycle is `calendar({ dayLength: 360 })` or `calendar(presets.calendar.cycle)` (`presets.calendar.fourSeasons` includes it);
`hoursPerDay` changes the clock face. An audio rule's `time` condition (from the calendar) takes `'day'`, `'night'` or a range `['18:00', '06:00']`;
anything else warns once.
Seasons are off by default (`engine.calendar.season` is `null`, no `season:change`); name them to turn them on:
```js
calendar({ seasons: ['spring', 'summer', 'autumn', 'winter'], daysPerSeason: 28, dayLength: 360 });   // days advance only with a dayLength; or the preset: openWorld({ camera: 'follow', calendar: presets.calendar.fourSeasons })
calendar({ seasons: [{ name: 'wet', days: 10 }, { name: 'dry', days: 20 }], dayLength: 360 });   // seasons of their own length
```
**A direct write to** `engine.lights.sun.intensity / color`, `engine.lights.hemi` or `scene.fog` **takes that value over**: the sky stops writing it and
keeps yours, so the day cycle no longer changes it (warned once). To adjust and keep the cycle: `engine.look.lights.set(...)` / `look.fog.set(...)` or a
modifier layer below; to take it on purpose: `engine.look.lights.manual('sun')` (recipe 52 "Who writes it").
To darken or tint everything (a cave, a horror segment), add multipliers of your own on the look values; they stack with the weather's without
overwriting it ([recipe 52](52-look.md#how-look-values-stack)):
```js
const cave = [engine.mod('look.lights.sun.intensity', { owner: 'cave', mul: 0.3 }), engine.mod('look.lights.hemi.intensity', { owner: 'cave', mul: 0.4 }),
  engine.mod('look.fog.far', { owner: 'cave', mul: 0.5 }),                                          // enter the cave: entries multiply
  engine.mod('look.sky.tint', { owner: 'cave', value: { color: 0x402030, amount: 0.5 } })];         // amount = zenith, horizon: = horizon
cave.forEach(h => h.remove());                                                                 // leave the cave
```
These are ordinary shared points (recipe 55): the light and fog values multiply, `look.sky.flash` adds, `look.sky.tint` / `look.ground.cover`
entries blend weighted by their amount, `{ for: 3 }` ends one by itself. A game's own `look.lights.set({ sun: { intensity: 3 } })` is the base they
multiply: rain still dims it and the sunset still fades it (`engine.describe().shared['look.lights.sun.intensity'].how` says `arena 3 × weather 0.6`).
Write once and it stays in effect; no need to write every frame. For a gradual change, write a new value every frame.

## 5. Verify
- Text: `npm run shot -- / --time 19:30 --weather dust --wait 2 --describe-only`, then look for "Time: 19:30..." and "Weather: dust (rain 0, snow 0, fog 0.35)".
  `describe().weather` has `name progress rain snow fog wind cloud`; `describe().time` has `clock day season isDay dayLength rate`.
- Take a screenshot only after the look changed: `npm run shot -- / --time 19:30 --weather dust`.

## 6. Day and night in game logic
Gameplay reads day and night from the calendar: test `engine.calendar.isDay`, and fade with `engine.calendar.daylight` (0-1); they work with or
without a sky. Don't decide it from the clock text yourself, so a game with different day lengths or hours stays right. Lights and shop doors that
follow the time of day use `engine.calendar.between(...)` (its page: `api/calendar.md`).

## 7. Wet roads and puddles after rain
The engine gives the rain, not the wet look: `engine.weather.current.rain` (0-1) is the signal; what gets wet, how fast it dries and where
puddles collect are the game's decisions. Water fills the pores of a rough surface, so wet reads as darker and glossier together (lower `color`
and `roughness`); darker alone reads as dirt or shadow. Gloss only shows when there is something bright to reflect: the sky by day, at night
the lamps and windows as long streaks. A puddle needs a soft-rimmed mask; a hard cut-off makes opaque discs that read as holes. Judge it on a
shot at noon and at night, in rain and after. To compare with your own result afterwards, the technique example `wet-road`
(`threedog examples pull wet-road`) shows one way, with a dry-out delay in game time.
