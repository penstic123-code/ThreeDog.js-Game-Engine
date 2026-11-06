# The whole picture in plain three.js: signals in, picture out

**In this recipe**: the `picture/` folder (0), setup (1), signals (2), the hook (3), rules for a bigger game (3b), wiring and who wrote a value (3c), the library (3d), shared values (3e),
picture parts: code from different sources in one game (3f), a flat look (4), pixel art (4b), what the engine still does (5), checking (6).

Any picture (flat illustration, toon, painterly, realistic) can be written as plain three.js in one folder of the game, the picture code: its own
lights, materials, fog, sky colors and post passes. The engine hands it signals (time of day, weather) and keeps doing the engineering
(streaming, shadows, saves, tests); it writes none of the picture's values. Working example: `examples/plain-picture/` (page `/plain-picture.html`,
a night street in a flat-illustration look; `picture/` is the whole picture). Every value has one writer, a line in your code, so
"why is this wall black" has one place to look.

## 0. The `picture/` folder
`threedog new-game` generates it, with a gray start; it is yours to change or delete. One file per job, so the picture never piles up in one place:
```
picture/
  index.js       wiring: creates the parts, calls each part's update(signals) in one engine.onRender; no values here
  palette.js     colors and key values for the whole game, including the tone curve
  lights.js      lights: the mapping from signals to lights
  materials.js   materials by name; other code asks for picture.materials.wall and never builds its own
  sky.js         add when the game has its own sky or fog
  post.js        add when the game has post effects
  shaders/*.glsl your shader code; saving one hot-reloads it
  areas/<name>.js a large game's overrides for one area (a cave, an interior): only what differs
```
To add a part, write a file that returns `{ update(signals) }` and call it from `index.js`:
```js
// picture/sky.js: the engine's dome stays, fog is the game's
export function createSky(engine) {
  engine.scene.fog = new THREE.Fog(palette.fog.color, palette.fog.near, palette.fog.far);
  return { update(s) { engine.scene.fog.color.copy(night).lerp(day, s.uDaylight.value); } };
}
// picture/post.js: engine.post.add takes a three.js Pass and keeps the chain in order (recipe 52)
export function createPost(engine) {
  engine.post.add(new ShaderPass(GrainShader), { name: 'grain' });
  return { update() {} };
}
```
Gameplay and level code use material names and signals only, so a picture change touches `picture/` alone.

## 1. Setup: the engine's placeholder lights off
```js
const engine = createEngine({ canvas, lights: false });            // no placeholder sun / hemisphere; this is the WebGL form: a new game also has `import 'threedog/tsl'` and `renderer: 'webgpu'`
engine.use(calendar({ time: '22:00' }),
  sky(),                                                             // computes the signals and draws the dome; writes no light or fog
  weather({ types: { clear: {}, rain: { rain: 1, cloud: 0.8 } } }));
engine.renderer.toneMapping = THREE.AgXToneMapping;                  // three.js's default (none) stands until you pick one
if (engine.sky) engine.sky.dome.visible = false;                     // when you draw your own sky (a gradient sphere, a skybox)
```
Without `calendar` and `sky()` there is no day and night: `uDaylight` stays 1 and `uSunDir` straight up. With only `calendar` the daylight and time signals still move, but the sun stays straight up; keep `calendar` + `sky` for a full day cycle even when you draw everything yourself.

