# 52 Change any look: `engine.look`

**In this recipe**: Atmosphere parts · Surface parts · Water, weather, post · Post effect chain · Who writes it · How look values stack ·
Lower-level forms that stay

Every look part lives at `engine.look.<part>` and is changed with the same verbs. The style gives the starting values; the game changes them on top.

```js
const cave = engine.look.tone.set({ exposure: 0.6 }, { owner: 'cave' });   // adjust: only the keys you give; null drops a key
cave.remove();                                  // the style value shows again (every handle ends with remove())
engine.look.lights.manual('sun');  engine.lights.sun.intensity = 3;         // take a value the engine drives; manual('sun', false) gives it back
engine.look.env.replace('sky');                 // swap the one three.js thing a part draws (here the environment map); replace(null) gives it back
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
layers, keyframes that follow time / weather / season, and `describe` saying who set what. Use either per value; the verbs here
are optional shortcuts, not steps to climb before three.js is allowed. When tuning params does not reach the reference, write the three.js.
Where looks sit among the other ways to customize: `../CONVENTIONS.md` "Customization ladder".

- Layers, upper wins: engine default < style < game (each owner; the last one written wins) < `engine.debug.override(owner, 'look.<part>', values)`.
- <a id="verbs"></a>**The verbs, the same on every part**: `set(values)` changes values; `patch(hook, code)` swaps one named hook the part declares (that is all patch means); `add(thing)` puts one more named thing in next to the engine's (`look.post.add`, `look.materials.add`; the handle's `remove()` takes it out); `replace(thing)` swaps the one three.js thing the part draws (a texture, a sky object, a Material, an effect list; `replace(null)` gives it back); `manual(key)` stops the engine writing a value it writes on its own (the table below); `value(key)` is the one read (who set it: `describe().look`). To swap a whole module with its behaviour and saves (the sky, the ground or plant look, the weather look) use `engine.use(mine(), { replaces: '<slot>' })` instead: `replace` is for one thing, `replaces` for a module. A part offers only the verbs that make sense for it; the others throw with the call to use and the verbs it has. A part whose verb takes other arguments (`materials.replace(role, impl)`) lists the call shape in `engine.catalog('look.<part>').signatures`, and a wrong call quotes it.
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
- Your own module's part: `defineLookPart(engine, { id, params, style, apply })`. Every param declares `default`; a default that changes the picture declares `why` and `off`, or `neutral: true` (checked by `npm run check`; R36 checks that the part's `Look<Part>` type lists the same keys). Module code changes records only through `part.author` (`write`, `ownerValue`, `extend`, `retract`, `has`, `resolved`, `values`, `restyle`, `drive` / `feed`); it is kept off the part so a game's autocomplete shows only the verbs above (rule R25 flags `part._...`); `validate(key, value)` in the spec rejects a value before anything is written, and an `apply` that throws leaves no layer behind.

## Atmosphere parts (sky module): fog, sky, shadow

```js
engine.look.fog.set({ far: 220, color: '#9bb' }, { owner: 'cave' });      // kind, color, density, near, far, height, falloff, enabled
engine.look.fog.manual();                                                  // the sky stops writing scene.fog (manual(false) gives it back)
engine.scene.fog = new THREE.Fog(0x445566, 10, 120);                      // a fog of your own: plain three.js, the engine yields (there is no look.fog.replace)
engine.look.sky.set({ clouds: { coverage: 0.7, speed: [0.01, 0] }, backdrop: 0x335577 });
engine.look.sky.patch('layer:aurora', { glsl: '...threedogSkyLayer...', blend: 'add' });   // a named dome layer; patch('layer:aurora', null) removes it
engine.look.sky.patch('clouds', glsl);                                     // the cloud function; replace(skyboxName | Texture | Object3D) swaps the dome
engine.look.shadow.set({ type: 'vsm', radius: 3, cascades: 3, maxFar: 150 });   // set only
```

- `fog` shows `enabled` and `far` (fog reaches full strength at `far`, 600 m unless a style, the terrain view or the game says otherwise, starting at 0.3 x that) as the visible defaults; turn off with `set({ enabled: false })`. Color, density, near, far, enabled and linear <-> exp2 are live; color switches freely between `'horizon'` (the default: fog matches the sky where they meet), a fixed color and a function, and the dome's lower band fades to any non-horizon fog color so no seam shows. Kind `'exp'` / `'height'`, `height`, `falloff` and the `'fog'` hook replace three's shared fog shader chunks, so they only work before the first frame (style, `sky({ fog })`, or right after `createEngine`); later they throw and say so.
- `sky`: `clouds.*` are live uniforms of the dome (they only draw when `clouds.coverage` > 0). A hook change recompiles the dome material once. Style `layers` arrays are named by their `name` key, else `layer0`, `layer1`.
- <a id="tsl-forms"></a>**tsl forms** (`renderer: 'webgpu'`): the GLSL hooks `clouds`, `layer:<name>` (and style `layers` entries) and `fog` take `{ glsl, tsl }`; each renderer draws its own form and a missing one throws by name (`[webgpu-needs-tsl]` on WebGPU). `tsl: (ctx) => vec4 node`, ctx = the GLSL function's arguments as nodes plus the value so far (`ctx.clouds` the built-in kind, `ctx.color` the sky under a layer, `ctx.fog` what the fog kind alone draws), `ctx.uniforms` (the dome's, yours included), `ctx.fx.noise` / `hash` and `ctx.tsl` (three/tsl):
  `engine.look.sky.patch('layer:glow', { glsl, tsl: ({ dir, tsl }) => tsl.vec4(1, 0.6, 0.3, tsl.smoothstep(0.3, 0.8, dir.y).mul(0.4)), blend: 'add' })`;
  `engine.look.fog.patch('fog', { glsl, tsl: ({ depth, tsl }) => tsl.vec4(0.3, 0.3, 0.8, tsl.exp(depth.mul(-0.02)).oneMinus()) })`.
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

A change to these parts reaches the materials made **after** it, with one exception: `look.materials.set` of the plain properties `color`, `emissive`, `emissiveIntensity`, `roughness`, `metalness`, `opacity`, `envMapIntensity`, `shininess` and `specular` also changes the materials already made for that role (no recompile; clearing the layer goes back to the style's value). Shader-changing keys (`type`, `steps`, `ramp`, `soften`, `repeat`, `wrap`, `detail`, `lighting`, `add`, `replace`) and all of `look.surface` are for new materials only (a Material already handed out, or cloned by your game, is not touched; catalog and describe say so as `appliesTo`, and a debug override warns). `engine.look.<part>.object` is the three.js object behind a part; for `materials` it is a function: `engine.look.materials.object('cloth')` is the last Material made for that role, `object()` all of them.

```js
const L = engine.look;
L.materials.set({ cloth: { roughness: 0.4, color: 0xf2ece0 } }, { owner: 'shop' });  // on top of the style's materials.cloth (look.materials' style layer); any role name
L.materials.add('dim', { glsl: { fragment: { color_fragment: 'diffuseColor.rgb *= 0.8;' } } }, { roles: ['metal'] });     // one more ShaderPatch on those roles (h.remove() takes it out)
L.materials.replace('glass', new THREE.MeshPhysicalMaterial({ transmission: 1 }));      // the role is this Material (or (params, purpose, engine) => Material)
L.surface.patch('lighting', glsl);                                                      // your own threedogLighting(...) on every lit material, recipe 43
L.surface.set({ lighting: { wrap: 0.3 }, detail: { strength: 0.15 } });                // or the spec-key shortcuts (recipe 43, last section)
L.ground.set({ shading: 'flat', colors: { grass: '#7cc06b' } });                        // colors / biomeColors / steep / variation / shading rebuild the chunks
L.ground.set({ detail: { noise: 'paper', scale: 0.4, strength: 0.25 } });               // detail layer on the ground (style.terrain.detail)
L.ground.replace((e) => myGroundMaterial(e));                                           // Material or (engine) => Material; replace(null) gives it back
L.ground.replace(myGroundMaterial, { effects: false });                                 // drawn as given: no cloud shadow / season / detail patch (same word as vegetation.define)
L.wind.set({ frequency: 1.5, amplitude: 0.5 });                                         // live on every plant, planted ones too
L.wind.patch('sway', { glsl, tsl });                                                    // threedogWind(...) / tsl: (ctx) => moved position; read when vegetation.define runs, so patch first
L.vegetation.patch('color', { glsl: 'diffuseColor.rgb *= 0.8;', tsl: c => c.color.mul(0.8) });   // part of the plant look, live on planted species
L.cloudShadow.replace({ glsl: 'reflectedLight.directDiffuse *= myShade(vThreedogWorld);', tsl: c => ({ directDiffuse: c.directDiffuse.mul(myShadeNode) }) });
L.cloudShadow.replace(false);                                                           // no engine cloud shadow anywhere: draw your own
L.season.replace(kind => ({ glsl: 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), uCover.y);', tsl: c => myTint(c, kind) }));   // your own season / snow tint
```

- `materials`: `set` / `add` / `replace` all name roles (`add(name, shaderPatch, { roles })`; materials have no named hook, so no `patch`). `set` merges into spec entries; a role whose style entry is a Material or a function is changed with `replace`. Role names are free: invent new ones (`makeMaterial('lantern-glass')`); the engine only warns on a likely typo of a known role.
- `materials.glow(match, { night, day = 0, dusk = 0.3, owner })`: see "Night glow" below.
- `surface`: `set` / `patch('lighting' | 'detail', glsl)`; no `replace` (swap a whole material with `materials.replace`). `style.lighting` is the style layer.
- `ground` (terrain module): `set` / `patch('detail', glsl)` / `replace`. What `terrain({ colors, shading, material })` was given shows as owner `terrain()`.
- `wind` (vegetation module): `set` / `patch('sway', glsl | { glsl, tsl })`; no `replace`. `style.wind` is the style layer.
- `vegetation` (vegetation module): `patch('color', glsl | { glsl, tsl, uniforms })`, code in the `color` slot of every species' material, changed live. The whole plant look is replaced as a module: `engine.use(myPlants, { replaces: 'vegetation-look' })`.
- `cloudShadow` and `season` (core): `replace(spec)` puts your own patch (`{ glsl, tsl, uniforms?, pars?, slot? }`, slot `lighting` / `color` by default) in place of the engine's on every engine material, including ones built before the call; `replace(false)` removes the term; removing the layer gives the engine's back. The signals stay bound: `uCloud*` and `threedogCloudShadow(worldPos)`; `uFoliageTint` / `uGroundTint` / `uFoliageMix` / `uGroundMix`, `uCover` (cover amount alone, x foliage, y ground) and `threedogSeason(color, kind)`. `season` also takes `kind => spec` (kind `'foliage'` | `'ground'`). Each renderer draws its own form, and a missing one throws by name.
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
engine.look.post.add(new UnrealBloomPass(size, 0.6, 0.4, 0.85), { name: 'glow' });   // THE one way in: a Pass, a node function or an effect; returns { name, remove() }
engine.look.post.add({ name: 'tint', fuse: { glsl: 'color.rgb *= vec3(1.0, 0.9, 0.8);' }, slot: 'ldr', order: 5 }, { owner: 'cave' });   // a pixel snippet is an effect too
engine.look.post.replace([bloom(), grain()]);                                          // swaps the whole chain; replace(null) gives back what add() put in
```

- Water: structural keys (`depthColor`, `foam`, the hooks, `replace`) rebuild the shared material once and hand it to every water mesh; the live keys only write a uniform. `water({ opacity: 0.5 })` options are the game layer.
- Weather: a field the weather table lacks (`snow` in a desert) has no particles; setting it warns once. `replace({ [field]: spec })` holds one object per owner, so list every field you replace in each call; while a field is replaced, `set` on it is ignored.
- Post: `look.post.set` writes the `game` layer (keys `<effect>.<param>` and `<effect>.enabled`); effects a style's plugins add (bloom, ao ...) sit on the style layer (owner `style:<pack>`); `engine.post.get(name)` only reads an effect. MSAA is `engine.post.setAntialias(on)`. Costly effects start off on low-tier devices: that is the engine layer (`describe().look.post['<effect>.enabled']` reads `writer: 'engine'` with a `why`), and `look.post` lists `<effect>.enabled` with `why` and `off`; a game's `set` turns it back on and reads `game`.
- `describe().render.post` reads the same records (`writer`: style, game, debug).

## Post effect chain

Post-processing is an ordered list of named effects, and **`engine.look.post.add(x, { name, slot, order, owner })` is the one way an effect gets
in**: game code, the game's `plugins/` folder (a file that exports the Pass or effect) and a style's `style/plugins/` all go through it, so every
effect has a name, an owner, on / off with `look.post.set({ <name>: false })` and a row in `describe().slots`. `x` is a plain three.js Pass (WebGL),
a TSL node function `(input, ctx) => node` (WebGPU), or an effect `{ name, create, node, fuse, slot, order, params }` (both renderers: give
`create` and `node`, or a `fuse`). Each runs in a slot, then by `order` (low first):
`scene` (replaces the scene render, one at a time, e.g. pixelation) -> `hdr` (linear color: outline, AO, bloom) -> tone mapping -> `ldr` (sRGB: LUT,
palette, grain, vignette) -> `final` (FXAA / SMAA). An effect is `{ name, slot, order, params, create(ctx) => pass, update?(pass, params) }`; under
WebGL the pass is any three.js postprocessing Pass, built the first time it is on (on WebGPU an effect gives `node` instead: recipe 56). To read the chain: `engine.post.object()` (the
EffectComposer, null until post first runs) and `engine.post.targets()` (its render targets); both stay the engine's (it rebuilds passes,
resizes, disposes), so change the chain through `look.post`. A plain Pass is placed by its kind: one that renders `engine.scene` itself
(`RenderPixelatedPass`, `SSAARenderPass`, `TAARenderPass`) goes in `scene` and replaces the engine's scene render (the scene is drawn once; a
second one throws), FXAA / SMAA / TAA in `final`, any other in `hdr` after the style's effects; a RenderPass of `engine.scene` and an OutputPass are
skipped (the engine has them). Without `{ name }` it is listed by class or shader name (`CopyShader#1`); its `remove()` does not dispose it.
A game that renders the canvas itself (its own composer) takes the frame: the engine stops drawing and warns once `[own-frame]`.
```js
import { bloom, outline, vignette, lut } from '@threedog/post-effects';   // shared effects come from the add-on, not from another game's style
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
engine.look.post.add(outline({ thickness: 1.5 })); engine.look.post.add(vignette());
engine.look.post.add({ name: 'myLut', slot: 'ldr', params: { lut: myLut }, create: ({ params }) => new LUTPass({ lut: params.lut }) });
// a style brings its effects as plugin files, the same files a game's plugins/ takes: style/plugins/10-bloom.js
export default bloom({ strength: 0.2 });   // and in style/index.js: plugins: import.meta.glob('./plugins/*.js', { eager: true })
```
- The engine ships no effects. `@threedog/post-effects` (import only what you use) has `bloom`, `ao`, `outline`, `dof` (all `hdr`; outline and dof
  read depth) and `lut` (contrast / saturation / warm-cool / optional 3D LUT), `grain`, `vignette`, `chromatic` (`ldr`). An added effect is on
  (`enabled: false` adds it off, for `look.post.set({ '<name>.enabled': true })` later). The costly ones (`bloom`, `ao`, `dof`, outline
  `normal`/`both`) a style's plugins bring start off on low-tier devices (`look.post.set({ ao: true })` turns one on; `threedog shot` renders the
  desktop tier and names what a tier leaves out, `--tier low` checks the low one). To take one of a pack's effects out: `engine.plugins.off('<pack>/<file>')`
  or `look.post.set({ ao: false })`; to add one on top: a game plugin file or `look.post.add`.
