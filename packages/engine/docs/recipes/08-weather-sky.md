# Add weather or change the sky

**In this recipe**: 1. Switching weather · 2. The game's own weather table · 3. Sky colors, sun, stars (and the sky color for your own shader) · 4. Time and brightness · 5. Verify · 6. Day and night in game logic · 7. Wet roads · 8. Clouds · 9. Extra sky layers · 10. Flat backdrop

Modules: `sky()` (draws the dome from `engine.calendar`, sun and moon, and computes the signals; it writes no light, fog or exposure, those are your `picture/` code, recipe 62; the time itself is `calendar()`, recipe 06), `weather()` (the game's weather types, smooth transitions, rain and snow,
lightning; their picture is `weather({ rain, snow, lightning })`, recipe 44). The engine has only a neutral fallback.

```js
engine.use(sky({ keyframes: ROWS, sunSize: 600, clouds: { coverage: 0.6 }, dim: { stars: false } }));   // start values
engine.uniforms.uSunBrightness.value = 4;        // sun, moon, star and dome cloud numbers: engine.uniforms, the dome's own objects, on both renderers
engine.uniforms.uCloudCover.value = 0.8;    // also uSunSize uSunGlow uMoonSize uMoonBrightness uMoonColor uStars uStarScale uSkyCurve uSkyCloudScale uSkyCloudSpeed uCloudOpacity uCloudSoft uCloudColor uCloudShade
engine.sky.top = boss ? '#400' : null;      // plain fields, read each frame: top, horizon (color over the keyframes, null = keyframes), orbit.tilt / sway, dim.tint / stars
engine.sky.backdrop = 0x335577;             // one flat color in place of the dome; null gives the dome back
engine.sky.keyframes(NIGHT_ROWS);           // the day's rows, live
engine.sky.clouds({ glsl, tsl });           // your cloud function; null = the built-in kind
engine.sky.layer('aurora', { glsl, tsl, blend: 'add' });   // a named dome layer; null removes it
const mySky = new THREE.Mesh(skyGeometry, skyMaterial);   // or a skybox name, a Texture
engine.sky.replace(mySky);                  // skybox name | Texture | CubeTexture | Object3D, never written; null gives the dome back, false draws no sky
mySky.material.uniforms.sunPosition = engine.uniforms.uSunDir;   // the same Vector3, refreshed every frame
```

