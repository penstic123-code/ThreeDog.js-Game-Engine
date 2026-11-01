# 52 Change any look: `engine.look`

Every look part lives at `engine.look.<part>` and is changed with the same verbs. The style pack gives the starting values; the game changes them on top.

```js
const cave = engine.look.tone.set({ exposure: 0.6 }, { owner: 'cave' });   // only the keys you give; null drops a key
engine.look.lights.set({ sun: { intensity: 0.5 } }, { owner: 'cave' });
cave.remove();                         // or engine.look.tone.clear('cave'): the style value shows again
engine.look.env.replace('sky');        // take a part over whole; replace(null) gives it back
engine.describe().look.tone.exposure;  // { value: 0.6, by: 'game:cave', at: 'main.js:12', under: ['style'] }
engine.catalog('look.tone');           // params with default, why, off; hooks; what replace accepts and loses
```

- Layers, upper wins: engine default < style < game (each owner; the last one written wins) < `engine.debug.override(owner, 'look.<part>', values)`.
- `set` / `patch(name, glsl)` / `replace(impl)`: a part offers only the verbs that make sense for it; the others throw with the verb to use. A part whose verb takes other arguments (`materials.replace(role, impl)`) lists the call shape in `engine.catalog('look.<part>').signatures`, and a wrong call quotes it.
- `by` in describe is `'engine'`, `'style'`, `'game'` (owner `'game'`), `'<layer>:<owner>'` (for example game:cave or debug:probe: the layer, then the owner you passed) or `'three'`. `describe().render` keeps only renderer facts; its `by` is the path of the record to read here (`'look.tone.exposure'`).
- Look changes are not saved: after a load, set them again from your own state.
- Changing the three.js object directly (`engine.renderer.toneMappingExposure = 2`) still works; describe tags it `three` and you lose the owner and the debug layer.
- Old calls and names throw `renamed-api` and name the new call: see [Renamed in 0.2](#renamed-in-02).
- Your own module's part: `defineLookPart(engine, { id, params, style, apply })`. Every param declares `default`; a default that changes the picture declares `why` and `off`, or `neutral: true` (checked by `npm run check`; R36 checks that the part's `Look<Part>` type lists the same keys). A part author changes records only through the part's methods `write`, `ownerValue`, `extend`, `retract`, `has`, `resolved`, `restyle` (rule R25 flags `part._...`); `validate(key, value)` in the spec rejects a value before anything is written, and an `apply` that throws leaves no layer behind.

## Atmosphere parts (sky module): fog, sky, shadow

```js
engine.look.fog.set({ far: 220, color: '#9bb' }, { owner: 'cave' });      // kind, color, density, near, far, height, falloff, enabled
engine.look.fog.replace('manual');                                         // or a THREE.Fog: the sky stops writing scene.fog; replace(null) gives it back
engine.look.sky.set({ clouds: { coverage: 0.7, speed: [0.01, 0] }, backdrop: 0x335577 });
engine.look.sky.patch('layer:aurora', { glsl: '...threedogSkyLayer...', blend: 'add' });   // a named dome layer; patch('layer:aurora', null) removes it
engine.look.sky.patch('clouds', glsl);                                     // the cloud function; replace(skyboxName | Texture | Object3D) swaps the dome
engine.look.shadow.set({ type: 'vsm', radius: 3, cascades: 3, maxFar: 150 });   // set only
```

- `fog` shows `enabled` and `far` (fog reaches full strength at `engine.fogFar`, starting at 0.3 x that) as the visible defaults; turn off with `set({ enabled: false })`. Color, density, near, far, enabled and linear <-> exp2 are live. Kind `'exp'` / `'height'`, `height`, `falloff` and the `'fog'` hook replace three's shared fog shader chunks, so they only work before the first frame (style, `sky({ fog })`, or right after `createEngine`); later they throw and say so.
- `sky`: `clouds.*` are live uniforms of the dome (they only draw when `clouds.coverage` > 0). A hook change recompiles the dome material once. Style `layers` arrays are named by their `name` key, else `layer0`, `layer1`.
- `shadow`: no `patch` (the cascade patch is internal) and no `replace` (to own the shadows, light with your own lights: `sky({ sun: false })`).

## Surface parts: `materials`, `surface`, `ground`, `wind`

