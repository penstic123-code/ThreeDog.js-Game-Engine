# 52 Change any look: `engine.look`

**In this recipe**: Atmosphere parts · Surface parts · Water, weather, post · Post effect chain · Who writes it · Sky multipliers ·
Lower-level forms that stay

Every look part lives at `engine.look.<part>` and is changed with the same verbs. The style gives the starting values; the game changes them on top.

```js
const cave = engine.look.tone.set({ exposure: 0.6 }, { owner: 'cave' });   // adjust: only the keys you give; null drops a key
cave.remove();                                  // the style value shows again (every handle ends with remove())
engine.look.lights.manual('sun');  engine.lights.sun.intensity = 3;         // take a value the engine drives; manual('sun', false) gives it back
engine.look.env.replace('sky');                 // take a part over whole (your own three.js object where it accepts one); replace(null) gives it back
engine.describe().look.tone.exposure;           // { value: 0.6, writer: 'game:cave', at: 'main.js:12', under: ['style'] }
engine.catalog('look.tone');                    // params with default, why, off; hooks; what replace accepts and loses
```

Sky and atmosphere, three ways (recipe 08 has the contract):
```js
// 1. keyframes (default): style.sky.keyframes / style.exposure lists drive the day; nothing to write
// 2. a function of the frame context, fed by one call: any key marked fn (fog color / near / far / density, sky top / horizon / backdrop, lights, exposure)
engine.look.fog.set({ color: ({ state }) => state.boss ? '#400' : 'horizon' });  engine.look.state({ boss: true });
// 3. your own three.js sky (three/addons Sky, a ShaderMaterial dome, a skybox): never written; time / weather keep flowing through engine.uniforms
engine.look.sky.replace(mySky);  mySky.material.uniforms.sunPosition = engine.uniforms.uSunDir;   // the same Vector3, refreshed every frame
```

Two routes, side by side (not a ladder): the **look** itself is plain three.js, any time: your own material, `ShaderMaterial`, `onBeforeCompile`,
textures, lights, passes, written directly (a direct write takes the value over: auto-yield). `engine.look` is the **coordination** route: owners,
layers, keyframes that follow time / weather / season, and `describe` saying who set what. Use either per value; `set` / `patch` / `replace` here
are optional shortcuts, not steps to climb before three.js is allowed. When tuning params does not reach the reference, write the three.js.
Where looks sit among the other ways to customize: `../CONVENTIONS.md` "Customization ladder".

- Layers, upper wins: engine default < style < game (each owner; the last one written wins) < `engine.debug.override(owner, 'look.<part>', values)`.
- `set` / `patch(name, glsl)` / `replace(impl)` / `manual(key)` (only where the engine writes the value on its own: the table below): a part offers only the verbs that make sense for it; the others throw with the verb to use. A part whose verb takes other arguments (`materials.replace(role, impl)`) lists the call shape in `engine.catalog('look.<part>').signatures`, and a wrong call quotes it.
- `writer` in describe is who set the value: the layer, `'engine'`, `'style'`, `'game'` (owner `'game'`) or `'<layer>:<owner>'` (for example game:cave or debug:probe), unless something else writes the property now: then `'three'` (a direct write) or `'manual:game'`, the same name as `describe().owned`. `describe().render` keeps only renderer facts; each value carries `look` (the path of the record to read here, `'look.tone.exposure'`) and that record's `writer`. The tone curve has no look record (the engine writes `renderer.toneMapping` once at creation; change it with plain three.js): its owned row `toneMapping` yields quietly to a direct write, and `render.toneMapping.writer` is `'engine'`, `'style'` or `'game'` directly.
- Look changes are not saved: after a load, set them again from your own state.
- Changing the three.js object directly (`engine.renderer.toneMappingExposure = 2`) still works; describe tags it `three` and you lose the owner and the debug layer.
- How bright a lit color comes out (three.js light units, AgX, exposure 1): a diffuse surface facing up receives
  `sun.intensity × sin(sun elevation) + hemi.intensity` (the hemisphere's sky color, since it faces up), and three divides by π, so a total of
  **about 3 (≈ π) shows mid-tone albedos (sRGB 0.35-0.65) at roughly their own value**: sun 2 high overhead + hemisphere 1, or a low sun 4 at 20° +
  hemisphere 1.6. Measured on three's AgX curve: total 2.5 for sRGB 0.35, 2.6 for 0.5, 3.4 for 0.65, 5.5 for 0.8 (AgX darkens light colors and
  pales saturated ones, so a pale or vivid palette needs more, or exposure). Walls and faces away from the sun get only their `N·L` share, and
  the environment (`look.lights` `env`, `look.env`) adds on top for Standard / Physical materials; under a sky the room map follows the keyframes'
  ambient column (recipe 08 "Day and night brightness").
