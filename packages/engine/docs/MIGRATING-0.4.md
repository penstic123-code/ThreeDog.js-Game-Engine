# Moving a game from 0.3 to 0.4

Upgrade steps for what an existing 0.3 game runs into, the most common first; [CHANGELOG.md](../CHANGELOG.md) lists every change. Each item is:
what you see (the error code in square brackets, or the silent symptom) → what to write instead.

## The 0.2 name traps are gone

- The dev-only errors for 0.2 names (`[renamed-field]` on `clock.timeScale`, the sky's calendar fields such as `sky.timeOfDay`, a failed
  result's `.reason`, `runState.by`, `describe().ui.inputContexts`; dialogue `{ lock }`, `style.pickup.model`, an item's `mesh`) were removed as
  announced. *silent*: reading one of those names now gives `undefined`; unknown option keys (`{ lock }`, `style.pickup.model`) still throw
  `[module-params]`. A 0.2 game moves to 0.3 first with [MIGRATING-0.3.md](MIGRATING-0.3.md).

## Shadows, fog and sky values go through look

- `createEngine({ shadows, shadowType })` `[module-params]` → `engine.look.shadow.set({ enabled, type })` (works without a sky).
- `engine.setShadows(on)` / `engine.shadows` / `engine.shadowType` → `engine.look.shadow.set({ enabled: on })` / read `engine.look.shadow.value('enabled')`.
- `look.lights.set({ sun: { shadow } })` → `engine.look.shadow.set({ enabled })`.
- `createEngine({ fogFar })` `[module-params]` → `style.sky.fog.far` or `sky({ fog: { far } })` for the start value.
- `engine.setFogFar(d)` / `engine.fogFar` → `engine.look.fog.set({ far: d })` / `engine.look.fog.value('far')`.
- `engine.mod('sky.sunLight' | 'sky.ambient' | 'sky.fog' | 'sky.tint' | 'sky.flash' | 'sky.cover', ...)` → `engine.mod('look.lights.sun.intensity' |
  'look.lights.hemi.intensity' | 'look.fog.far' | 'look.sky.tint' | 'look.sky.flash' | 'look.ground.cover', ...)`.