A change to these parts reaches the materials made **after** it, with one exception: `look.materials.set` of the plain properties `color`, `emissive`, `emissiveIntensity`, `roughness`, `metalness`, `opacity`, `envMapIntensity`, `shininess` and `specular` also changes the materials already made for that role (no recompile; clearing the layer goes back to the style's value). Shader-changing keys (`type`, `steps`, `ramp`, `soften`, `repeat`, `wrap`, `detail`, `lighting`, `patch`, `replace`) and all of `look.surface` are for new materials only (a Material already handed out, or cloned by your game, is not touched; catalog and describe say so as `appliesTo`, and a debug override warns). `engine.look.<part>.object` is the three.js object behind a part; for `materials` it is a function: `engine.look.materials.object('wool')` is the last Material made for that role, `object()` all of them.

```js
const L = engine.look;
L.materials.set({ wool: { roughness: 0.4, color: 0xf2ece0 } }, { owner: 'shop' });   // merged into style.materials.wool; any role name
L.materials.patch('dim', { glsl: { fragment: { color_fragment: 'diffuseColor.rgb *= 0.8;' } } }, { roles: ['wool'] });   // a ShaderPatch on those roles
L.materials.replace('wool', new THREE.MeshMatcapMaterial({ matcap }));                // the role is this Material (or (params, purpose, engine) => Material)
L.surface.set({ lighting: { wrap: 0.3, shadowTint: { color: '#4a5a9a', strength: 0.5 } }, detail: { noise: 'grain', strength: 0.15 } });
L.surface.set({ ramp: [0.35, 0.7, 1], soften: 0.2 });                                  // every toon material's ramp
L.surface.patch('lighting', glsl);                                                      // your threedogLighting(...), see recipe 43
L.ground.set({ shading: 'flat', colors: { grass: '#7cc06b' } });                        // colors / biomeColors / steep / variation / shading rebuild the chunks
L.ground.set({ detail: { noise: 'paper', scale: 0.4, strength: 0.25 } });               // detail layer on the ground (style.terrain.detail)
L.ground.replace((e) => myGroundMaterial(e));                                           // Material or (engine) => Material; replace(null) gives it back
L.wind.set({ frequency: 1.5, amplitude: 0.5 });                                         // live on every plant, planted ones too
L.wind.patch('sway', glsl);                                                             // threedogWind(...); read when vegetation.add runs, so patch first
```

- `materials`: `set` / `patch` / `replace` all name a role. `set` merges into spec entries; a role whose style entry is a Material or a function is changed with `replace`. Role names are free: invent new ones (`makeMaterial('lantern-glass')`); the engine only warns on a likely typo of a known role.
- `surface`: `set` / `patch('lighting' | 'detail', glsl)`; no `replace` (swap a whole material with `materials.replace`). `style.lighting` is the style layer.
- `ground` (terrain module): `set` / `patch('detail', glsl)` / `replace`. What `terrain({ colors, shading, material })` was given shows as owner `terrain()`.
- `wind` (vegetation module): `set` / `patch('sway', glsl)`; no `replace`. `style.wind` is the style layer.
- `set({ role: { key } })` accepts a key `makeMaterial` reads (type, steps, ramp, soften, repeat, wrap, detail, lighting, or a three.js material property); a typo throws.
- `look.cloudShadow` (cloud shadows, core) stays its own part: its `shadow` is read by every material and by the weather, not only by surfaces.

## Water, weather, post

```js
engine.look.water.set({ opacity: 0.5, waveHeight: 2 }, { owner: 'storm' });          // live, no recompile
engine.look.water.set({ foam: { color: 0xffffff }, depthColor: { shallow: 0x88ccdd, deep: 0x003355 } });   // rebuilds the water material once
engine.look.water.patch('wave', 'float threedogWaterWave(vec3 p, float t) { return sin(p.x + t) * 0.2; }');   // hooks: wave, surface
engine.look.water.replace((engine, { uniforms, waves, surface }) => myMaterial);      // the whole surface (style.water.material)

engine.look.weather.set({ 'rain.speed': 10, 'snow.size': 8, 'lightning.brightness': 0.5, overcastColor: '#667' });   // rebuilds that field's particles once
engine.look.weather.patch('rain.fragment', wholeFragmentShaderText);   // rain|snow . vertex|fragment: the WHOLE shader text, not a function
engine.look.weather.replace({ ash: { shape: 'soft', color: 0x555555 }, rain: { create } });   // = weather.define; null gives the fields back

engine.look.post.set({ bloom: { strength: 0.6 }, vignette: false });                   // keys: '<effect>.<param>', '<effect>.enabled'
engine.look.post.patch('tint', { glsl: 'color.rgb *= vec3(1.0, 0.9, 0.8);', slot: 'ldr', order: 5 });   // generates a fuse effect named 'tint'; patch('tint', null) removes it
engine.look.post.add({ name: 'scan', slot: 'hdr', order: 5, create: (ctx) => myPass }, { owner: 'cave' });   // ONE custom pass; returns { remove() }. Same errors as the chain (duplicate name, second 'scene' pass, depth order) and nothing is added. Tune it with set({ 'scan.<param>': v })
engine.look.post.replace([bloom(), grain()]);                                          // swaps the whole chain; replace(null) gives the style chain back
```

- Water: structural keys (`depthColor`, `foam`, the hooks, `replace`) rebuild the shared material once and hand it to every water mesh; the live keys only write a uniform. `water({ opacity: 0.5 })` options are the game layer.
- Weather: a field the weather table lacks (`snow` in a desert) has no particles; setting it warns once. `replace({ [field]: spec })` holds one object per owner, so list every field you replace in each call; while a field is replaced, `set` on it is ignored.
- Post: `look.post.set` writes the `game` layer (keys `<effect>.<param>` and `<effect>.enabled`); style effects (bloom, ao ...) are the style layer; `engine.post.get(name)` only reads an effect. MSAA is `engine.post.setAntialias(on)`. Costly effects start off on low-tier devices: `look.post` lists `<effect>.enabled` with `why` and `off`. `postAdd` / `postRemove` stay style-pack parts (they edit the list before the engine exists).
- `describe().render.post` reads the same records (`by`: style, game, debug).

## sky.modify vs look.lights

Two ways to make the light darker or brighter; pick by what you want to keep.
- `engine.sky.modify('cave', { sun: 0.3, ambient: 0.4, fog: 0.5, tint, tintAmount })` is a **multiplier layer** on what the sky produces each frame (keyframes, weather, season). The time of day keeps moving underneath, layers from different owners multiply, `modify('cave', null)` removes yours, and `sky.modifiers` shows the combined result (read-only). Use it for "darker in the cave" or "ash over the ground" (`groundCover`, `coverAmount`).
- `engine.look.lights.set({ sun: { intensity: 0.5 } }, { owner: 'cave' })` is an **override layer** on the part's own values: the key you give replaces what the style or the keyframes said, whatever the hour. Use it for "the sun is exactly this".
## Renamed in 0.2 (old call → new call)

The old calls below now throw `renamed-api` and the message names the new call (the list is `RENAMED` in `core/renamed.js`; rule R39 keeps the old names out of the repo).

| Old call | New call |
|---|---|
| `engine.setExposure(v)`, `engine.setToneMapping(m)` | `engine.look.tone.set({ exposure: v })`, `engine.look.tone.set({ mapping: m })` |
| `engine.sky.setShadow(o)` | `engine.look.shadow.set(o)` |
| `engine.sky.setEnvironment(o)` | `engine.look.env.replace('sky')` then `engine.look.env.set({ intensity, rotation })`; `replace(false)` turns it off |
| `engine.weather.define(field, spec)` | `engine.look.weather.replace({ [field]: spec })` |
| `engine.post.add(effect)` | `engine.look.post.add(effect, { owner })` (one pass, returns `{ remove() }`), `engine.look.post.patch(name, { glsl })` (a color effect) or `engine.look.post.replace([...effects])` (the whole chain) |
| `engine.post.enable(name, on)`, handle `.set` / `.enable` / `.remove` | `engine.look.post.set({ 'bloom.enabled': on })`, `engine.look.post.set({ 'bloom.strength': 0.6 })`; MSAA: `engine.post.setAntialias(on)` |
| `engine.look.clouds` | `engine.look.cloudShadow` |
| `engine.cameraOverride = { owner }` | `const cam = engine.takeCamera('owner', { focus })`; `cam.remove()` releases it |
| `engine.views.define(name, { pos })` | `engine.views.define(name, { position: [x, y, z] })` |
| failure `result.reason` (`ops.run` / `can` / `undo`) | `result.code` (reading `reason` throws) |

Not renamed (still the way to do it): per-call `makeMaterial(role, params)` keys win for that one material; `applyEffects(mat, { patches })` is the low-level form of `look.materials.patch(name, spec, { roles })`; `style.terrain.*`, `style.wind.*` and `style.lighting` are the style layer of `look.ground` / `look.wind` / `look.surface`.