- Your own module's part: `defineLookPart(engine, { id, params, style, apply })`. Every param declares `default`; a default that changes the picture declares `why` and `off`, or `neutral: true` (checked by `npm run check`; R36 checks that the part's `Look<Part>` type lists the same keys). A part author changes records only through the part's methods `write`, `ownerValue`, `extend`, `retract`, `has`, `resolved`, `restyle` (rule R25 flags `part._...`); `validate(key, value)` in the spec rejects a value before anything is written, and an `apply` that throws leaves no layer behind.

## Atmosphere parts (sky module): fog, sky, shadow

```js
engine.look.fog.set({ far: 220, color: '#9bb' }, { owner: 'cave' });      // kind, color, density, near, far, height, falloff, enabled
engine.look.fog.manual();                                                  // the sky stops writing scene.fog (manual(false) gives it back); replace(new THREE.Fog(...)) hands it yours
engine.look.sky.set({ clouds: { coverage: 0.7, speed: [0.01, 0] }, backdrop: 0x335577 });
engine.look.sky.patch('layer:aurora', { glsl: '...threedogSkyLayer...', blend: 'add' });   // a named dome layer; patch('layer:aurora', null) removes it
engine.look.sky.patch('clouds', glsl);                                     // the cloud function; replace(skyboxName | Texture | Object3D) swaps the dome
engine.look.shadow.set({ type: 'vsm', radius: 3, cascades: 3, maxFar: 150 });   // set only
```

- `fog` shows `enabled` and `far` (fog reaches full strength at `engine.fogFar`, starting at 0.3 x that) as the visible defaults; turn off with `set({ enabled: false })`. Color, density, near, far, enabled and linear <-> exp2 are live; color switches freely between `'horizon'` (the default: fog matches the sky where they meet), a fixed color and a function, and the dome's lower band fades to any non-horizon fog color so no seam shows. Kind `'exp'` / `'height'`, `height`, `falloff` and the `'fog'` hook replace three's shared fog shader chunks, so they only work before the first frame (style, `sky({ fog })`, or right after `createEngine`); later they throw and say so.
- `sky`: `clouds.*` are live uniforms of the dome (they only draw when `clouds.coverage` > 0). A hook change recompiles the dome material once. Style `layers` arrays are named by their `name` key, else `layer0`, `layer1`.
- `shadow`: no `patch` (the cascade patch is internal) and no `replace` (to own the shadows, light with your own lights: `sky({ sun: false })`).
  `engine.look.shadow.include(myLitShaderMaterial)` opts a ShaderMaterial of yours into cascaded shadows (built-in lit materials need nothing).
- Whether a picture reads as lit is mostly key against fill. The key (the sun or one main light) is the light that casts the shadow; the fill is
  everything else (sky and ground light, the environment). Shadowed surfaces see only the fill while lit ones see both, so the balance sets how
  deep the shadows look: less fill is harder and more dramatic, more fill softer and more readable, and there is no right ratio, only the one
  the game wants. A warm key over a cool fill (or the reverse) separates lit from shaded sides without more contrast. The shot's `light:`
  fact measures the ratio; judge the result on a shot with a known-colored object in shadow. To compare afterwards, the `sun-and-key-light`
  technique (`threedog examples pull sun-and-key-light`) shows three routes side by side.
- Shadow detail is texels per meter: one shadow-map texel covers `2 x extent / mapSize` meters (for example the default `extent` 70 on a
  2048 map is about 6.8 cm, twice that on the 1024 map of low tier and headless shots). A box much bigger than what the camera sees blurs
  the shadows of small things; a box smaller than it cuts shadows off. `look.shadow.set({ extent })` sizes it; a depth bias scales with the
  texel, so re-check `bias` / `normalBias` after changing either.