WebGPU (recipe 56): same dome as a node material. Hooks take `{ glsl, tsl: (ctx) => vec4 }` ([52](52-around-the-picture.md#tsl-forms)); GLSL alone throws `[webgpu-needs-tsl]`. Own sky: three's `SkyMesh` via `engine.sky.replace`, or a dome of your own with a node material (the `ShaderMaterial` below is the WebGL form): a `MeshBasicNodeMaterial` with `side: THREE.BackSide`, `fog: false`, `depthWrite: false`, `depthTest: false`, and a `colorNode` built on the view direction (world position minus camera position, normalized), on a sphere that follows the camera.

The sky follows one contract: **inputs** time, weather, season,
**outputs** the dome and the background, plus the shared `engine.uniforms`
(`uSunDir`, `uSunColor`, `uDaylight`, `uTimeOfDay`, `uSkyTop`, `uSkyHorizon`, `uWind`, `uWeatherCloud`, `uRain`, `uSnow`, `uWeatherLight`, `uWeatherFog` (the weather state writes the last six every frame), season tints) and events (`day:start`, `season:change`, `weather:change`) that wind,
rain and vegetation read. The keyframes are only the default implementation: `engine.sky.replace` swaps the whole dome and everything else keeps running (the whole sky module is
`engine.use(mySky(), { replaces: 'sky' })`).

### Your own sky object: what `engine.sky.replace(obj)` does with it
The engine hides its dome, adds `obj` to the scene root when it has no parent yet (and removes it again on `replace(null)` only then), and from
then on **never moves, scales or writes it**: it does not follow the camera, is not scaled to the far plane and is not exempted from culling.
(The built-in dome does all three itself.) So a dome of your own must, on its own:

- **contain the camera and stay inside the far plane**: either a fixed sphere big enough for everywhere the camera goes (radius < `camera.far`,
  which the engine pulls in to the view range unless you take it: `engine.autoView.manual('far')`), or one that follows the camera; or skip
  depth altogether as below, so the radius no longer matters;
- **compute the view direction per pixel from world space**: pass `worldPosition - cameraPosition` (linear, safe to interpolate) as the
  varying and do every non-linear step (normalize, `atan`, projecting onto a cloud plane, noise) in the fragment shader. A direction taken from
  the vertex's local `position`, or a non-linear value computed per vertex, is wrong once the dome is off-centre or its triangles are big:
  that is where arcs bend and seams show at the corners of the sphere's faces;
- draw behind everything, as the block below does.

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
engine.sky.replace(sky);
```
Time of day still reaches it through `engine.uniforms` (`uSunDir`, `uDaylight`, `uTimeOfDay` ...): put them in its `uniforms` to follow the day.

## 1. Switching weather / automatic weather (main.js)
```js
engine.weather.set('rain', { seconds: 20 });          // transition to rain over 20 seconds (a type of the game's table, see 2)
engine.weather.set('storm', { seconds: 0 });          // at once: the full storm before the next step (a screenshot or test right after the call)
engine.weather.setAuto(true);            // change weather at random (openWorld({ camera: 'follow', autoWeather: true }) also works)
engine.events.on('weather:lightning', () => { /* thunder */ });
engine.events.on('weather:change', ({ from, to }) => { /* once per change of name, when the blend starts; set() with the same name again does not fire */ });
```

## 2. The game's own weather table (example: a desert)
`weather({ types })` is the whole list of the game's weather; without it there is only a calm `clear` (the engine assumes no climate). Seven temperate
ones (clear cloudy overcast rain storm snow fog) are an opt-in preset: `weather(presets.weather.temperate)`; extend with
`types: { ...presets.weather.temperate.types, dust: {...} }`.
The preset supplies types and an `autoPool`; the weather changes by itself only with `auto: true` (or `engine.weather.setAuto(true)`). To pin one
for a picture: `engine.weather.set('clear')`, or a shot's `--weather clear` (it also turns `auto` off); a shot prints the weather under the picture.
Left-out fields are calm (no cloud, rain, snow, grey, lightning; sun, fog, wind 1). There is no patch option for one field
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
0-1, `grey` how gray the sky turns, `lightning` lightning (a type above 0.5 strikes). A table where nothing rains or snows builds no particles.
With openWorld the weather module is already installed; pass its options through the preset: `openWorld({ camera: 'follow', weather: { types, autoPool } })`.

## 3. Changing sky colors, sun, stars
`sky({ keyframes })`:
`[time 0-1, zenith color, horizon color, sun color, ambient intensity]`, interpolated by time; the rows are sorted and
run from time 0 to time 1, else the sky throws (both ends are midnight: give the last row the first row's values, or the colors jump there). What each column drives
is on `keyframes` in `SkyPictureOptions`, `types/world.d.ts`;
also `sunSize sunGlow starDensity clouds` (defaults and ranges there too; `hoursPerDay` is timing, so it is a
`calendar()` option, not a sky key). All of these are `sky({ ... })` start values; at run time use the entries at the top of this page. `sky({ sun | hemisphere | fog })`
throw naming what to write in your `picture/` code.
**Day and night brightness** is your `picture/` code: the sky lights nothing. Read `uDaylight` and write your own lights (recipe 62), and check with `shot --time 12:00` and
`--time 22:00`. The keyframes only color the dome; the ambient column also dims a skybox and the weather's sky tint. `engine.sky.environment({ into: engine.scene })` builds an environment map
from the dome (outdoor reflections show the sky, not a studio; it darkens by itself), recipe 34.

### Sky color for my shader (horizon color, zenith color)
A shader of your own that should meet the sky (a sea fading to the horizon, distant cards, a reflection) reads the colors the sky draws this frame:
`engine.uniforms.uSkyHorizon` and `engine.uniforms.uSkyTop` (`THREE.Color`, linear). They hold the keyframes, `engine.sky.top` / `horizon`,
the weather's grey tint and lightning; with a backdrop the horizon is the backdrop color. A fog of yours that should melt into the sky copies
it in `engine.onRender` (recipe 34). Share the object, do not copy it in `onFrame`: `onFrame` runs before the sky updates, so a copy is one
frame old (after a time jump, the first picture shows the old hour's color).
```js
const sea = new THREE.ShaderMaterial({ uniforms: { uHorizon: engine.uniforms.uSkyHorizon, uTop: engine.uniforms.uSkyTop, uSunDir: engine.uniforms.uSunDir },
  fragmentShader: '... gl_FragColor = vec4(mix(base, uHorizon, fresnel), 1.0); #include <tonemapping_fragment> #include <colorspace_fragment>' /* ... */ });
engine.uniforms.uSkyHorizon.value.getHexString();   // read it in JS too (game logic, a HUD swatch)
```
`engine.sky.horizon` is the override a game set (`null` = the keyframes), not the drawn color.

## 4. Time and brightness (game code)
```js
await engine.skip({ to: '19:30' });   // jump forward to a time: timers, calendar.at / daily, day:start fire on the way (needs a calendar dayLength; recipe 06)
engine.mod('clock.rate', { owner: 'game', set: 0 });   // the calendar and calendar seconds stop together, so the sky stops moving (set: 2 = double speed; remove() undoes it)
```
**The sky draws the calendar's time; it does not own it.** Day, time of day, seasons and day length are the `calendar()` module (recipe 06 "The time table");
the sky reads `engine.calendar.timeOfDay` each frame to place the sun and blend the keyframes, and `engine.calendar.season` for the season tint.
Without a calendar, `sky({ time: '18:30' })` draws that one fixed time (an arena, a museum diorama, a space station window); with a calendar,
`sky({ time })` warns and goes unused (start the day with `calendar({ time })`). A game that draws its own sky (a skybox shader, a 2D painted backdrop) keeps the
calendar and reads it the same way; a game indoors keeps the calendar and installs no sky.
Fixed dusk in an open world: `openWorld({ time: 18.5 / 24, ... })` (a 0-1 fraction of the day; goes to the calendar) and do not pass
`calendar: presets.calendar.cycle` (the template does; the cycle is what moves the clock). `engine.sky.isDay` is `sunHeight > 0` with `sunHeight = sin((timeOfDay - 0.25) * 2π)`: true strictly between timeOfDay 0.25 and 0.75 (06:00 to 18:00 on the default 24-hour face; with `hoursPerDay: H` the same fractions, 0.25H to 0.75H), false at exactly 06:00 and 18:00, so 18:30 already reads as "night" in `describe().time.isDay`. `daylight` = `max(0, sunHeight)`. Keyframes only change colors, not this flip.
`engine.calendar.isDay` / `daylight` are the same formula from the clock (they work with no sky); the sky's are what it draws (its fixed time without a calendar).
An audio rule's `time` condition (from the calendar) takes `'day'`, `'night'` or a range `['18:00', '06:00']`; anything else warns once.
Seasons are off by default (`engine.calendar.season` is `null`, no `season:change`); name them to turn them on, `calendar({ seasons: [...] })` or `presets.calendar.fourSeasons` (recipe 06).
`engine.applyState({ season: 'winter' })` (or `?season=winter`) jumps `calendar.day` to that season's first day, time of day kept; it needs
`calendar({ seasons })`, and a wrong name throws with the calendar's list.

The lights and the fog are your own three.js objects, so nothing overwrites them. To darken or tint everything (a cave, a horror segment), your `picture/` code reads one signal of yours and multiplies
it in with the weather's (`uWeatherLight`, `uWeatherFog`); the sky color has its own shared points, which stack with the weather's without overwriting it ([recipe 55](55-mods-time-wrap.md#picture-points-follow-the-same-rule)):
```js
const cave = engine.mod('sky.tint', { owner: 'cave', value: { color: 0x402030, amount: 0.5 } });   // amount = zenith, horizon: = horizon
cave.remove();                                                                                       // leave the cave
```
`sky.flash` adds, `sky.tint` / `ground.cover` entries blend weighted by their amount, `{ for: 3 }` ends one by itself. A tint color dims with the sky's own light unless `engine.sky.dim.tint = false`.

## 5. Verify
- Text: `npm run shot -- / --time 19:30 --weather dust --wait 2 --describe-only`, then look for "Time: 19:30..." and "Weather: dust (rain 0, snow 0, fog 0.35)".
  `describe().weather` has `name progress rain snow fog wind cloud`; `describe().time` has `clock day season isDay dayLength rate`.
- Take a screenshot only after the picture changed: `npm run shot -- / --time 19:30 --weather dust`.

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

## 8. Clouds: `sky({ clouds })`
Keys and defaults are `SkyCloudOptions` in `types/world.d.ts`; at run time the numbers are the `engine.uniforms` of the block at the top of this page.
`coverage` multiplies the weather's cloud amount. A `sky()` without `clouds` starts with the cover at 0: write `uCloudCover` to show any.

Why a thin band at the horizon with `kind: 'plane'`: the plane projection divides by height, so near the horizon one screen pixel covers a lot of cloud plane
and the noise is dense and small; overhead one pixel covers little and the same coverage looks sparse. For a sky full of big clouds use
`kind: 'cumulus'`, or raise `horizon` and lower `scale`. Cost: both are one 2D pass over the dome (no ray marching); cumulus does about
2.7x the noise work of plane on the cloudy pixels (pixels below the horizon or with no cloud cover skip it). Cloud shadows on the ground
(the signal `engine.uniforms.uCloudShadow`, a separate setting, off until written) follow the same weather cover, so more clouds still means more shadow.
Their two-noise shape is fixed; strength, scale and speed are `uCloudShadow`, `uCloudShadowScale`, `uCloudShadowSpeed`.

```js fragment
sky: { clouds: { kind: 'cumulus', coverage: 1, scale: 0.45, color: 0xfff4e4, shade: 0x8a9cb8, speed: [0.003, 0.001] } }
```

### Your own cloud function
`engine.sky.clouds(glsl | { glsl, tsl, uniforms })` is the one way in (a `glsl` key in `sky({ clouds })` throws and names it). It recompiles the dome once, so call it at a scene change. The GLSL defines `threedogClouds` as in the example below; the dome calls it for every upper-hemisphere pixel with cover above 0.01, then does `mix(sky, rgb, a)`.
`dir` is the unit view direction (`dir.y > 0`), `sunDir` points at the sun (the moon is opposite), `night` runs 0 to 1, `lit` / `shade` are `clouds.color` / `clouds.shade`, `cover` is the weather's cloud amount times `clouds.coverage`. Return the final color (dim it at night yourself) and the opacity (apply your own horizon fade).
In scope: the GLSL noise helpers `float threedogHash(vec2 p)` and `float threedogNoise(vec2 p)`, the built-in cloud uniforms (`uSkyCloudScale`, `uSkyCloudSpeed`, `uCloudHorizon`, `uCloudFade`...) and
the patch's `uniforms` (declared for you; number, `THREE.Color`, `THREE.Vector2/3/4`, array of 2-4 numbers, or `THREE.Texture`). Change one later
with `engine.sky.dome.material.uniforms.uEdge.value = 0.1` (the WebGL dome). A bad `kind`, GLSL without the function, or an unsupported uniform value throws with the fix.
Flat painted cloud blobs with a hard edge, multiplied by a texture:
```js
// sky({ clouds: { color: 0xfff1dc, shade: 0x9aa8c4 } }) gives lit and shade; the function goes through the hook
engine.sky.clouds({ uniforms: { uPaper: paperTexture, uEdge: 0.06 },   // paperTexture: any THREE.Texture, repeat wrapping
  glsl: `vec4 threedogClouds(vec3 d, float time, vec3 sunDir, float night, vec3 lit, vec3 shade, float cover){
    vec2 p = d.xz / (d.y + 0.5) * 0.4 + vec2(0.004, 0.002) * time;
    float n = threedogNoise(p) * 0.65 + threedogNoise(p * 2.3 + 5.0) * 0.35;
    float a = smoothstep(1.0 - cover, 1.0 - cover + uEdge, n);                          // hard edge
    float up = clamp(0.5 + (n - threedogNoise(p + sunDir.xz * 0.1)) * 6.0, 0.0, 1.0);  // sun side
    vec3 c = mix(shade, lit, up) * texture2D(uPaper, p * 3.0).rgb * (0.35 + 0.65 * (1.0 - night));
    return vec4(c, a * smoothstep(0.0, 0.1, d.y));
  }` });
```

## 9. Extra sky layers: rainbow, aurora, color bands
`engine.sky.layer(name, spec)`, drawn on the dome after clouds and stars; none by default:

```js
engine.sky.layer('aurora', { blend: 'add', uniforms: { uAurora: [0.2, 1, 0.6] }, glsl: `vec4 threedogSkyLayer(vec3 d, float time, vec3 sunDir, float night){
  float band = smoothstep(0.25, 0.45, d.y) * (1.0 - smoothstep(0.55, 0.8, d.y));
  float n = threedogNoise(vec2(d.x * 4.0 + time * 0.05, d.z * 2.0));
  return vec4(uAurora, band * n * night); }` });
```
Signature `vec4 threedogSkyLayer(vec3 dir, float time, vec3 sunDir, float night)` returns (rgb, amount); `dir` covers the whole sphere, so `dir.y` goes below 0. `blend: 'mix'` (default) or `'add'`;
`order` sorts layers (smaller first); `uniforms` work like the cloud function's. Each layer's function is
renamed (`threedogSkyLayer0`, `1`, ...), so layers from different parts of the game never clash.

## 10. Flat backdrop: no horizon at all
For a scene that should have no horizon (a menu stage, a board game, a diorama):
```js fragment
sky: { backdrop: 0xefebe4 },                                       // one color
engine.sky.backdrop = engine.sky.isDay ? 0xefebe4 : 0x2c3346;           // live, from your own frame code; null gives the dome back
```
- Hides the dome (no gradient, horizon line, sun / moon disk, stars or clouds) and sets `scene.background` to the color. A plain background
  color is not tone mapped, so what you write is what shows.
- The keyframes still drive the signals (`uSunDir`, `uDaylight`), and `uSkyHorizon` reports the backdrop, so a fog that copies it fades far things into the backdrop.
- It takes a color, not a function (a function throws). A color that follows something is a write from your frame code: to fade toward gray in snow,
  `engine.sky.backdrop.lerpColors(dry, gray, engine.weather.current.snow * 0.3)` changes the `THREE.Color` in place (reuse the Color objects; it runs every frame).
- While a backdrop is on it wins over a skybox given to `engine.sky.replace`: set it to `null` first.