- Depth: an effect that reads scene depth (`needsDepth: true`, e.g. `outline`) must run before any pass that swaps buffers (a `ShaderPass`, a
  scene-slot pixelation pass, the tone-mapping output). A chain that breaks this throws when the effect is added or enabled, naming both effects;
  give the depth reader a lower `order`. `dof` keeps the scene depth (`pass.keepsDepth = true`), so `dof` and `outline` can both be on while `dof`
  has the lower `order` (default: dof 5, outline 10). `threedog style check` reports the other order as an error.
- On / off is `look.post.set({ bloom: false })` for every effect, whoever added it (there is no `createEngine({ post })`: the engine ships no
  effect to switch on, add one with `look.post.add(bloom())`). MSAA (`antialias`) works with every effect on. The settings menu shows `bloom` / `ao` toggles only when the style registers effects with those names; a toggle the player changes is written under owner `settings` (`writer: 'game:settings'`), and the menu writes nothing for a value it only re-applies unchanged.
- `fuse`: a light color effect can skip its own fullscreen pass by carrying a GLSL snippet instead of `create()`:
  `fuse: { uniforms: { uMyAmount: 'float' }, values: p => ({ uMyAmount: p.amount }), glsl: 'color.rgb *= 1.0 - uMyAmount * length(vUv - 0.5);' }`.
  Fused effects that are on and next to each other in one slot (never `scene`) compile into one shader and draw in one pass, in `order`. The
  snippet edits `vec4 color` and may use `vUv`, `tDiffuse`, `uTime`, `uResolution`, `fxHash(vec2)`; uniform names are shared by the group, so prefix
  them with the effect name. A snippet that samples `tDiffuse` elsewhere (blur, color fringe) sets `reads: true` and starts a new group.
  `look.post.add({ name, fuse: { glsl }, slot: 'ldr' })` adds just a snippet.