## 2. The signals (`engine.uniforms`, each `{ value }`)
| Signal | Range | From |
|---|---|---|
| `uDaylight` | 0 night .. 1 noon (the sun's height) | calendar, else the sky |
| `uNight` | 0 by day .. 1 at night: the curve `lightPool` `dusk` lamps fade on, for lit windows and signs | calendar or sky |
| `uSunDir` | unit `Vector3` toward the sun | sky |
| `uSunColor` | `Color` of the sun now, from the keyframes (white with no sky): `sun.color.copy(...)` | sky |
| `uTimeOfDay` | 0-1 (0 midnight, 0.5 noon) | calendar, else the sky's fixed time |
| `uRain`, `uSnow`, `uWeatherCloud` | 0-1 | weather state |
| `uWind` | wind multiplier (1 = calm) | weather state |
| `uWeatherLight`, `uWeatherFog` | multipliers (1 = clear): apply them to your own light and fog distance | weather state |
| `uViewDistance` | how far the world is meant to be seen, meters (default 600): your fog's far; the stream radius without terrain | `terrain({ viewFog: true })` |
| `uFoliageTint`, `uGroundTint`, `uGroundCover` | season tints, snow cover | sky + calendar |
| `uSkyTop`, `uSkyHorizon` | the engine dome's colors (its neutral keyframes unless the game sets them) | sky |

Read `.value` in JS, or share the object in a shader (`uniforms: { uDaylight: engine.uniforms.uDaylight }`): one object, no copy. The sky
colors are the engine dome's picture, not physics: a styled game keeps its own palette and mixes them in only if it wants. Gameplay that should change the picture (a cutscene dims the world, a status effect tints it) goes through a signal of your
own, read by the picture code, so the picture still has one writer.

Written every frame: `uSkyTop` and `uSkyHorizon` take `engine.sky.top` / `engine.sky.horizon`, `uDaylight` and `uTimeOfDay` take a `daylight` / `timeOfDay` measure; a direct write is lost and warns once (`signal-overwritten`). `uSunDir` (the same vector as `engine.sky.sunDir`) and `camera.aspect` stay as written: `engine.autoView.manual('sunDir', false)` gives one back.

## 3. The hook: `engine.onRender`, not `onFrame`
```js
const sun = new THREE.DirectionalLight(0xffffff, 2), hemi = new THREE.HemisphereLight();   // made once in picture/lights.js
engine.onRender(() => {
  const day = engine.uniforms.uDaylight.value, rain = engine.uniforms.uRain.value;
  sun.position.copy(engine.uniforms.uSunDir.value).multiplyScalar(100);
  sun.intensity = 2.2 * day * (1 - rain * 0.6);
  hemi.color.copy(NIGHT.sky).lerp(DAY.sky, day);                    // your palette, your rule
  for (const m of walls) m.emissiveIntensity = 0.2 * (1 - day);     // flat look: the wall keeps its own color at night
});
```
`onRender` (default `'before'`) runs once per drawn frame after every module updated, so it reads this frame's signals. `onFrame` runs before
the modules' frame hooks: it would read last frame's values (and noon on the very first frame). Picture code uses `onRender` only.

## 3b. Rules that keep the folder working in a bigger game
- **One object's state goes through a name `picture/` exports.** Signals are global, but one street lamp shot out or one flickering sign is not. Gameplay calls
  a name of your own and never touches the light or the material:
  ```js
  // picture/index.js
  export const picture = { lights, materials, lamp: id => ({ off() { lamps.get(id).intensity = 0; } }) };
  // gameplay
  picture.lamp(hit.id).off();
  ```
  The engine has no such layer: the names are the game's.
- **`picture/` shaders follow the renderer.** A new game is on WebGPU and writes TSL (recipe 56); `ShaderMaterial` and `onBeforeCompile` do not run there, and a GLSL material
  on WebGPU stops at start and names itself. A `--webgl` game writes GLSL (recipe 43).
- **The picture reads the quality tier.** The engine cannot hold your code to it, so read `engine.tier` (`'low'` | `'high'`) for what costs: shadow map size,
  real light count, post effects. The generated `lights.js` sizes its shadow map this way.

## 3c. Wiring `picture/` parts
- **One `engine.onRender`, in `picture/index.js`.** It calls each part's `update(signals)` and holds no values. A part never adds its own hook: two hooks hide the order.
- **Order is the call order.** Put what others read first (`palette`, a part that computes this frame's mood from signals), then lights, sky, materials, post.
- **Who may write what:** one part owns each value; `lights.js` the lights, `sky.js` the fog and background, `materials.js` the materials, `post.js` tone and exposure.
  Another part that needs to change that value does not write it: it changes a signal of its own and the owner reads it.
- **Several steps in one function are fine** (`fog.color.copy(a); fog.color.lerp(b, t);`), and so is one state of the game writing a value that another state wrote in earlier frames.

Under the dev server (`npm run dev`, `threedog snap`) the engine records which line last changed each value:
```js
engine.describe('picture').picture.writers   // { values: { 'fog.far': { at: 'picture/sky.js:12', framesAgo: 3 }, 'light:sun.intensity': ... }, conflicts: [...] }
engine.explain({ picture: 'fog.far' })       // threedog explain picture fog.far
```
Names are `renderer.toneMapping`, `renderer.toneMappingExposure`, `scene.fog`, `fog.near | far | density | color`, `scene.environment`, `scene.environmentIntensity`,
`scene.background`, `scene.backgroundIntensity`, `light:<name>.intensity | color | groundColor | position`, `material:<name>.color | emissive | opacity | emissiveIntensity`.
`framesAgo` is how old the answer is: a value written every frame is looked at about twice a second, and `writtenSince: true` means it moved after that picture. Anything else,
a value set before it entered the scene, a console write, a bundled build (`threedog shot`, `npm test`), answers `not tracked` with the reason. Nothing is ever blocked.

**A conflict warning** reads `fog.far was written twice in one frame with different results: picture/sky.js:14, then picture/rival.js:3. The later write is what is drawn`, then the fix.
The first line's work never reaches the screen. Decide which part owns the value, delete the other write, or turn it into a signal or a shared value the owner reads. It warns once per value.
Both writes going through a shared helper count as one place, the helper's line: the warning cannot see past it.

## 3d. Save to the library, pull it out
A part of the picture that worked can go into your library (outside the repo, `~/.threedog/library`) and come back in the next game:
```
threedog lib add picture/flat-materials.js --kind picture --summary "Flat material family, emissive rises at night"
threedog lib add picture/shaders/ink.glsl --kind picture           # a .glsl file works the same
threedog lib list flat                                       # next game: look before writing your own
threedog lib pull flat-materials                             # lands in picture/ (a .glsl lands in picture/shaders/)
```
A picture entry is **one plain three.js file that exports a function**, so it has to stand alone. `lib add` refuses a file that imports its siblings
(`./palette.js`) and names them; the entry would arrive as a half. Take the numbers as parameters instead:
```js
/** Flat materials by name: a flat color plus an emissive copy of it that rises at night.
 *  @param {object} THREE three.js  @param {Record<string, number>} palette name → hex  @param {number} nightGlow emissive at full night */
export function flatMaterials(THREE, palette, nightGlow = 0.2) {
  const mat = {};
  for (const [k, hex] of Object.entries(palette)) mat[k] = new THREE.MeshLambertMaterial({ color: hex, emissive: hex, emissiveIntensity: 0 });
  return { mat, update(signals) {
    const night = 1 - Math.min(1, signals.uDaylight.value * 4);
    for (const m of Object.values(mat)) m.emissiveIntensity = nightGlow * night;
  } };
}
```
A day-and-night light group is the same shape: `dayNightLights(THREE, scene, { day, night })`. The copy in your game is yours: pull, then adapt it to that game's picture.

## 3e. Several parts change one picture value
A sunset and a cutscene both dim the sun. If each writes the light, the second one's end brings back a value that is already wrong. Make the value a shared point
(recipe 55): everyone changes it with `engine.mod`, and one place in `picture/` reads the result and writes three.js once.
```js
// picture/lights.js: the one writer
const level = engine.stacks.define('sun.level', { base: 1, min: 0, save: false });
const sun = new THREE.DirectionalLight(0xffffff, 2);
engine.onRender(() => { sun.intensity = 2.2 * engine.uniforms.uDaylight.value * level.value(); });

// anywhere else: nobody touches the light
const dusk = engine.mod('sun.level', { owner: 'sunset', mul: 0.6 });
const hold = engine.mod('sun.level', { owner: 'cutscene', mul: 0.3, for: 4 });   // 0.18 while both are on
dusk.remove();                                                                  // they end in any order
```
An amount that moves takes one entry and changes it: `const wet = ctx.mod('sun.level', { mul: 1 });` once in the install, then `wet.change(1 - 0.5 * rain)` each frame. Calling `ctx.mod` every frame would pile up entries. In a module use `ctx.mod`, not `engine.mod`: the change then goes with the module.
`describe().shared` shows who holds it and why it reads what it reads. A value only one part writes needs none of this: write the light.

## 3f. Picture parts: three.js code from different sources in one game
Code you write alone stays the plain functions of section 0, and pays nothing for this section. Use a part when code has to live beside code you did not write: an entry from the library,
another agent's sky, a rain from an old game. A part is an ordinary module with `type: 'picture'`. There is no new layer and no new way to write a picture: inside it is plain three.js.
```js
// picture/harbor-fog.js
import * as THREE from 'three';

export const harborFog = ({ near = 10, far = 200 } = {}) => ({
  name: 'harborFog', type: 'picture', provides: ['fog'],
  install(e, ctx) {
    e.scene.fog = new THREE.Fog(0x667788, near, far);
    const flare = new THREE.PointLight(0xffaa66, 2, 30);
    e.scene.add(flare);
    ctx.track(e.onRender(() => {                                  // reads signals, writes three.js
      e.scene.fog.far = far * (1 - 0.6 * e.uniforms.uRain.value);
      flare.intensity = 2 * (1 - e.uniforms.uDaylight.value);
    }));
    ctx.track({ remove() { e.scene.remove(flare); flare.dispose(); e.scene.fog = null; } });   // what it added goes with it
  },
});
```
`engine.use(harborFog())` installs it, `engine.unuse('harborFog')` removes it, and `engine.use(otherFog(), { replaces: 'fog' })` swaps it. A part may use its own hooks: the single
`engine.onRender` of 3c is how one author keeps one folder in order, and two parts from two sources have no shared wiring file.

**A value is one of three kinds, and each has one rule:**
| Kind | Example | Rule | On a collision |
|---|---|---|---|
| Only one can exist | the fog, the tone curve, the main light | take a slot: `provides: ['fog']` | a second claim stops at install (`shared-taken`); `{ replaces: 'fog' }` swaps on purpose |
| Several parties change it | rain and a cutscene both dim the sun | a shared value: `engine.stacks.define` and `engine.mod` (3e), one place writes three.js | combined by the formula |
| Just more things | another lamp, another mesh | add it | none, it only costs budget |

**The slot names**, so two sources spell a claim the same way (`PICTURE_SLOTS`, type `PictureSlot`). Slot names are free text, and a near miss of these in a picture module is warned about:
| Slot | Covers |
|---|---|
| `sky` | the sky behind everything; the engine's `sky()` holds it, so a sky of your own says `{ replaces: 'sky' }` or leaves `sky()` out |
| `fog` | `scene.fog`, `fog.near / far / density / color` |
| `tone` | `renderer.toneMapping`, `renderer.toneMappingExposure` |
| `environment` | `scene.environment`, `scene.environmentIntensity` |
| `background` | `scene.background`, `scene.backgroundIntensity` (a sky drawn this way takes `sky` and `background`) |
| `sun` | the light named `'sun'`: name your main light so, because the name is how another source and this table find it. Add `lights: false` to `createEngine`, or the placeholder sun shines as well |

A part that needs another one says `requires: ['sun']`. A shared value a part defines has to survive a reinstall: `e.stacks.has(n) ? e.stacks.get(n) : e.stacks.define(n, { base: 1, save: false })`.

**What the dev server reports** (`npm run dev`, `threedog snap`). It observes and blocks nothing; a bundled build has none of it. `describe('picture').picture.slots` shows who holds what, in every build.
- `picture-held`: a value in a held slot was written by anyone else, in any frame. It names the holder, the writer and both lines. Fix: delete the write, swap the holder, or make it a shared value.
  In `picture.writers.values`, a held value says `writer: 'holder'` or `writer: 'stray'`; `picture.writers.held` lists the strays.
- `picture-conflict`: two places wrote one value in one frame (3c), with the part names when they are parts.
- `picture-leftover`: a part went and left lights, objects, post effects, frame callbacks, or the fog, environment or background it wrote. It names each with its line; `picture.writers.leftovers` lists them.
  `ctx.track` only removes what it was handed, so anything else needs a `remove()` or the part's `dispose()`.

**What this cannot catch:** code that never runs, a write made before the holder took its slot, a write of the same value, a thing added under another object rather than the scene root, and a main light
not named `'sun'`. Nothing here sees that a warm lamp clashes with a cold sea: that takes a screenshot and an eye (section 6).

**When not to bother:** one author, one game, a `picture/` folder that works. Turn a file into a part when another source arrives, not before.

## 4. A flat illustration (one way among many)
Light alone turns a warm wall under a cool night fill into mud. An illustrator keeps each surface its own color and only shifts it:
- `MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0 })`: raise the emissive copy at night, so faces
  keep their hue; or `MeshBasicMaterial` and pick each face's shade yourself (vertex colors by normal); or `MeshToonMaterial` with a `gradientMap`.
- A warm `HemisphereLight` at night instead of a blue one; the night reads from the sky, the windows and the lamps, not from tinting walls blue.
- `NoToneMapping` so the colors come out as written.
- Lamp pools painted (an additive disc on the ground) plus a few real `PointLight`s for the spill near the camera.

**Shadow sides darker than expected?** With no environment map, the ambient you write is all the fill there is. A hemisphere value copied from a scene that also had an
environment map comes out too dark on faces away from the sun: raise the ambient, add an `AmbientLight`, or generate an environment (`engine.sky.environment()`).
`uWeatherLight` is sized for the sun: multiplying ambient by it as well darkens rain more than the sun alone does, so give ambient a share of it.

## 4b. Pixel art: low-resolution rendering with sharp scaling
Pixel art means drawing fewer pixels and then keeping every edge hard when they are enlarged. It takes two engine options and plain three.js and CSS:
- **Render fewer pixels.** `pixelRatio` below 1 makes the drawing buffer smaller than the canvas on the page. Pick it from the art resolution you want against the canvas
  size, and call `engine.setPixelRatio(p)` again when the size changes. A value that makes one art pixel a whole number of real screen pixels keeps them all the same size: for k screen pixels per art pixel that is `devicePixelRatio / k`, not `1 / k`, which comes out uneven on a display scaled to 150%.
- **Turn adaptive resolution off.** `adaptiveResolution: false`: it changes the render scale with frame cost, so the size of a pixel would drift during play.
  `antialias: false` too, since it blends the edges you want hard.
- **Scale sharply.** The browser smooths an enlarged canvas unless told otherwise: CSS `image-rendering: pixelated` on it.
- **Leave the menu rows that fight it out.** The settings menu's render scale, anti-aliasing and adaptive rows and its quality presets would change the pixel size. Leave those rows out where the game lists its tabs, `settings({ sections: [{ id: 'graphics', omit: ['pixelRatio', 'antialias', 'adaptive'] }, 'audio', 'controls', 'language', 'saves'] })`: an omitted row stays your value, and no preset or stored value moves it.
- **Sample sharply.** `engine.assets.texture(name, { pixelated: true })` sets `NearestFilter` for enlarging and `NearestMipmapNearestFilter` for shrinking. On a texture of
  your own, set `magFilter` and `minFilter` to `THREE.NearestFilter`.
```js
const canvas = document.querySelector('canvas');
canvas.style.imageRendering = 'pixelated';
const engine = createEngine({ canvas, pixelRatio: artHeight / canvas.clientHeight, adaptiveResolution: false, antialias: false });
```
Whatever blends neighbouring pixels works against the look, so judge each post effect and any tone curve (section 4) by eye. Text and panels under `engine.uiRoot` are page elements and stay at screen
resolution. Objects that move by less than an art pixel shimmer; if that shows, round their drawn position to the art grid in `onRender`. `describe().render.scale` reports `upscaled: true` here, which is what you asked for.

**A following camera without jitter.** Jitter comes from rounding the camera and the character on their own: each lands on a different pixel from frame to frame. Keep one exact position and round once:
- Draw the character with `engine.stepBlend` (recipe 06 section 1b), in `onFrame`.
- Make the camera follow that drawn position. The camera module runs after the `onFrame` list, so it moves after the character in the same frame.
- Round only the final position relative to the camera, in `onRender`, which runs after the camera has moved. Never round the camera and the character separately.
```js
const drawn = new THREE.Object3D();                     // the exact drawn position; the sprite is its rounded copy
engine.cameraRig.follow(drawn);
engine.onFrame(() => { drawn.position.lerpVectors(body.last, body.now, engine.stepBlend); });   // body: what onFixed moves
engine.onRender(({ camera }) => {                       // side view, where screen x and y are world x and y; pixel: the world size of one art pixel
  const snap = (v, c) => c + Math.round((v - c) / pixel) * pixel;
  sprite.position.set(snap(drawn.position.x, camera.position.x), snap(drawn.position.y, camera.position.y), drawn.position.z);
});
```
A dead zone keeps small moves from shifting the camera: have it follow a separate object that the game moves only when the character leaves an area around it.
For smooth scrolling of the whole picture, render with the camera on a whole pixel, draw slightly larger than the screen, and slide the final image by the leftover fraction. Nothing in this repository shows that step yet: it is untested.

## 5. What the engine still does with all of this off
- `scene.background` starts as a neutral gray: write your own color or sky.
- `renderer.shadowMap.enabled` is on; nothing casts until your lights do.
- Your materials are never patched unasked: `applyEffects(mat)` gives one the cloud shadow, which `engine.uniforms.uCloudShadow` then deepens.
- The page-wide changes to three.js are listed in `describe().threePatches` (`THREE.md`).

## 6. Check the picture
`threedog shot <page> --time 22:00` (and `--weather rain`): the picture numbers and hints measure your lights and glowing materials as they
are (the probe's renders do not run your `onRender` code, so a lamp it turns off stays off for that render), name the key and fill lights
you added, and report fog that covers most of the picture or a black frame with the material that causes it. They also measure what your own code
does to the frame: a `ShaderMaterial` in view that ignores the fog or the tone curve, a light layout that changed during play (a shader recompile), two transparent meshes with one
`renderOrder` whose pixels depend on draw order. Each line says what it measured, or `not sure`. `recipes/60-judge-the-picture.md`
says how to judge the result.