- `engine.sky.modifiers` → `engine.stacks.get('look.fog.far').value()` (one point by name) or `describe().shared`.
- *silent*: `look.lights.set({ sun: { intensity: 3 } })` now dims in rain and at sunset (effects multiply on the game's value) → for the exact
  number, `look.lights.manual('sun')` or `{ layer: 'system' }`.
- Two owners `set` the same look value on one layer `[shared-conflict]` → one owner, or `mul` / `add`, or another `layer`.
- `engine.mod(name, { priority: 'base' | 200 })` → `{ layer: 'engine' | 'style' | 'game' | 'effect' | 'settings' | 'system' | 'debug' }` (no numbers).
- *silent*: a weather `far` no longer scales an explicit fog `density` (only `far`).

## Keys: modules declare actions, the game binds

- `inventory({ keys, pad })`, `quests({ keys, pad })`, `photo({ keys, pad })`, `interactions({ keys })`, `settings({ keys })`, `triggers({ keys })`,
  `grids.preview({ rotateKeys })`, `rtsCamera({ rotateKeys })` (`rotate: false` turns it off), `characters({ brakeKeys, brakePad })`, `createPlayer({ jumpKeys, runKeys })`,
  `timeline({ skipKeys })`, `dialogue({ choiceKeys })` `[module-params]` → bind the action in the game:
  `createEngine({ bindings: { ...presets.bindings.walk, ...presets.bindings.interact, ...presets.bindings.inventory } })` or `engine.input.bind(map)`.
  The maps: `presets.bindings.walk / interact / inventory / quests / photo / gridRotate / rtsRotate / brake / dialogNumbers / cutsceneSkip / debug`.
- `presets.keys.*` → `presets.bindings.*`; `presets.player.*` / `presets.interactions.*` carry no keys any more (spread `presets.bindings.walk` /
  `.interact`).
- `createEngine({ padBindings: { jump: 'PadA' } })` → pad buttons sit in the same list: `bindings: { jump: ['Space', 'PadA'] }`.
- `engine.input.define(action, keys, label, { pad, context })` → `engine.input.action(action, { label, context, keys: [...keys, pad] })`
  (a module: `ctx.input.action(name, { label, context })` with no keys; the game binds them).
- *silent*: F3 (debug panel), F4 (triggers view), number keys 1-9 in dialogue and the cutscene skip keys are no longer bound → spread
  `presets.bindings.debug`, `.dialogNumbers`, `.cutsceneSkip` into `bindings`.
- `input.rebind(action, keys)` is a settings-layer binding: `rebind(action, null)` gives the game's keys back; `input.rebound()` is what to save.
- The base input context is `'walk'` (was `'gameplay'`): `input.action(name, { context: 'gameplay' })` → `context: 'walk'`; dialogue pushes `'dialog'`.
- Two owners binding one action `[input-bound-twice]`; one action declared in two contexts `[input-action-context]`; a needed action left unbound
  warns `[input-unbound]` once.

## Character control has one owner

- `player.control = fn` or `createPlayer({ control: 'none' })` / `presets.player.none` → the player's `control` is given once at `createPlayer`;
  to steer it for a while, `const h = engine.control.take(player, { owner: 'myScript', layer: 'script', step: (dt, ch) => ({ x, z }) })`,
  `h.remove()` gives it back. Standing still: a step (or a `control` function) returning `null`.
- `timeline.play(steps, { lockInput })` `[module-params]` → `{ actors: [...] }` (default: the player); a cutscene holds their control on layer
  `'cutscene'`.
- `character.move()` from code that does not hold the control `[control-bypass]` → take control first (in a module: `ctx.control.take(ch, { layer, step })`).
- Two owners on one layer `[control-conflict]`; moving a remote (net) character `[control-net]`.

## One time source

- `engine.elapsed` `[renamed-field]` → `engine.time.now('real')` (fixed seconds, stops while frozen) or `engine.time.now('ambient')` (keeps moving).
- `engine.time.real` → `engine.time.now('real')`; `engine.time.tick` / `engine.tick` is the one counter.
- `describe().elapsed` → `describe().time` (`tick`, `real`, `ambient`, `calendar`).
- *silent*: `engine.clock.now` is read-only (writing it throws `[engine-misuse]`) → `engine.skip({ seconds })`.
- *silent*: a timer removed earlier in the same step no longer fires; `skip({ to: '06:00' })` lands just past the mark.
- 0.3 saves load: the old `'clock'` save part is read into `'time'`.
- `engine.time.manual(name, fn)` is gone: it replaced the channel's speed outside the shared point, so a second call silently won →
  `engine.mod('time.<channel>', { owner, set: speed })` (one owner each; two `set`s on one layer are `[shared-conflict]`; the handle's `remove()` gives it back).

## Handles end with remove(); timing arguments are options

- A tween promise's `cancel()`, a `dialogue.say()` promise's `stop()`, a look part's `dispose()` → `remove()`.
- Positional seconds throw `[module-params]` in dev → options objects:
  `h.fade(to, s)` → `h.fade({ to, seconds: s })`; `h.stop(s)` → `h.stop({ fade: s })`; `music.stop(fade)` → `music.stop({ fade })`;
  `timeline.tween(t, to, d, ease)` → `tween(t, to, { duration: d, ease })`; `fadeScreen(engine, to, s)` → `fadeScreen(engine, to, { seconds: s })`;
  `anim.go(state, fade)` / `anim.action(name, fade)` → `{ fade }`; fixed camera `blend(name, s, ease)` → `blend(name, { seconds: s, ease })`.

## Engine options and three.js

- `setValidate(on)` → `createEngine({ validate: on })` (per engine, `engine.validate`).
- A wrong shape for a `createEngine` option (`batching: 'yes'`, `fov: 'wide'`) or an unknown `fallback` now throws `[module-params]`.
- *silent*: `Mesh.prototype.raycast` is three's own again; a game whose own `THREE.Raycaster` relied on the engine's BVH sets up three-mesh-bvh
  itself (registered static meshes still have one). The two remaining class changes are listed in `describe().threePatches`.
- `inventory({ pauseGame })` of the wrong type is `[module-params]` (was `[inventory-misuse]`).

## Physics, nav, weather, collision

- `weather.set('rain', 20)` throws `[module-params]` in dev → `weather.set('rain', { seconds: 20 })`.
- *silent*: `engine.collision.boxes.length` / `.circles.length` is `undefined` (they are Sets now) → `.size`; `boxes.filter(...)` → `[...boxes].filter(...)`.
- *silent*: pushing to or splicing `engine.interactions.items` does nothing (it is a fresh array per read) → `interactions.add` / the handle's `remove()`.
- A module of yours that copied the collision statics into another world (`forEachStatic` plus a version check) can use
  `engine.collision.mirror({ add(type, data) { return piece; }, remove(piece) {} })` and call `sync()` each step.
- *silent*: a game listening to `rigid:rebuilt` sees it once per `newGame()` / `load()` (it fired twice with the world module).
- Storm rhythm and nav capacity were constants: `weather({ lightningInterval: [2, 6] })`, `nav({ maxObstacles: 4096, maxAgents: 256, arrive: 0.3 })`.

## Plain three.js is adopted

- `engine.scene.add(obj)` now registers each root under the scene like `engine.add(obj)`: `engine.thing(obj)` works, `describe().scene.game`
  counts it. Code that relied on scene.add staying invisible (counting things, `engine.thing` throwing) sees the object now. A module that
  puts its own objects in the scene marks them first: `scene.add(engineOwned('mymodule', obj))` (`core/things.js`), or `engine.add(obj, { owner: 'engine:mymodule' })`.
- *silent*: a plain lit material of yours (`new THREE.MeshStandardMaterial(...)` and the other lit types) now darkens under the engine's
  cloud shadow like the ground does. A material that must stay unshaded (a screen, a hologram, a UI panel in the world) sets
  `material.userData.cloudShadow = false` before it enters the scene; `describe().owned['cloudShadow.plain']` lists what was adopted.
- A `look.post.add({ name, create: () => pass })` that only wraps one Pass can be `look.post.add(pass, { name })`.
- A game that renders the canvas itself (own `EffectComposer.render()` / `renderer.render` outside `engine.onRender`) no longer gets a second
  engine frame drawn over it: the engine yields and warns once `[own-frame]`. Draw overlays inside `engine.onRender(fn, { when: 'after' })`.

## Module types and capabilities

- `module X has no type` `[module-type]` → add `type` to every module the game writes: `engine.use({ name: 'shop', type: 'rules', install(e) { ... } })`.
  `'rules'` is game logic (the usual one); `'look'` only shows things, `'ui'` is panels and menus, `'world'` holds state and draws nothing
  (recipes/14-custom-module.md has the table).
- `module X (type 'look') defined op ...` / `(type 'ui') bound keys ...` `[module-type-rule]` → do what the message says: move the op or the
  save part into a `rules` module, bind keys in the game (`engine.input.bind` or `createEngine({ bindings })`), or change the module's type.
- `module X requires 'Y', which no installed module provides` `[module-requires]` → install the engine's `Y()` first, or a module of your own
  with `provides: ['Y']`. `requires` names a capability; the built-in ones are named after the engine modules.
- *silent*: `describe().modules` is a list of `{ name, type, provides?, requires? }`; code that did `.includes('sky')` now reads
  `.some(m => m.name === 'sky')`.
- `presentation: true` on a module is gone: the type decides. A `look` or `ui` module whose hook throws is switched off (`module:disabled`) and
  the game keeps running; any other type freezes gameplay in dev. Delete the field. *silent*: a `look` / `ui` module of yours that had no
  `presentation: true` used to freeze the game on an error; now only that module stops.
- `stage: 'world'` / `stage: 'presentation'` `[module-stage]` → `stage: 'ground'` / `stage: 'effects'` (same place in the order; `stage` only orders hooks).

## Weather is state + look

- `engine.weather.systems`, `.flash`, `.apply(camera)`, `.particles`, `.area` → `engine.weatherLook.*` (the look half). `engine.weather` keeps
  the table, `current`, `name`, `set`, `setAuto`, `label`, the save and the events.
- `describe().weather.rainVisible / snowVisible` → `describe().weatherLook.rainVisible / snowVisible`.
- `weather()` returns two modules; `engine.use(weather(...))` and `openWorld()` install both as before. Code that read `weather().name` reads
  `weather()[0].name`. To change only the look, replace that half: `engine.use(myRain(), { replaces: 'weatherLook' })` with `provides: ['weatherLook']`
  on yours; the weather state, its save and its events stay.

- *silent*: the weather look's entries on `look.lights.*`, `look.fog.far`, `look.sky.*`, `look.ground.cover` are owned by `'weatherLook'`, not `'weather'`:
  code that found them with `holders().find(h => h.owner === 'weather')` reads `'weatherLook'`.

## Terrain and vegetation are data + look

- `c.terrain` / `c.group` on a terrain chunk → `engine.terrainLook.meshes.get(c)` (`{ group, mesh, ... }`); the chunk keeps only data (`c.data`).
- `c.veg[name]` / `c.vegGroup` → `engine.vegetationLook.mesh(c, name)`; placement data is `c.plants[name]` (`n`, `m`, `c`, `ids`), felled
  slots `c.hidden[name]`. `im.userData.hidden` / `im.userData.ids` → `c.hidden[name]` / `c.plants[name].ids`.
- `vegetation.define(...).geometry / .lodGeometry / .material / .fadeUniforms` → `engine.vegetationLook.kind(name)`.
- `terrain()` and `vegetation()` return two modules each; `engine.use(...)` and `openWorld()` install both. To draw the ground or the plants your
  own way: `engine.use(mine, { replaces: 'terrain-look' })` with `engine.terrain.view({ add, change, remove, show })`, or
  `{ replaces: 'vegetation-look' }` with `engine.vegetation.view({ species, change, ring, show, drop })` (recipe 28 section 6).
- *silent*: the ground colors (`style.terrain.colors / biomeColors / steep / variation`, the look keys of `style.terrain.config`) are read by
  the terrain look; with `{ replaces: 'terrain-look' }` the chunks carry neutral gray vertex colors. The `terrain({ viewFog: true })` fog
  distance is written by the look too (owner `'terrainLook'`, was `'terrain:view'`) and leaves with it: a look of your own that wants it reads
  `engine.terrain.viewFogFar` and writes `ctx.mod('look.fog.far', { layer: 'engine', set })`.
- *silent*: a terrain rule that throws no longer leaves loading waiting for ever: after 3 tries the chunk stays empty and `[terrain-chunk-failed]`
  is reported; `engine.terrain.retry()` sends it again.

## Calendar reads the time source

- `calendar.tick(dt)` is gone: the calendar's time of day and day are views of the `'calendar'` time channel. Move time with `engine.step` /
  `engine.skip`, or set `calendar.timeOfDay` / `calendar.day` (they move the origin).
- *silent*: `day:start`, `season:change` and `calendar.at` timers fire right after time moves (`engine.time.onMove`), no longer inside the
  calendar's fixed hook; a listener that read state another fixed hook writes in the same step sees that step's value.

## Module boundaries

- `describe().player.running` / `.jumping` are gone: use `describe().player.state === 'run'` (or `'jump'` / `'fall'`).
- Your own module's loading-screen name: register it with your text, `engine.i18n.add({ 'zh-CN': { 'module.shop': '商店' }, en: { 'module.shop': 'shop' } })` in install (the label stays the fallback).
- A light pool of your own: mark each pooled light `light.userData.fixedCount = true` (the light-count warning used to skip names starting `lightPool_`).
- A clock module of your own that should switch night glow: register `engine.audio.measure('daylight', () => value01)`.
- Title screen `items: ['settings']` needs the settings module installed (it adds the button with `engine.ui.titleItem`); an extra button of yours: `ctx.track(engine.ui.titleItem('credits', { label, run }))`.
- A game's inventory replacement (`provides: ['inventory']`) used with net(): add `contents()` and `setContents(data, { only })` (see types/gameplay.d.ts).
- Code that set `engine.ops._route` / `_client`: use `engine.ops.route(fn)` (returns `{ remove }`); `engine.world._s.fixed = () => {}`: use `engine.world.pauseSimulation()`.

## Saves

- *silent*: while a part's `load()` Promise is pending, no fixed step runs and every op fails with code `loading`. A part that ran an op from its
  own async load must write its state directly instead (load already runs inside `ops.allow`).
- 0.3 saves load. The calendar part now also stores `at` (the channel second its time belongs to); a save without it takes the time as of the load.

## Ops and post

- `ops.list({ available: true })` returning an entry with code `badOffer` / `offersFailed` (it used to throw, and so did `describe()`): fix the
  op's `offers` (`facts.error` says why) so each offered arg set passes its `args`.
- A tone-mapping curve of your own as a post stage: `engine.look.post.add({ name: 'myTone', slot: 'tone', create: ctx => pass })` (or `node` on
  WebGPU) replaces OutputPass / renderOutput; it gets linear HDR color and must output display color. Only one effect can hold the slot.

## Material roles: one entry; style packs bundle look plugins; the lowpoly pack is gone

- `makeMaterial(role)` reads only `engine.look.materials`. The style's `materials` table is that part's style layer (specs, Material instances and
  functions alike); writing `engine.style.materials` at run time no longer changes anything: use `engine.look.materials.set({ role: {...} })` or
  `replace(role, material)`. `set` now also recolors a role whose style entry is a Material instance or function.
- A style may bring look plugins: `plugins: import.meta.glob('./plugins/*.js', { eager: true })` in the style object (the same files the game's
  `plugins/` folder takes). They are plugged by `engine.plugins` as `<style>/<file>`, on the style layer; `engine.plugins.off('<style>')` takes them out.
- The world example's big `lowpoly` style is deleted. Its procedural trees, rocks, humanoid and pickup shape are the example's art in
  `examples/world/art/` (`import { assets } from '.../examples/world/art/index.js'`); `examples/world/style/` is now a small look named `world`.
  The humanoid no longer falls back to built-in colors: give the roles `cloth`, `skin`, `trousers`, `hair` in your style.

## One way to add a post effect (2026-11-03)

Every post effect now goes in through `engine.look.post.add(x, { name, slot, order, owner })`; game code, the plugins folder and a style's
plugins all call it, so each effect has a name, an owner and on / off with `look.post.set`. Plan: `docs/plans/done/2026-11-03-one-post-entry.md`.

| Before | Now |
|---|---|
| `engine.post.addPass(pass)` | `engine.look.post.add(pass)` |
| `engine.post.insertPass(pass, i)` | `engine.look.post.add(pass, { order })` |
| `engine.post.removePass(pass)` | `const h = engine.look.post.add(pass); h.remove()` (the Pass is not disposed, as before) |
| `look.post.patch('grain', glsl)` | `look.post.add({ name: 'grain', fuse: { glsl }, slot: 'ldr' })` |
| style `post: [bloom(), grain()]` | `style/plugins/10-bloom.js: export default bloom()` (one file per effect) and `plugins: import.meta.glob('./plugins/*.js', { eager: true })` in the style; *loud*: `style.post` throws `[style-value]` |
| `postAdd(grain())` on top of a pack | a game `plugins/20-grain.js: export default grain()`, or `look.post.add(grain())` |
| `postRemove('ao')` | `engine.plugins.off('<pack>/<file>')`, or `look.post.set({ ao: false })` |
| `createEngine({ post: { bloom: true } })` | `look.post.set({ bloom: true })` after the effect is added (*loud*: the option throws `[post-effect]` and names the call); the engine ships no effects, so "turn on bloom" is `look.post.add(bloom())` |
| a plugin exporting `(input, ctx) => node` | `export default { name: 'glow', node: (input, ctx) => ..., create: ctx => pass }` (*loud*: a function export is `[plugin-shape]` on both renderers) |

- *silent*: a Pass that renders `engine.scene` itself (RenderPixelatedPass, SSAARenderPass, TAARenderPass) now replaces the scene render (slot
  `scene`) instead of running after it in `hdr`: the scene is drawn once a frame. Only one such pass at a time.
- *silent*: on WebGPU, removing an effect now disposes the nodes the engine built for it (bloom's targets leaked before).


## One small look API (2026-11-03)

Every `engine.look.<part>` has the same verbs: `set` (values), `patch(hook, code)` (swap one named hook; nothing else), `add` (one more named
thing: `look.post.add`, `look.materials.add`), `replace(thing)` (the one three.js thing the part draws), `manual(keys)`, and one read, `value(key)`.
A whole module is still `engine.use(mine(), { replaces: '<slot>' })`.

| Before | Now |
|---|---|
| `look.materials.patch(name, patch, { roles })` | `look.materials.add(name, patch, { roles })`; `patch(name, null)` to remove becomes the handle's `remove()` (*loud*: `materials.patch` throws `[look-verb]` naming `add`) |
| `look.fog.replace(new THREE.Fog(...))` | `engine.scene.fog = new THREE.Fog(...)` (the engine yields, describe says `three`); `look.fog.replace(null)` becomes `look.fog.manual(false)` (*loud*: `fog.replace` throws `[look-verb]` naming `scene.fog =`) |
| `part.write / ownerValue / extend / retract / restyle / has / resolved / values / top / point / drive / driven / feed / tick / batch / remove / signatures` on a part | the same names on `part.author` (module code only); `signatures` is also `engine.catalog('look.<part>').signatures` (*loud*: a call on the part is a TypeError) |
| `look.<part>.clear(owner)` (typed, never there) | drop the handle `set()` returned: `h.remove()` |
| writer `manual:look.fog.replace` in `describe().owned` | `three (engine yielded)` |

- *silent*: `collide: 'circle'` on a prop or template measures the model's base, not its widest extent, so trees and lamps block much less (a pine: 1.51 m -> 0.30 m). A row of such props that worked as a fence may now let the player through: write `collide: { circle: <radius> }` on it, or use `engine.collision.addSegment`.
- *loud*: a `collide` other than `false`, `'box'`, `'circle'` or `{ circle, occluder? }` throws at load (`collide: true` used to mean a box: write `'box'`).
- *silent*: `engine.catalog(...).verbs` lists a part's own named verbs too (`post`: `add`, `materials`: `add`, `glow`, `shadow`: `include`).

## Style tools become picture tools

- `threedog style check` → gone with style packs: a look is plain three.js in `look/`, and `npm run check` type-checks it.
- `threedog style palette | compare` → `threedog picture palette | compare`; bridge commands `style-palette`, `style-compare` → `picture-palette`, `picture-compare`; MCP tools `style_palette`, `style_compare` → `picture_palette`, `picture_compare`. Options and output are unchanged.
- `npm run check` no longer runs R34 (a game's `style/` folder).
## Module looks: options and materials

- `material spec { lighting: { rim, wrap, shadowTint } }` → a plain patch in the `lighting` slot through `applyEffects` (recipe 43); toon `ramp` → three.js `gradientMap` (recipe 09 §1).
- `createEngine({ style: { ui: { bg, accent, css, fonts, templates } } })` → `createEngine({ ui: { theme: { bg, accent }, css, fonts, templates } })`.
- *silent*: `style.ui.promptHeight` → `interactions({ promptHeight })`; `ui.theme.promptHeight` `[ui-misuse]`.
- `ui: { bg: '#123' }` (a color beside the part names) `[ui-misuse]` → `ui: { theme: { bg: '#123' } }`.
- *silent*: `style.pickup: { color, size, lift }` → `pickups({ color, size, lift })`; the `pickup` material role → `engine.pickups.material`.
- *silent*: `style.character.animation` → `characters({ animation })`; the capsule's `character` material role → `engine.characters.material`.
- *silent*: `style.triggers: { debugColor, debugOpacity }` → `triggers({ debugColor, debugOpacity })`.
- *silent*: `style.palette` → `engine.assets.palette` (plain object; `this.palette` in generators and the cache key read it). A baked file no longer stands in for a generator while a palette is set, unless it is `source: 'file'`.
- *silent*: a cached or baked model's material comes back as recorded, not rebuilt from the current material role; a toon `gradientMap` now counts as lost in the GLB (`{ build, cache: false }`). `assets.report()` `madeByStyle` → `madeByEngine`; `materialInfo` `from` is `'engine' | 'game'` and `keys` is gone.
- *silent*: `style.grid: { ok, bad, previewOpacity, previewHeight, tiles, tileLift }` → `grids({ ... })`, same keys; the `decal` role → `pv.material`, `layer.material`.
## The ground's look is plain three.js on the module

- `style.terrain.colors | biomeColors | steep | variation | detail`, the look keys of `style.terrain.config` → `terrain({ colors, biomeColors, steep, variation, detail, shading, colorResolution, normals, normalFn })`.
- `look.ground.set({ colors | biomeColors | steep | variation | shading | normals | detail })` → `engine.terrain.recolor({ ... })`; each value is given whole, `null` takes it out.
- `look.ground.replace(m)`, `style.terrain.material` → `engine.terrain.material = m`, drawn as given; `applyEffects(m, { patches: engine.terrain.patches })` keeps cloud shadow, season and detail.
- `look.ground.replace(m, { effects: false })` → `engine.terrain.material = m`, or `terrain({ material: m, effects: false })`.
- `engine.terrainLook.setMaterial(m)` → `engine.terrain.material = m`.
- *silent*: `style.terrain` is no longer read, and the default ground is the plain neutral material whatever `style.materials` says.

## The water's look is plain three.js on the module

- `look.water.set({ color | opacity })`, `style.water.color | opacity`, `style.materials.water` → `engine.water.material.color.set(...)`, `engine.water.material.opacity = ...`.
- `look.water.set({ waveHeight | waveScale | waveSpeed | fresnel })`, `style.water.*` → `engine.water.uniforms.uWave | uWaveScale | uWaveSpeed | uFresnel.value = ...`.
- `look.water.set({ depthColor | foam })`, `style.water.depthColor | foam`, `look.water.patch('wave' | 'surface', glsl)`, `water({ uniforms })` → `engine.water.shader({ depthColor, foam, wave, surface, uniforms })`.
- `look.water.set({ normalMap | normalScale | normalRepeat | normalSpeed })` → `engine.water.normalMap(name, { scale, repeat, speed })`; the texture field `engine.water.normalMap` → `engine.water.normalTexture`.
- `look.water.set({ shininess | specular })` → your own `MeshPhongMaterial` through `engine.water.material`.
- `look.water.replace((engine, { uniforms, waves, surface, normalMap }) => m)`, `style.water.material` → `engine.water.material = m`; the four are `engine.water.uniforms`, `.patches` (by `name`), `.normalTexture`.
- *silent*: `style.water` is no longer read, and the default water is the plain neutral Lambert whatever `style.materials` says.
## Plants take plain materials (2026-11-04)
- `look.wind.set({ frequency, amplitude })` → `engine.uniforms.uWindFreq.value`, `engine.uniforms.uWindAmp.value`.
- `look.wind.patch('sway', spec)` → `engine.vegetation.sway(spec)` (now reaches planted species too).
- `look.vegetation.patch('color', spec)` → `engine.vegetation.color(spec)`.
- `makeMaterial('vegetation')` default → neutral gray; `engine.vegetation.material = myMaterial` for all, `vegetation.define(name, { material })` for one.

## Weather looks are options and plain writes (2026-11-04)
- `style.weather.rain / snow / area / lightning / lightningBrightness / overcastColor` → the same keys on `weather({ ... })`. `style.weather.snow.cover` → `weather({ snow: { cover } })`.
- `style.weather.types` → removed; write the numbers in `weather({ types })`.
- `look.weather.replace({ field: spec })` → `engine.weather.define(field, spec)`; `null` as spec gives the field back.
- `look.weather.set({ 'rain.speed', 'rain.opacity', 'rain.slant' })` → `engine.weather.particles.rain.spec.speed = 30` (live, no rebuild).
- `look.weather.set({ 'rain.color', 'rain.length', 'snow.size', 'snow.sway' })` → `engine.weather.particles.rain.uniforms.uColor.value.set(...)`, `uLen`, `uPx`, `uSwayAmp`.
- `look.weather.set({ 'lightning.brightness', overcastColor })` → `engine.weather.lightningBrightness = 0.5`, `engine.weather.overcastColor.set(...)`.
- `style.particles.<name>`, `style.particles.default` → `particles({ effects: { name: spec }, default: spec })`; `fx.material` is get / set, `fx.uniforms` holds the `{ value }` objects.
- `look.weather.patch('rain.fragment', text)` → `engine.weather.define('rain', { glsl: { fragment: text } })`, or set `engine.weather.particles.rain.material`.

## The dev panel writes three.js directly (2026-11-04)

- `openPanel(engine, { overrides })` and `?ov=` → `openPanel(engine)`; "apply and rebuild" and "export overrides" are gone, values are written live and saved with "write back".
- `engine.styleWorkbench` → `engine.devPanel` (`{ pane, tune }`); `describe().stylePanel` → `describe().devPanel`.
- The panel's environment switch only turns on and off a `scene.environment` that is already there; making one is the game's call.
- Panel multipliers for sun, ambient and fog → each light's `intensity` and `scene.fog` near / far / density.
- The `threedog tune` block: `engine.look.<part>.set(...)` and `tunedStyle` → plain writes (`engine.scene.fog.far = 90;`, `engine.water.material.color.set(0x3388aa);`). A `.threedog/tune.json` saved before this: press "write back" again.

## Materials are plain three.js (2026-11-04)

- `makeMaterial('role', { color })`, `engine.makeMaterial` → `new THREE.MeshLambertMaterial({ color })` (any three.js material) in your `look/` code; `MATERIAL_PURPOSES` is gone with the roles.
- `look.materials.set({ role: { key } })`, `look.materials.replace(role, mat)`, `look.materials.object(role)`, `look.materials.rebuild()` → write your own material objects; a module's material is `engine.<module>.material`.
- `look.materials.add(name, patch, { roles })` → `applyEffects(material, { patches: [patch] })`.
- Spec keys `type`, `steps`, `ramp`, `soften` → `new THREE.MeshToonMaterial({ gradientMap: rampTexture(ramp, soften) })`.
- Spec keys `map: 'name'`, `repeat`, `wrap` → `engine.assets.useTexture(name, t => { mat.map = t; })`, then `t.repeat` and `t.wrapS`.
- `look.surface.set({ lighting })`, `style.lighting`, spec key `lighting`, `look.surface.patch('lighting', glsl)` → `applyEffects(mat, { lighting: { wrap, shadowTint, rim } })` or `{ lighting: { glsl } }`, per material.
- `look.surface.set({ detail })`, spec key `detail`, `look.surface.patch('detail', glsl)` → `applyEffects(mat, { detail })`, with `detail: { glsl }`.
- `look.surface.set({ ramp, soften })` → `rampTexture(ramp, soften)` on each toon material.
- `look.materials.glow(match, { night, day, dusk })` → `mat.emissiveIntensity` from `engine.uniforms.uNight` in your frame code (recipe 09 "Night glow").
- A Material or a ShaderPatch in `plugins/` → put it on its mesh or module in `look/`; `plugins.off / on` lost `{ rebuild }`, and `reach` / `rebuilt` are gone from their results and from `plugins.list()`.
- `userData.materialSource` is gone; `inspect.scene` says `from: engine | game`.
- Hint kind `material` of R40 is gone: remove it from `threedog.hints`.
## No style option: the look is game code (2026-11-04)

- `createEngine({ style })` → throws. Write the picture as plain three.js in the game's `look/` code; UI colors and CSS go in `createEngine({ ui })`.
- A style given as a list of parts (deep merge, `null` removes, `describe().look` naming the `pack`) → gone; game code composes plain values however it likes.
- `engine.style` → gone from the public API; read the three.js object or the module you are after.
- `style.background` → `engine.scene.background = new THREE.Color(0xefebe4)`.
- `style.antialias` → `createEngine({ antialias })`.
- `style.toneMapping`, `style.exposure` → `engine.renderer.toneMapping = THREE.AgXToneMapping`, `engine.renderer.toneMappingExposure = 1.2`.
- `style.plugins` → the game's `plugins/` folder, or `engine.plugins.add(files)`; plugin names lose the `<pack>/` prefix, `engine.plugins.off('<pack>')` and the `style` field of `engine.plugins.list()` are gone.
- `style.clouds.shadow / scale / speed` → `engine.uniforms.uCloudShadow.value`, `uCloudScale.value`, `uCloudSpeed.value.set(x, z)`.
- `style.wind.frequency` → `engine.uniforms.uWindFreq.value`.
- `style.seasons` → `engine.sky.seasonTints = { mode, strength, autumn: { foliage, ground } }`, plain data read every frame.
- `style.sky.shadow`, `style.sky.environment`, `style.sky.clouds` → `sky({ shadow, environment, clouds })`.
- `style.sky.fog` → `engine.scene.fog` or `look.fog.set`; `style.sky.dim` → `engine.sky.dim.tint` / `.stars`; other `style.sky.<key>` → `look.sky.set({ <key> })`.
- Types `Style`, `StyleInput`, `StyleWater`, `StyleTerrain`, `StyleWind` → gone. `StyleSky` → `SkyLookOptions`, `StyleShadow` → `SkyShadowOptions`, `StyleFog` → `SkyFogOptions`, `StyleEnvironment` → `SkyEnvironmentOptions`, `StyleSkyClouds` → `SkyCloudOptions`, `StyleSkyLayer` → `SkyLayerOptions`, `StyleSeasons` → `SeasonTints`.
- Error code `style-value` → gone.