- Outline: `outline({ mode: 'depth' | 'normal' | 'both' })`: `depth` (default, silhouettes), `normal` (creases; draws the scene once more with
  normals, so it is `costly`), `both`. `fadeWithDistance: false` keeps lines at any distance; `wobble: 1.5` jitters lines by up to 1.5 px at 8 steps a
  second. To exempt objects: `outline({ offLayer: OUTLINE_OFF_LAYER })` and `mesh.layers.enable(OUTLINE_OFF_LAYER)` (one extra render of just
  those objects; nothing when `offLayer` is `null`).
- Ambient occlusion (darker creases and contact corners): `ao({ radius, intensity })` wraps three's `GTAOPass`; `radius` is in world units
  (default 0.25), `intensity` 0..1 (default 1), both change in place: `look.post.set({ 'ao.enabled': true, 'ao.radius': 0.6 })` (with `ao()` added
  by a style plugin or the game), or `look.post.add(ao({ enabled: true }))` at run time. Order 20 runs it before bloom and the tone mapping. It follows resize,
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
  throws and names the call). A fog of your own is the direct write below: `scene.fog = new THREE.Fog(...)`.
- **Written directly** without `manual`: the engine notices, **stops writing it and keeps your value**, and warns once with the `manual` call and the
  hand-back call. This happens in release builds too (only the warning is dev-only), so a game behaves the same with and without checks.