- Fog kinds and the fog hook in detail, and taking lights or fog away from the sky entirely (`look.lights.manual('sun')`, `sky({ sun: false })`, `look.fog.manual()`): [recipe 38](38-environment-look-hooks.md).

## Surface parts: `materials`, `surface`, `ground`, `wind`

A change to these parts reaches the materials made **after** it, with one exception: `look.materials.set` of the plain properties `color`, `emissive`, `emissiveIntensity`, `roughness`, `metalness`, `opacity`, `envMapIntensity`, `shininess` and `specular` also changes the materials already made for that role (no recompile; clearing the layer goes back to the style's value). Shader-changing keys (`type`, `steps`, `ramp`, `soften`, `repeat`, `wrap`, `detail`, `lighting`, `patch`, `replace`) and all of `look.surface` are for new materials only (a Material already handed out, or cloned by your game, is not touched; catalog and describe say so as `appliesTo`, and a debug override warns). `engine.look.<part>.object` is the three.js object behind a part; for `materials` it is a function: `engine.look.materials.object('cloth')` is the last Material made for that role, `object()` all of them.

```js
const L = engine.look;
L.materials.set({ cloth: { roughness: 0.4, color: 0xf2ece0 } }, { owner: 'shop' });  // merged into style.materials.cloth; any role name
L.materials.patch('dim', { glsl: { fragment: { color_fragment: 'diffuseColor.rgb *= 0.8;' } } }, { roles: ['metal'] });   // a ShaderPatch on those roles
L.materials.replace('glass', new THREE.MeshPhysicalMaterial({ transmission: 1 }));      // the role is this Material (or (params, purpose, engine) => Material)
L.surface.patch('lighting', glsl);                                                      // your own threedogLighting(...) on every lit material, recipe 43
L.surface.set({ lighting: { wrap: 0.3 }, detail: { strength: 0.15 } });                // or the spec-key shortcuts (recipe 43, last section)
L.ground.set({ shading: 'flat', colors: { grass: '#7cc06b' } });                        // colors / biomeColors / steep / variation / shading rebuild the chunks
L.ground.set({ detail: { noise: 'paper', scale: 0.4, strength: 0.25 } });               // detail layer on the ground (style.terrain.detail)
L.ground.replace((e) => myGroundMaterial(e));                                           // Material or (engine) => Material; replace(null) gives it back
L.ground.replace(myGroundMaterial, { effects: false });                                 // drawn as given: no cloud shadow / season / detail patch (same word as vegetation.define)
L.wind.set({ frequency: 1.5, amplitude: 0.5 });                                         // live on every plant, planted ones too
L.wind.patch('sway', glsl);                                                             // threedogWind(...); read when vegetation.define runs, so patch first
```

- `materials`: `set` / `patch` / `replace` all name a role. `set` merges into spec entries; a role whose style entry is a Material or a function is changed with `replace`. Role names are free: invent new ones (`makeMaterial('lantern-glass')`); the engine only warns on a likely typo of a known role.
- `materials.glow(match, { night, day = 0, dusk = 0.3, owner })`: see "Night glow" below.
- `surface`: `set` / `patch('lighting' | 'detail', glsl)`; no `replace` (swap a whole material with `materials.replace`). `style.lighting` is the style layer.
- `ground` (terrain module): `set` / `patch('detail', glsl)` / `replace`. What `terrain({ colors, shading, material })` was given shows as owner `terrain()`.
- `wind` (vegetation module): `set` / `patch('sway', glsl)`; no `replace`. `style.wind` is the style layer.
- `set({ role: { key } })` accepts a key `makeMaterial` reads (type, steps, ramp, soften, repeat, wrap, detail, lighting, or a three.js material property); a typo throws.
- `look.cloudShadow` (cloud shadows, core) stays its own part: its `shadow` is read by every material and by the weather, not only by surfaces.

### Night glow: emissive that follows daylight

Lit windows, neon signs, lamp bulbs, glowing mushrooms, screens: name the materials once and give the emissiveIntensity for night and day. The
color is yours (the material's `emissive`); the engine writes only `emissiveIntensity`, fading from `day` to `night` as daylight drops below `dusk`
(the calendar's daylight, else the sky's sun). `dusk` defaults to 0.3, roughly 17:00 to 18:00 and back in the morning: a starting value, not a
rule. Judge it in shots at dusk: a shop sign may want to come on while the sky is still bright (a higher `dusk`), a cave mushroom only in full
dark (a lower one).
```js
engine.look.materials.glow('window', { night: 2 });                  // a material role (makeMaterial('window', { emissive: '#ffcc66' })) or material.name (a GLB's)
engine.look.materials.glow('neon', { night: 3, day: 0.4, dusk: 0.6 });   // signs stay faintly lit by day, full on early
const h = engine.look.materials.glow(m => m.name.startsWith('bulb'), { night: 1.5 });   // or a Material, or a filter
h.remove();                                                           // each material gets its own emissiveIntensity back
```
**Headroom: why a glow turns into glare.** What reaches the tone curve is the emissive color times `emissiveIntensity`. A near-white color
(`#ffe6c0`) has no headroom: all three channels already sit near 1, so multiplied past 1 they clip to the same white under tone mapping, and
bloom spreads that white over what is around it (a lit sign becomes a white block with a smear). A saturated color at a lower intensity still
reads as light: its strongest channel carries the brightness, the others keep the hue, and bloom carries the halo. The numbers above are the
examples' current values, not targets. Judge the result with the look check of `threedog shot` or `threedog snap` at night: it names each
glowing material and light that blows pixels out, with its current emissive and intensity and how much detail is lost under it, as a fact to
weigh against what the game wants (some games want a blinding sign).
It finds models built later (templates near the player, streamed cells, a level loaded afterwards): the scene is searched again after it changed,
not every frame. `describe().look.materials` lists each rule (`glow:window`) and how many materials it found; a match without an emissive color or
with a black one warns once. For the light those windows throw on the street, add a few `lightPool` sources (recipe 09 §1b); a pool source's
`glow` stand-in is for one object near one light and does not follow the time of day.

## Water, weather, post

```js
engine.look.water.set({ opacity: 0.5, waveHeight: 2 }, { owner: 'storm' });          // live, no recompile
engine.look.water.set({ foam: { color: 0xffffff }, depthColor: { shallow: 0x88ccdd, deep: 0x003355 } });   // rebuilds the water material once
engine.look.water.patch('wave', 'float threedogWaterWave(vec3 p, float t) { return sin(p.x + t) * 0.2; }');   // hooks: wave, surface
engine.look.water.replace((engine, { uniforms, waves, surface }) => myMaterial);      // the whole surface (style.water.material)

engine.look.weather.set({ 'rain.speed': 10, 'snow.size': 8, 'lightning.brightness': 0.5, overcastColor: '#667' });   // rebuilds that field's particles once
engine.look.weather.patch('rain.fragment', wholeFragmentShaderText);   // rain|snow . vertex|fragment: the WHOLE shader text, not a function
engine.look.weather.replace({ ash: { shape: 'soft', color: 0x555555 }, rain: { create } });   // null gives the fields back

engine.look.post.set({ bloom: { strength: 0.6 }, vignette: false });                   // keys: '<effect>.<param>', '<effect>.enabled'
engine.look.post.patch('tint', { glsl: 'color.rgb *= vec3(1.0, 0.9, 0.8);', slot: 'ldr', order: 5 });   // generates a fuse effect named 'tint'; patch('tint', null) removes it
engine.look.post.add({ name: 'scan', slot: 'hdr', order: 5, create: (ctx) => myPass }, { owner: 'cave' });   // ONE custom pass; returns { remove() }. Same errors as the chain (duplicate name, second 'scene' pass, depth order) and nothing is added. Tune it with set({ 'scan.<param>': v })
engine.look.post.replace([bloom(), grain()]);                                          // swaps the whole chain; replace(null) gives the style chain back
```

- Water: structural keys (`depthColor`, `foam`, the hooks, `replace`) rebuild the shared material once and hand it to every water mesh; the live keys only write a uniform. `water({ opacity: 0.5 })` options are the game layer.
- Weather: a field the weather table lacks (`snow` in a desert) has no particles; setting it warns once. `replace({ [field]: spec })` holds one object per owner, so list every field you replace in each call; while a field is replaced, `set` on it is ignored.
- Post: `look.post.set` writes the `game` layer (keys `<effect>.<param>` and `<effect>.enabled`); style effects (bloom, ao ...) are the style layer; `engine.post.get(name)` only reads an effect. MSAA is `engine.post.setAntialias(on)`. Costly effects start off on low-tier devices: `look.post` lists `<effect>.enabled` with `why` and `off`. `postAdd` / `postRemove` stay style parts (they edit the list before the engine exists).
- `describe().render.post` reads the same records (`writer`: style, game, debug).

## Post effect chain

Post-processing is an ordered list of named effects (`style.post`, then `look.post`). Each runs in a slot, then by `order` (low first):
`scene` (replaces the scene render, one at a time, e.g. pixelation) -> `hdr` (linear color: outline, AO, bloom) -> tone mapping -> `ldr` (sRGB: LUT,
palette, grain, vignette) -> `final` (FXAA / SMAA). An effect is `{ name, slot, order, params, create(ctx) => pass, update?(pass, params) }`; under
WebGL the pass is any three.js postprocessing Pass, built the first time it is on. To read the chain: `engine.post.object()` (the
EffectComposer, null until post first runs) and `engine.post.targets()` (its render targets); both stay the engine's (it rebuilds passes,
resizes, disposes), so change the chain through `look.post`.
```js
import { bloom, outline, vignette, lut } from '@threedog/post-effects';   // never from another style: packs do not depend on each other
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
const myStyle = { post: [outline({ enabled: true, thickness: 1.5 }), bloom({ strength: 0.2 }), vignette(), lut({ saturation: 1.1 }),
  { name: 'myLut', slot: 'ldr', params: { lut: myLut }, create: ({ params }) => new LUTPass({ lut: params.lut }) }] };
```
- The engine ships no effects. `@threedog/post-effects` (import only what you use) has `bloom`, `ao`, `outline`, `dof` (all `hdr`; outline and dof
  read depth) and `lut` (contrast / saturation / warm-cool / optional 3D LUT), `grain`, `vignette`, `chromatic` (`ldr`). A listed effect is on
  (`enabled: false` lists it off, for `look.post.set({ '<name>.enabled': true })` later). The costly ones (`bloom`, `ao`, `dof`, outline
  `normal`/`both`) start off on low-tier devices even when enabled (`createEngine({ post: { ao: true } })` forces one; `threedog shot` renders the
  desktop tier and names what a tier leaves out, `--tier low` checks the low one). To add to or trim a pack's list without replacing it: `postAdd(...effects)` /
  `postRemove(...names)` ([recipe 09](09-style-pack.md), 0b).
- Depth: an effect that reads scene depth (`needsDepth: true`, e.g. `outline`) must run before any pass that swaps buffers (a `ShaderPass`, a
  scene-slot pixelation pass, the tone-mapping output). A chain that breaks this throws when the effect is added or enabled, naming both effects;
  give the depth reader a lower `order`. `dof` keeps the scene depth (`pass.keepsDepth = true`), so `dof` and `outline` can both be on while `dof`
  has the lower `order` (default: dof 5, outline 10). `threedog style check` reports the other order as an error.
- `createEngine({ post: { bloom: false } })` overrides an effect's startup on/off; `costly: true` effects start off on low-tier devices. MSAA
  (`antialias`) works with every effect on. The settings menu shows `bloom` / `ao` toggles only when the style registers effects with those names.
- `fuse`: a light color effect can skip its own fullscreen pass by carrying a GLSL snippet instead of `create()`:
  `fuse: { uniforms: { uMyAmount: 'float' }, values: p => ({ uMyAmount: p.amount }), glsl: 'color.rgb *= 1.0 - uMyAmount * length(vUv - 0.5);' }`.
  Fused effects that are on and next to each other in one slot (never `scene`) compile into one shader and draw in one pass, in `order`. The
  snippet edits `vec4 color` and may use `vUv`, `tDiffuse`, `uTime`, `uResolution`, `fxHash(vec2)`; uniform names are shared by the group, so prefix
  them with the effect name. A snippet that samples `tDiffuse` elsewhere (blur, color fringe) sets `reads: true` and starts a new group.
  `look.post.patch(name, { glsl })` builds such an effect for you.
- Outline: `outline({ mode: 'depth' | 'normal' | 'both' })`: `depth` (default, silhouettes), `normal` (creases; draws the scene once more with
  normals, so it is `costly`), `both`. `fadeWithDistance: false` keeps lines at any distance; `wobble: 1.5` jitters lines by up to 1.5 px at 8 steps a
  second. To exempt objects: `outline({ offLayer: OUTLINE_OFF_LAYER })` and `mesh.layers.enable(OUTLINE_OFF_LAYER)` (one extra render of just
  those objects; nothing when `offLayer` is `null`).
- Ambient occlusion (darker creases and contact corners): `ao({ radius, intensity })` wraps three's `GTAOPass`; `radius` is in world units
  (default 0.25), `intensity` 0..1 (default 1), both change in place: `look.post.set({ 'ao.enabled': true, 'ao.radius': 0.6 })` (with `ao()` in
  `style.post`), or `look.post.add(ao({ enabled: true }))` at run time. Order 20 runs it before bloom and the tone mapping. It follows resize,
  render scale and MSAA like every effect. It draws the scene once more with normals: points and lines are skipped, and a vertex-moving shader
  patch (wind) is not applied there, so swaying leaves get the AO of their rest pose. Cost on a laptop GPU (AMD 780M, 1280x720, MSAA, a street
  scene): about +6 ms a frame (4.4 -> 10.7 ms). Other GTAOPass settings (`samples`, `thickness`, `output`):
  `engine.post.object().passes.find(p => p.gtaoMaterial)`.

## Who writes it: the ownership table

Some three.js values the engine writes **on its own**, every frame or on a timer: the sky drives the sun, the camera module places the camera.
Each of them is registered once (`core/owned.js`), and every one behaves the same way:

- **Engine** (default): the engine writes it. Adjust it while the engine keeps driving: the `set` call in the table.
- **Taken** (`manual`): `engine.look.<part>.manual(key)` stops the engine writing it; the three.js object is yours (`engine.lights.sun.intensity = 3` sticks).
  `manual(key, false)` (or the handle's `remove()`) gives it back. Keys match by dotted prefix: `manual('sun')` takes `sun.intensity` and `sun.color`;
  `manual()` takes every key of the part. This is the one takeover entry: no module option starts a value taken over (`sky({ sun: 'manual' })`
  throws and names the call), and `look.fog.replace(fog)` records itself here too (writer `manual:look.fog.replace`).
- **Written directly** without `manual`: the engine notices, **stops writing it and keeps your value**, and warns once with the `manual` call and the
  hand-back call. This happens in release builds too (only the warning is dev-only), so a game behaves the same with and without checks.
- A `timeline.tween` on an object is a temporary takeover of that object only: no warning, no hand-over (other objects stay checked).

`engine.describe().owned` lists every registered value and who writes it now, as `writer` (`engine`, `manual:game`, `manual:look.fog.replace`,
`three (engine yielded)`); the same `writer` shows next to a look value, `describe().look.<part>.<key>.writer`. (Without a takeover it is the layer that set the value, `game` or `game:<owner>`; `owner` is only ever the name you pass.) A test (`tests/specs/owned.mjs`) runs the three
behaviors for every registered value and fails when one is registered without a row here.

| id | part | written when | take it | adjust while the engine drives |
|---|---|---|---|---|
| `sun.intensity` | lights | sky, every frame (keyframes, weather) | `engine.look.lights.manual('sun')` | `engine.look.lights.set({ sun: { intensity: 2 } })` |
| `sun.color` | lights | sky, every frame | `engine.look.lights.manual('sun.color')` | `engine.look.lights.set({ sun: { color: '#ffd9a0' } })` |
| `sun.direction` | lights | sky, every frame (time of day) | `engine.look.lights.manual('sun.direction')`: aim it by `sun.position` relative to `sun.target`; the shadow box still follows | - |
| `shadow.follow` | shadow | sky, every frame (shadow box center = `sun.target`); without a sky the baseline sun follows `engine.focus` | `engine.look.shadow.manual('follow')`; no sky: `engine.look.lights.manual('shadow.follow')` | `engine.look.shadow.set({ follow: 'focus' \| 'camera' \| object3D \| () => Vector3 \| false })`, size: `set({ extent })` |
| `hemi` | lights | sky, every frame | `engine.look.lights.manual('hemi')` | `engine.look.lights.set({ hemi: { intensity: 0.8 } })` |
| `fog` | fog | sky, every frame (color, distance) | `engine.look.fog.manual()` | `engine.look.fog.set({ color: '#cfd8e0', far: 300 })` |
| `toneMapping` | tone | once, at `createEngine` (`style.toneMapping`, else AgX); a direct write yields with no warning (it is the documented way) | `engine.renderer.toneMapping = THREE.ACESFilmicToneMapping`, or `engine.look.tone.manual('toneMapping')`; `manual('toneMapping', false)` writes the creation curve back | - |
| `exposure` | tone | sky, every frame, only with exposure keyframes | `engine.look.tone.manual('exposure')` | `engine.look.tone.set({ exposure: 1.2 })` |
| `background` | sky | sky: a backdrop color or skybox every frame; with the dome the dome hides when you take it | `engine.look.sky.manual('background')`; whole sky: `look.sky.replace(texture \| object3D)` | `engine.look.sky.set({ backdrop: '#335577' })` |
| `sky.modifiers` | sky | sky, every frame (combined sky.* mod entries) | `engine.look.sky.manual('modifiers')` | `engine.mod('sky.sunLight', { owner: 'cave', mul: 0.3 })` |
| `env` | env | sky, every frame: the room map's intensity (ambient column); a `'sky'` environment is rebuilt on its interval | `engine.look.env.manual()` | `engine.look.env.set({ intensity: 0.8 })`, `look.env.replace('sky' \| 'asset' \| myTexture \| myPmremTarget)` |
| `camera.far` | view | fog distance / terrain view range (`setFogFar`, `setViewChunks`) | `engine.look.view.manual('far')` | - |
| `camera.fov` | view | the settings menu fov slider, camera modules (first person / rts fov, fixed shots, back to the install fov on a switch) | `engine.look.view.manual('fov')` | - |
| `pixelRatio` | view | adaptive resolution, about once a second while slow | `engine.look.view.manual('pixelRatio')` | `engine.setPixelRatio(1.5)` |
| `camera` (position, rotation) | view | the camera module, every frame | `const cam = engine.takeCamera('me')` (`cam.remove()` gives it back) | - |
| `shadow.csm` (not a property: a list) | shadow | while `cascades > 1`: the `csm` patch goes on every built-in lit material, yours too (else N times as bright) | - (lower `cascades` to 1); your ShaderMaterial is left alone until `engine.look.shadow.include(mat)` | - |

Material live keys (`look.materials.set({ wood: { color } })` on materials already made) are per material, not one row: a key the
`makeMaterial('wood', { color })` call passed itself is never overwritten, and a value you set by hand afterwards (`m.color.set(...)`) is
skipped with one warning. Order: by hand > the call's params > `look.materials.set` > the style.

Not in this table, because the engine writes them once rather than keeps writing them: automatic batching (it moves engine-placed meshes to layer 31
and says so once in the dev console and in `describe().perf.batching`; turn it off per object with `userData.batch = false`, see
[05-props-bake.md](05-props-bake.md) §2b) and `castShadow` on generator props (set when the model is made: a generator's own flags are kept, the
manifest entry can set them; change it on the object afterwards).

## Sky multipliers (engine.mod) vs look.lights

Two ways to make the light darker or brighter; pick by what you want to keep.
- `engine.mod('sky.sunLight', { owner: 'cave', mul: 0.3 })` (also `sky.ambient`, `sky.fog`, `sky.tint`, `sky.cover`) is a **multiplier** on what the sky produces each frame (keyframes, weather, season). The time of day keeps moving underneath, entries from different owners multiply, the handle's `remove()` ends yours, and `sky.modifiers` shows the combined result (read-only). Use it for "darker in the cave" or "ash over the ground" (`sky.cover`).
- `engine.look.lights.set({ sun: { intensity: 0.5 } }, { owner: 'cave' })` is an **override layer** on the part's own values: the key you give replaces what the style or the keyframes said, whatever the hour. Use it for "the sun is exactly this".

## Lower-level forms that stay

Per-call `makeMaterial(role, params)` keys win for that one material; `applyEffects(mat, { patches })` is the low-level form of `look.materials.patch(name, spec, { roles })`; `style.terrain.*`, `style.wind.*` and `style.lighting` are the style layer of `look.ground` / `look.wind` / `look.surface`.