- A `timeline.tween` on an object is a temporary takeover of that object only: no warning, no hand-over (other objects stay checked).

`engine.describe().owned` lists every registered value and who writes it now, as `writer` (`engine`, `manual:game`,
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
| `toneMapping` | tone | once, at `createEngine` (`style.toneMapping`, else AgX); a direct write yields with no warning (it is the documented way) | `engine.renderer.toneMapping = THREE.ACESFilmicToneMapping`; an own curve as a post stage: `engine.look.post.add({ name, slot: 'tone', create })` (or `node` on WebGPU; replaces OutputPass / renderOutput; outputs display color), or `engine.look.tone.manual('toneMapping')`; `manual('toneMapping', false)` writes the creation curve back | - |
| `exposure` | tone | sky, every frame, only with exposure keyframes | `engine.look.tone.manual('exposure')` | `engine.look.tone.set({ exposure: 1.2 })` |
| `background` | sky | sky: a backdrop color or skybox every frame; with the dome the dome hides when you take it | `engine.look.sky.manual('background')`; whole sky: `look.sky.replace(texture \| object3D)` | `engine.look.sky.set({ backdrop: '#335577' })` |
| `env` | env | sky, every frame: the room map's intensity (ambient column); a `'sky'` environment is rebuilt on its interval | `engine.look.env.manual()` | `engine.look.env.set({ intensity: 0.8 })`, `look.env.replace('sky' \| 'asset' \| myTexture \| myPmremTarget)` |
| `camera.far` | view | fog distance / terrain view range (`terrain({ viewFog })`, `setViewChunks`) | `engine.look.view.manual('far')` | - |
| `camera.fov` | view | the settings menu fov slider, camera modules (first person / rts fov, fixed shots, back to the install fov on a switch) | `engine.look.view.manual('fov')` | - |
| `pixelRatio` | view | adaptive resolution, about once a second while slow | `engine.look.view.manual('pixelRatio')` | `engine.setPixelRatio(1.5)` |
| `camera` (position, rotation) | view | the camera module, every frame | `const cam = engine.takeCamera('me')` (`cam.remove()` gives it back) | - |
| `post.chain` | post | whenever the effect list changes (set / add / replace, MSAA): the engine rebuilds the composer passes (WebGL) or `pipeline.outputNode` (WebGPU) | `engine.look.post.manual()`: the built chain stays as you left it in `engine.post.object()`; `manual(false)` rebuilds it from the list. A write to `object()` without `manual` does not yield: the next chain change replaces it | `engine.look.post.set({ bloom: { strength: 0.6 } })` |
| `shadow.csm` (not a property: a list) | shadow | while `cascades > 1`: the `csm` patch goes on every built-in lit material, yours too (else N times as bright) | - (lower `cascades` to 1); your ShaderMaterial is left alone until `engine.look.shadow.include(mat)` | - |

Material live keys (`look.materials.set({ wood: { color } })` on materials already made) are per material, not one row: a key the
`makeMaterial('wood', { color })` call passed itself is never overwritten, and a value you set by hand afterwards (`m.color.set(...)`) is
skipped with one warning. Order: by hand > the call's params > `look.materials.set` > the style.

Not in this table, because the engine writes them once rather than keeps writing them: automatic batching (it moves engine-placed meshes to layer 31
and says so once in the dev console and in `describe().perf.batching`; turn it off per object with `userData.batch = false`, see
[05-props-bake.md](05-props-bake.md) §2b) and `castShadow` on generator props (set when the model is made: a generator's own flags are kept, the
manifest entry can set them; change it on the object afterwards).

## How look values stack

Every `look.<part>.<key>` is a shared point (recipe 55), so one rule holds for all of them: **the game sets a base value, effects multiply on top,
the player's settings cap it.**
```js
engine.look.lights.set({ sun: { intensity: 3 } }, { owner: 'arena' });   // the base (replaces the style / keyframes); rain still dims it: 3 × 0.6
engine.mod('look.lights.sun.intensity', { owner: 'cave', mul: 0.3 });     // cooperate: entries multiply; the handle's remove() ends yours
engine.mod('look.fog.far', { owner: 'storm', mul: 0.6, layer: 'effect' }); // an effect module writes the effect layer
engine.describe().shared['look.lights.sun.intensity'].how;                 // 'arena 3 × sky:horizon 1 × weather 0.6 × cave 0.3'
```
- `set` decides, `mul` / `add` cooperate. Two owners `set` one value on one layer is the dev error `shared-conflict`; copy one of its fixes.
- The exact number whatever the weather: `engine.look.lights.manual('sun')` and write the three.js light, or set on `{ layer: 'system' }`.
- The settings menu only restricts (`shadows` off is `look.shadow.enabled` set false on the settings layer); a game's `enabled: true` does not
  switch them back on, and a cutscene's `false` is not undone by the menu. `describe().shared` names who decided and who is hidden.
- A direct three.js write (`engine.lights.hemi.intensity = 0.2`) still works: the engine yields, describe says `three (engine yielded)`.
- `look.sky.tint`, `look.ground.cover` (blend by amount) and `look.sky.flash` (adds) are points of the same kind, written with `engine.mod`.

## Lower-level forms that stay

Per-call `makeMaterial(role, params)` keys win for that one material; `applyEffects(mat, { patches })` is the low-level form of `look.materials.add(name, spec, { roles })`; `style.materials`, `style.terrain.*`, `style.wind.*` and `style.lighting` are the style layer of `look.materials` / `look.ground` / `look.wind` / `look.surface`.
