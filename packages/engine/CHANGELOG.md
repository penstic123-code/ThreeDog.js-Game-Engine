# Changelog (threedog)

The engine has not been released yet, so this log is not maintained before release. At release time it is written in one pass from git history and `docs/API.md`: "what changed, how a game upgrades", placed under the version heading.

## 0.6.0 (2026-11-04)

- Fixed: on WebGPU, cascades on a light whose `target` has a parent took the target's local position, so shadows fell another way than the light shone; they use its world position now, as WebGL does.
- Breaking: `grids.preview({ look })` is `{ draw }` and a layer's `tiles: { look }` is `tiles: { color }`; an unknown `tiles` key now throws.
- New: picture parts. `PICTURE_SLOTS` and the type `PictureSlot` name the picture values only one writer may hold (sky, fog, tone, environment, background, sun); `describe('picture').picture.slots` shows the holders; `engine.unuse(name)` removes a module. On the dev server a write to a value another part holds warns `picture-held`, and a removed picture part's leftovers warn `picture-leftover` (recipes/62-picture-code.md 3e).
- Fixed: the sky dome stayed in the scene after `engine.use(mySky(), { replaces: 'sky' })`.
- Breaking: `look` no longer names picture things. The game folder is `picture/` and `createPicture(engine)`, gameplay calls `picture.lamp(id)`; the module type is `'picture'`; the drawing parts are `terrainDraw`, `vegetationDraw`, `weatherDraw` with slots `terrain-draw`, `vegetation-draw`.
- Breaking: the look check is the picture check: `--no-picture`, `picture` and `pictureMs` in `shot --json`, the `Picture intent:` line in DESIGN.md, `lib add --kind picture`, `@threedog/tools/picture-check`. Seven recipes and the `plain-picture` example are renamed. Every old and new name is in MIGRATING-0.6.md.
- New (dev server only): `describe('picture').writers` and `engine.explain({ picture: 'fog.far' })` (`threedog explain picture fog.far`) name the file:line that last changed a light, fog, tone, environment, background or material value; a value not tracked says so. Two places writing one value in one frame with different results give one warning (`picture-conflict`) naming both. The look check adds measured facts: a `ShaderMaterial` that ignores fog or tone, a light layout changed during play, transparent meshes whose pixels depend on draw order. Recipe 62 "Wiring `picture/` parts".
- Breaking: `makeMaterial`, `engine.makeMaterial`, `look.materials`, `look.surface` and the glow verb are gone, and so are the material and patch plugin slots: materials are plain three.js. New: `applyEffects(mat, { lighting })`, `rampTexture`, the `uNight` signal.
- Breaking: `createEngine({ style })` is gone and throws with the fix: the look is plain three.js in the game's `picture/` code, UI colors go in `createEngine({ ui })`, season tints are `engine.sky.seasonTints`; `types/style.d.ts` and `core/styleParts.js` are deleted.
- Docs: recipes 09 (style folder) and 48 (makeMaterial) are merged into `recipes/09-materials-lights-models.md`: materials are plain three.js in `picture/`, module looks are `.material`, the UI look is `createEngine({ ui })`. Recipe 43 teaches shader code through `applyEffects` only; the `lighting` spec key becomes a plain `lighting` slot patch there.
- Breaking: the dev panel (`?panel=1`) reads and writes three.js objects directly; its style export, "apply and rebuild" and `?ov=` are gone, `engine.styleWorkbench` is `engine.devPanel`, and the `threedog tune` block holds plain three.js writes.
- Breaking: `threedog style check` is removed; `threedog style palette | compare` are now `threedog picture palette | compare` (bridge `picture-palette`, `picture-compare`; MCP `picture_palette`, `picture_compare`).
- Breaking: `style.character` is gone: `characters({ animation })`, and `engine.characters.material` is the plain three.js material of every placeholder capsule.
- Breaking: `style.triggers` is gone: `triggers({ debugColor, debugOpacity })`.
- Breaking: `style.palette` is gone: `engine.assets.palette`, a plain writable object that generators read as `this.palette`; a write rebuilds what is asked for after it.
- Breaking: cached and baked models read their materials back as recorded (plain three.js, `neutralMaterial`), no longer rebuilt from a material role. `assets.report()` says `madeByEngine`; `explain().materials` lost `keys`.
- Breaking: `style.grid` is gone: `grids({ ok, bad, previewOpacity, previewHeight, tiles, tileLift })`; the preview's and tiles' plain three.js materials are `pv.material` and `layer.material`.
- Breaking: `style.pickup` is gone: `pickups({ color, size, lift })`, and `engine.pickups.material` is the plain three.js material of boxes and geometry-only models.
- Breaking: `style.ui` is gone; the UI look sits in `createEngine({ ui: { theme, css, fonts, templates } })` beside the part names, and `engine.ui.templates` is writable.
- Breaking: `look.ground` and `style.terrain` are gone. The ground's look is `terrain({ colors, biomeColors, steep, variation, detail })`, `engine.terrain.material` (get / set), `.uniforms`, `.patches`, `.recolor()` (recipe 36).
- Breaking: `look.water` and `style.water` are gone. The water's look is `engine.water.material` (get / set), `.uniforms`, `.patches`, `.shader()`, `.normalMap()` (recipe 44).
- Breaking: `style.particles` is gone: `particles({ effects, default })`; an effect's `.material` is get / set and drawn as given, `.uniforms` its `{ value }` objects (recipe 64).
- Breaking: weather looks are `weather({ rain, snow, area, lightning, lightningBrightness, overcastColor })` options; `engine.weather.define(field, spec)` and `engine.weather.particles` (plain `.material`, `.uniforms`, `.spec`) replace `look.weather`.
- Breaking: plants take plain materials. `engine.vegetation.material`, `.patches`, `.sway()` and `.color()` replace `look.wind` and `look.vegetation`; wind strength and speed are `engine.uniforms.uWindAmp` / `uWindFreq`.
- `threedog art board`: every art resource of a game on one page, with where it is used, what is unused, missing or not traced, and copy lines for the AI; `--json` is the same data, `--live` and the dev panel's "art" folder show what the running game really loaded.
- `?at=<place>` (`threedog shot --at <place>`, `applyState({ at })`): skips the start screen and stands the player at a named place with the game's camera on it at once. `?pos` no longer opens on a camera glide either (new event `state:placed`).
- `interactions.add(mesh, { label, onUse, once, counter })`: `once` hides the mesh after a use, `counter` adds to a HUD counter (new `hud.add(name, n)`), both saved in the new `interactions` save part; pick-and-count things no longer need pickups and an inventory. Recipe 03 says which to use when.
- `createEngine({ ui: { theme } })` is the one place to reskin: every default part (dialogue, prompt, HUD, toast, menus, title) reads its variables, and recipe 26 "Reskin" lists them on one screen. The HUD now follows `bg` / `fg` / `accent` unless `hudBg` / `hudFg` / `hudAccent` are set; new `radiusSmall` and `shadowSmall` replace the corners and shadows that were fixed in the CSS (the default toast is no longer a pill).
- Breaking: the sky writes no light, fog, exposure or environment; it computes the signals and draws the dome. Your `picture/` code reads `engine.uniforms` and writes three.js (recipe 62).
- Breaking: `sky({ sun | hemisphere | fog })` throw naming what to write; delete the option. `createEngine({ lights: false })` drops the placeholder lights, which are now still.
- Breaking: no fog by default. `style.sky.fog` and `look.fog.set` write `scene.fog` once; a fog that changes over the day is yours.
- Breaking: no default tone curve (`renderer.toneMapping` stays three.js's default unless `style.toneMapping` names one), and no room environment map unless `look.lights` `env.intensity` is above 0. `env.share` is gone.
- Breaking: `style.exposure` and `look.tone` exposure are numbers, and `look.lights` keys take no function: exposure and light over the day are your `picture/` code.
- Breaking: weather no longer multiplies `look.lights.*` or `look.fog.far`; it writes the signals `uWeatherLight` and `uWeatherFog`. `uViewDistance` is new (stream radius without terrain, a fog's far; `terrain({ viewFog: true })` writes it).
- Breaking: plain game materials get the cloud-shadow patch only once the game turns cloud shadow on, in one recompile at that moment.
- Breaking: `style.sky.groundTint` and `part.author.drive / driven / feed` are gone (nothing left reads them).
- `describe().render.defaults` lists what the engine itself still puts on the picture, each with how to stop it.
- The `look.*` verbs are deprecated: no new features, recipe 52 says what to write instead. Removal is a later step.
- `threedog new-game`: `main.js` wires a start screen, autosave and Esc pause + settings menu (delete a line to drop one), the template's CLAUDE.md opens with an "Already here" table, recipe 63 is a 16-line third-person start. R40 hints at a hand-written localStorage save or pause; `shot` says when the start screen covers the picture.
- Esc under pointer lock opens the menu on the first press: the browser keeps that key, so a lock the player ended counts as the back key when nothing else is open and the game is running. `page:pointerlock` also says `byEngine`.
- `threedog lib add --kind look` stores one file from `picture/` (or a `.glsl`) in the library and `lib pull` puts it back under `picture/` (`picture/shaders/` for `.glsl`); a look file that imports siblings is refused at add. `art copy` of a folder takes `.glsl` files along. Recipe 62 section 3c.
- `engine.shadows.cascades(light, { count: 3 })`: cascaded shadows for a game's own DirectionalLight, with or without a sky, on both renderers; returns a handle (`set`, `remove`). `look.shadow.set({ cascades })` runs on the same code; the look check's usage line for a game's own light points here; recipe 45.
- The look check points the way: over-budget facts (new budget entries `shadowMaps`, `shadowMapSize`), usage lines for cascaded shadows and `lightPool`, new facts for near-black shadows, shadow stripes and stepped edges, and fog named first when it is most of the picture. They read the game's own lights too. Recipe 60 "When the look check names a feature".
- `threedog new-game` generates a `picture/` folder instead of `style/`: the gray starting picture as plain three.js the game owns (`index`, `palette`, `lights`,
  `materials`), with `createEngine({ lights: false })`; recipe 62. Styles keep working. Water with no fog reflects the sky's horizon color, not a fixed gray.
- Prop and template `collide: 'circle'` now stands on the model's base (the lowest fifth of its height above the ground), not on its widest extent: a lamp's arm or a tree's crown no longer blocks walkers or pulls the follow camera in. Characters can walk closer to such models; a box is unchanged. New form: `collide: { circle: 0.25, occluder: false }`. A mistyped `collide` is refused at load.
- `lightPool`: a camera cut (`engine.views.show`, a fixed-camera shot) moves the lights at once, without the fade; `shot --view` drew the old spot's lamps. `views.show` emits `camera:shot`.
- `threedog shot <url>`: a local dev server of another game's folder is refused; one that cannot say is reported. The scene is counted again after the picture, with a warning if it changed.
- Black-frame hint lists shader programs that failed to compile. Test runner: a second argument to `ev` fails.
- `threedog shot` and `threedog capture` wait for the game's code after `await engine.start()` (lamps added after a later await): no request in
  flight and the scene's objects / lights / materials unchanged for 0.3 s, at most 10 s; shot says how long it waited and what was added.
- `presets.camera.overShoulder` looks up (minPitch -1.05) like `thirdPersonAction`; every camera preset that locks the mouse can look up (tested).
- The look check names the material whose hiding brings a black frame back (a ShaderMaterial with NaN / Inf, spread by bloom), and reports fog
  that is most of the color in a large share of the picture, with its near / far and color.
- Deploying under a sub-path: `threedog build my-game --base /my-game/` (Git Bash's rewrite of `/my-game/` is undone), and root-relative
  manifest paths (`'/models/x.glb'`) now follow the build's base; recipes/61-deploy.md. The pack test builds and serves under a sub-path.
- `threedog describe` and the other bridge commands: when a threedog dev server of another folder answers, the message says so instead of
  "no dev server".
- Dev error log: a repeated warning (warned again after each reload) is counted, not written again.
- Recipe 32: bullet time needs `engine.time.channel('enemies')` first, and world records follow it through `world.simulate(kind, { channel })`.

## 0.5.0 (2026-11-04)

- Install instructions agree everywhere (README, package READMEs, COMMANDS.md): until 0.4.0 is on npm, use the engine from the repository;
  after that, `npm install threedog@0.4 three@~0.187.0` and `@threedog/tools@0.4`. Each says which version it describes.
- Node: every package.json (and a new game's) declares `^20.19.0 || >=22.12.0`, the range vite 8 needs. `threedog dev / build / preview /
  test / shot / perf / stress / capture / gallery / bake` stop first on an older Node, printing the version found, the range and how to fix it;
  `threedog doctor` reports the same check.
- New-game CLAUDE.md: a clear request is built directly (no confirmation round); the AI asks only about choices that change the result and
  cannot be inferred, writes its other picks as "(picked, not asked)" and lists them in its report; a change updates only the records it makes wrong.

- After-await fixes (outside review of 0.4.0). A module unloaded while its async init awaited (replaces, a plugin removed) can no longer act on a
  same-named module installed after it: each install has its own identity; what the old init tracks or `ctx.mod`s afterwards is removed at once, its queued `ctx.whileCompiling` warm-ups do not run
  (dev warning `[module-handle]`), and its completion or failure leaves the newcomer's state and handles alone.
- `saves.apply`: a listener that throws after an `await` inside an async `load()` now fails and rolls back the load like one that throws before
  it (the capture lasts until the load settles, one scope per load). The rollback point is a copy of every part's `save()`, so
  `save: () => state, load: d => Object.assign(state, d)` rolls back correctly; `save()` data that cannot be copied refuses the load
  (`[save-part-threw]`, MIGRATING-0.5).
- Plugins composed: a post effect keeps its place across `plugins.off` / `on` (equal `order`s keep the order the names were first added in,
  plugin effects are placed in plugin-list order), so A, B no longer come back B, A. `look.post.set({ A: false })` pauses in place,
  `plugins.off` unloads. Each style-pack plugin is its own owner (`style:<pack>/<file>`): switching B off no longer drops A's material. Two
  plugins writing the same key on one layer are a dev `[shared-conflict]` naming both, unless one file says `export const replaces = '<file>'`.
  `plugins.off` / `on` return `{ off | on, reach, rebuilt, note }`; `plugins.list()` and `describe().slots` give each plugin's reach (`live` or
  `new materials only`); `off('<pack>')` says the pack's starting values stay. New `engine.look.materials.rebuild()`: materials already made
  are made again from the current layers (patches, replace, type) and swapped in place, keeping call params, hand-set colors and wind / cloud
  shadow; `plugins.off` / `on` of a material or patch plugin calls it (`{ rebuild: false }` skips it) (MIGRATING-0.5).

- Turning shadows off (look.shadow, the settings menu) is the renderer switch only: `renderer.shadowMap.enabled`. No light's `castShadow` is
  written any more, so a game that changes `castShadow` while shadows are off keeps its value when they come back. `describe().owned['shadows.off']`
  is gone; budget `shadowLights` is 0 while shadows are off (MIGRATING-0.5).
- `threedog lib pull` of a code entry writes a working plugin: the code in `plugins/<name>/`, plus the wiring file `plugins/<name>.js` that calls
  its factory, from the entry's new `plug` line (`lib add --plug "makeIt({ ... })"`, else the exported function; `pull --plug` overrides).
- `[plugin-shape]` errors name the file, what it exports and the exact fix: a factory function, a module with no `type` or no hook, an effect
  with no name.
- One entry per look value: `water()`, `sky()` and `terrain()` options that were look values are gone; each is a `look.water` / `look.sky` /
  `look.ground` param (style layer: `style.water`, `style.sky`, `style.terrain.config`). New params: `look.water` `normalMap normalScale
  normalRepeat normalSpeed shininess specular`; `look.sky` `keyframes sunSize sunGlow sunBrightness moonSize moonColor moonBrightness
  starDensity starScale gradientCurve groundTint orbitTilt orbitSway dim.tint dim.stars`; `look.ground` `normals`. `sky({ skybox })` →
  `look.sky.replace`. The old options throw in dev naming the call (MIGRATING-0.5).
- `water({ material })` is gone: the water surface material has one entry, `engine.look.water.replace(fn)` (style layer: `style.water.material`).
  It throws in dev naming the call. `water({ uniforms })` stays: it declares the uniforms the `look.water.patch` hooks read (MIGRATING-0.5).
- Type declarations: `look.clouds`, the leaked three.js `Light` export, the `.engine` back-references (terrain, characters, cameraRig, control,
  views) and three test-only readouts (`audio.info`, `ambience.info`, `level.buildMs`) are gone from the types; runtime unchanged (MIGRATING-0.5).
- Shared values check number values the same way on `engine.mod` and on `handle.change()`: set / add / mul are finite numbers; clamp is
  `{ min?, max? }` with each given bound a finite number and min <= max; `stacks.define({ min, max })` the same. A wrong one throws `[shared-value]`
  naming what was given and the fix, instead of making the value NaN (`clamp: { max: 'oops' }`, `{ max: NaN }`) or holding a reversed range.
- Colliders take `occluder: false` (`collision.addCircle` / `addBox` / `addSegment` / `addObject`): walkers are still stopped, the follow
  camera's occlusion check ignores it. A forest of trunk colliders no longer collapses the camera onto the player.
- `shot --play` starts straight in play: the engine's new `?play` URL key (`applyState({ play })`) does what the title's Start does
  (`engine.session.newGame()`, the title part closes; flow leaves its start state). Games no longer need a `?play` key of their own.
- Page arguments rewritten by Git Bash are also undone from its `EXEPATH` root, and `shot` prints the page it really opens when the argument
  was rewritten (`npm run shot -- /` echoes `> threedog shot C:/Git/`, which read like the wrong page).
- `threedog how "game test"` finds how to write a game's own test (a CONVENTIONS.md entry row pointing at COMMANDS.md "A game's tests").
- The api page of `collision.addBlocked` gives the `bounds` shape `{ minX, maxX, minZ, maxZ }`.
- The repository `.gitignore` no longer ignores every `shots/` folder: tool output stays under `.threedog/`, a game's own screenshots can be committed.
- Follow camera `ground: 'shorten'` samples the arm at most 0.2 m apart (capped at 160 samples, so 0.2 m up to a 32 m arm) instead of 12 fixed
  samples: a narrow rise in the ground height (a 0.25 m bump in the middle of an 8 m arm) now shortens the arm instead of being stepped over.

## 0.4.0 (2026-11-04)

- Sky colors for a game shader: `engine.uniforms.uSkyHorizon` / `uSkyTop` hold the colors the sky draws this frame (tint and lightning included);
  the default fog color is the same horizon. `weather.set(name, { seconds: 0 })` switches at once (before any step); negative seconds throw.
  The type check names the expression a call was made on (`` `engine.random` is not a function ... (it is Random; call one of its methods) ``).
- One small look API: every `engine.look.<part>` has `set` / `patch(hook)` / `add` / `replace(thing)` / `manual` / `value`, and `patch` only
  swaps a named hook. `look.materials.patch` is now `look.materials.add`; `look.fog.replace` is removed (a fog of your own is `scene.fog = ...`,
  the engine yields); the module plumbing (`write`, `extend`, `drive`, `tick` ...) moved to `part.author`. Removed verbs throw naming the new call
  (MIGRATING-0.4).
- Post effects have one entry, `engine.look.post.add(x, { name, slot, order, owner })`: a plain three.js Pass, a WebGPU node function or an effect
  `{ name, create, node, fuse }`; the plugins folder and a style's plugins go through it, so every effect switches with `look.post.set`. Removed:
  `engine.post.addPass / insertPass / removePass`, `look.post.patch`, `style.post`, `postAdd / postRemove`, `createEngine({ post })` (each throws or
  is gone, see MIGRATING-0.4). A function exported by a plugin file is a `[plugin-shape]` error on both renderers (it was a WebGPU post pass).
  A Pass that renders the scene itself replaces the scene render (it drew the scene twice). WebGPU: removing an effect frees its nodes (leak fixed).
- Material roles have one entry, `engine.look.materials`: the style's `materials` table is its style layer and `makeMaterial` reads nothing else
  (look.materials.set also reaches Material-instance roles). Style packs bundle look plugins (`style.plugins`, plugged by `engine.plugins` on the
  style layer, `plugins.off('<style>')`). The world example's `lowpoly` style is replaced by a small `world` style; its models moved to `examples/world/art/`.

### Breaking (module types, leftovers)

- A module's `type` decides how its errors are handled: a `look` or `ui` module that throws is switched off and the game keeps running; the
  `presentation: true` flag is gone. `stage` only orders hooks; the stages `world` / `presentation` are renamed `ground` / `effects`.
- `engine.time.manual` is gone (`engine.mod('time.<channel>', { owner, set })`).
- The terrain data part reads no style: chunk colors and the `viewFog` fog distance belong to the terrain look (owner `terrainLook`, removed with it).
- The 0.2 rename traps (`[renamed-field]` on `clock.timeScale`, sky calendar fields, `.reason`, `runState.by`, `describe().ui.inputContexts`,
  dialogue `{ lock }`, `style.pickup.model`, item `mesh`) are removed; `[item-mesh]` is gone.
- New-game template: the style lists `plugins` (with a `style/plugins/` folder) instead of `post: []`; the blank game no longer depends on
  `@threedog/post-effects`. `threedog how` labels THREE.md rows that name engine APIs `engine + three.js`, not `plain three.js`.

### Breaking (time, input, character control)

- One time source: `engine.time` counts fixed steps (`engine.tick`); `real`, `ambient`, the calendar and channels are views (`engine.time.now(name)`). `engine.elapsed` and `engine.time.real` are gone (`engine.time.now('real')`); `describe().time` has `tick / real / ambient / calendar`; the `clock` save part is folded into `time` (old saves load).
- Input by context: modules declare actions (`input.action`, `ctx.input.action`), the game binds keys (`input.bind`, `createEngine({ bindings })`), the player rebinds on the settings layer (`input.rebind`, `input.rebound()`). `input.define` and `createEngine({ padBindings })` are gone; the base context is `walk` (was `gameplay`). F3, F4, dialogue 1-9, RTS Q / R and the cutscene skip keys are no longer bound by default (`presets.bindings.debug / dialogNumbers / rtsRotate / cutsceneSkip`).
- Character control: one control slot per character (`engine.control.take(ch, { owner, layer, step })`, layers base < script < cutscene < net). Gone: control `'none'`, writable `player.control`, `presets.player.none`, timeline `lockInput` (`actors`).

### Added (plugins folder)

- `plugins/` next to a page's html: each file is plugged at `engine.start()` by what it exports (Object3D, Pass / node pass, Material, ShaderPatch, module); order by file name or `plugins/plugins.json`; `engine.plugins.off(name)` / `on(name)`; a wrong shape is `[plugin-shape]`.
- `describe().slots`: what is plugged where, from which file, what it affects.
- Plain `PointLight` / `SpotLight`: counted by `engine.budget` `lights` (limit 8) / `shadowLights`, listed in `describe().render.lights`; a casting light at intensity 0 stops redrawing its shadow map.
- `threedog lib pull` puts code entries (shader, material, effect, module) in `plugins/` by default (models and textures still in `art/`).

### Breaking (physics, nav, weather, collision)

- `weather.set(name, seconds)` is `weather.set(name, { seconds })`; a number throws `[module-params]` in dev.
- `engine.collision.circles` / `.boxes` are Sets (insertion order, O(1) remove): `.length` is `.size`, `.filter` / `.map` need `[...set]`.
- `engine.interactions.items` is a read-only array built on each read (insertion order); writing to it does nothing. `get(id)` is the fast lookup.
- New `engine.collision.mirror({ add, remove })`: one add / remove diff of the static colliders, used by rigid and nav (their own copies are gone).
- New `engine.assets.useTexture(name, use, { where, instead, opts })`: fetch a texture for a stand-in; a failed load is one `[load-failed]` warning
  naming the slot. detail, surface, particles, weather particles and water use it (sky still has its own).
- rigid rebuilds its physics world once per new game / load (it rebuilt on `session:end` and again on `world:load`); a refused load leaves physics as it was.
- New options with the old values as defaults: `weather({ lightningFirst: 5, lightningInterval: [6, 20] })`, `nav({ maxObstacles: 1024, maxAgents: 128, arrive: 0.6 })`.
- `nav()` declares `optional: { collision }`.

### Breaking (per-frame waste, save loads, look write paths)

- The weather look's entries on the look points are owned by the module `weatherLook` (was owner `'weather'`): `holders().find(h => h.owner === 'weatherLook')`. It takes each entry once through `ctx.mod` and rewrites it with the new `handle.change(value)`, so a frame adds no entry and no cleanup handle.
- While a save part's `load()` is still pending (it returned a Promise), gameplay is frozen: no fixed step runs and `ops.run` / `ops.can` fail with code `loading` until every part is applied.
- `ops.list({ available: true })` (and so `describe().actions`) no longer throws for an op whose `offers` throws or offers an arg set that fails its args check: such an op shows as an entry with code `offersFailed` / `badOffer` and `facts.error`.
- Post effects have a fifth slot, `tone` (exclusive, between `hdr` and `ldr`): an effect there replaces the engine's tone-mapping output (OutputPass on WebGL, renderOutput on WebGPU) and must output display color; `describe().render.toneMapping` then names it.

### Added (per-frame waste, save loads, look write paths)

- `handle.change(value)` on every `engine.mod` / `ctx.mod` handle: rewrites that entry's value in place (same op and layer); false on a stale handle.
- `describe().look.<part>.<key>.pack`: the style part that set a style-layer value when `createEngine({ style: [...] })` merged several (its `name`, else `style[<index>]`).
- Rule R48: engine code writes `toneMappingExposure`, `shadowMap.enabled / type` and `environmentIntensity` only inside the owning look part's apply (allowlist with reasons in the rule file).
- Rule R49: every shader patch and post fuse the engine and its add-ons ship has a `tsl` form next to `glsl`, so it draws on WebGPURenderer (WebGL-only-by-design patches listed with reasons in the rule file).
- Camera rigs are no longer wrapped method by method (a pose compare on every call, `forward()` read every fixed step included): the built-in rigs mark their own placement once (fixed `cut`, rts `moveTo({ instant })`).
- Staged content templates no longer serialize each copy's model every frame; an open menu with an idle cursor reads no layout per frame (the control list is cached and re-read on a move, a confirm or a DOM change).

### Breaking (plain three.js is adopted)

- `engine.scene.add(obj)` registers the root like `engine.add` (thing registry, describe, thing.set); engine modules mark their own objects with `engineOwned`.
- `engine.post.addPass(pass)` / `insertPass(pass, i)` / `removePass(pass)`: a plain three.js Pass (WebGL) or `(input, ctx) => node` (WebGPU) joins the chain; RenderPass / OutputPass of the engine's own are skipped.
- A game rendering the canvas itself takes the frame: the engine stops drawing its own and warns once `[own-frame]`; removing the call hands it back.
- Plain lit three.js materials (Lambert / Phong / Standard / Physical / Toon) that enter the scene take the engine's cloud shadow (and a `look.cloudShadow.replace`), on both renderers, sharing one program per type. Opt out per material with `material.userData.cloudShadow = false`; materials already given engine patches are left alone; listed in `describe().owned['cloudShadow.plain']`. Snow / season cover stays opt-in: `applyEffects(mat, { season: 'ground' })`.
- Vegetation on its own ground (no terrain): adding a species places only that species on the loaded chunks (it dropped and rebuilt every chunk). Terrain and own-ground chunks stream through one helper (`core/chunkStream.js`).

### Breaking (consistency sweep)

- `music.stop(fade)` is `music.stop({ fade })` (like `play`); a number throws `[module-params]` in dev.
- `setValidate` is gone; `createEngine({ validate })` is per engine (`engine.validate`). Page-wide warnings stay on while any live engine has checks on (it was: the last `createEngine` decided for the page).
- The event-name spelling check (`[event-typo]`) now also runs in the `npm test` bundle (it read raw `import.meta.env.DEV` and was off there).
- Dev notes print through `note(text, key?)` (core/validate.js); R45 flags a bare `console.info` in engine code.
- No three.js prototype is changed for rays: `Mesh.prototype.raycast` and `BufferGeometry.prototype.computeBoundsTree / disposeBoundsTree` are three's again. Registered static meshes still get a BVH (own `mesh.raycast`). A game that relied on BVH for its own `THREE.Raycaster` adds three-mesh-bvh's setup itself.
- New `threePatches` export and `describe().threePatches`: the remaining class changes (`shadow-accessors`, `node-setup-position`), each undone page-wide with `threePatches.off(id)`.
- AI.md: the "When something happens -> which tool" list moved to recipe 16 §11 (the MCP server reads it there).
- No module option takes keys any more; modules only declare their actions and the game binds them (`createEngine({ bindings })` / `engine.input.bind`). Gone: `inventory({ keys, pad })`, `quests({ keys, pad })`, `photo({ keys, pad })`, `interactions({ keys })`, `grids.preview({ rotateKeys })`, `characters({ brakeKeys, brakePad })`, `createPlayer({ jumpKeys, runKeys })` (each now `[module-params]`). `presets.keys` is gone; its maps are `presets.bindings.inventory / quests / photo / gridRotate / brake`, plus new `presets.bindings.walk` (run / jump, what `presets.player.*` used to carry) and `presets.bindings.interact` (E / gamepad X, what `presets.interactions.*` used to carry). `presets.player.*` and `presets.interactions.*` hold no keys now. Migrate: `createEngine({ bindings: { ...presets.bindings.walk, ...presets.bindings.interact, ...presets.bindings.inventory } })`; "no key" is a binding to `[]`.
- `createEngine` options are typed in their schema (`engine.catalog('core').params` shows `bool`, `number`, `object|array` ... instead of `any`): a wrong shape such as `batching: 'yes'` or `fov: 'wide'` now throws `[module-params]` at the call (it used to pass and fail later or be ignored). An unknown `fallback` is `[module-params]` too (was `[engine-misuse]`). Param schemas accept several shapes as `'bool|object'`.
- R6 (options tables) is an error now: a module's schema and its d.ts options interface must name the same keys; a schema default written again as a destructuring default in the same function fails; a modules/ options table with `keys` / `pad` / `xKeys` fails.
- `inventory({ pauseGame })` of the wrong type is `[module-params]` (was `[inventory-misuse]`; the schema already checked it).
- Timing arguments are options objects (a number in their place throws `[module-params]` in dev): sound handle `h.fade(to, s)` / `h.stop(s)` are `h.fade({ to, seconds })` / `h.stop({ fade })`; `timeline.tween(t, to, duration, ease)` is `tween(t, to, { duration, ease })`; `fadeScreen(engine, to, seconds)` is `fadeScreen(engine, to, { seconds })`; `anim.go(state, fade)` / `anim.action(name, fade)` take `{ fade }`; fixed camera `blend(name, seconds, ease)` is `blend(name, { seconds, ease })`.
- Handles end with `remove()`: a tween promise's `cancel()` and a `dialogue.say()` promise's `stop()` are `remove()`; a sound handle gains `remove()` (same as `stop()`); a look part's `dispose()` is `remove()` (it owns no GPU resource). R7 now fails (was a warning) on any returned object with `stop()` / `cancel()` and no `remove()`, with no allowlist.
- `flow.transition` called `music.stop(fade)` positionally (it threw in dev since `music.stop({ fade })`); fixed.
- An unbound module action no longer throws at `engine.use` (`interactions()` without keys, `inventory()` without keys); reading it warns `[input-unbound]` once in dev, so binding after `use` works.
- Actions a module declares outside its ctx leave with it: the rts camera's `rotateLeft / rotateRight` (declared by the camera module), the player's `jump / run / brake` (declared at `characters()` install, optional), a grid preview's `rotate` (removed with the preview).

### Breaking (module types and capabilities)

- Every module declares `type`: `'world' | 'look' | 'actor' | 'rules' | 'ui' | 'net' | 'tool'` (what it may own; `stage` still says when it runs). A module without one throws `[module-type]` with the fix: add `type: 'rules'` for game logic.
- Dev checks by type throw `[module-type-rule]` with the fix: a `look` module may not `ops.define` or write world records; a `ui` module may not `input.bind` or `saves.register`. A `world` module's file may not draw (rule R47).
- `requires` names a capability (`'world'`, `'inventory'`, `'sky'`), provided by a module's `provides`; a missing one names both fixes (install the engine part, or your own provider). Built-ins provide theirs (world, level, collision, rigid, nav, calendar, weather, sky, particles, inventory, quests, dialogue, interactions). After `{ replaces }`, `engine.<capability>` is the new provider's API.
- `describe().modules` is a list of `{ name, type, provides?, requires? }` (was a list of names).
- `weather()` returns two modules, installed by the same `engine.use(weather(...))`: `weather` (state, `engine.weather`: types, current, set, auto, save, events) and `weatherLook` (look, `engine.weatherLook`: particles `systems`, `flash`, `apply`, `particles`, `area`; `describe().weatherLook.rainVisible / snowVisible`). `engine.weather.systems / flash / apply / particles / area` and `describe().weather.rainVisible / snowVisible` are gone.
- Calendar: `timeOfDay`, `day` and `dayLength` are views of the `'calendar'` time channel (an origin plus `engine.clock.now`), not a counter of their own; writing them moves the origin. `day:start` / `season:change` / clock-time timers fire right after time moves (new `engine.time.onMove(fn)`), on a step and on a skip. `calendar.tick()` is gone; the save part also stores `at` (older saves still load).


### Breaking (module boundaries)

- Core, render and ui name no module; modules register what core needs. A module's loading-screen name `module.<name>` is registered by the module with its own text (`engine.i18n.add` in install); `describe().player` drops `running` / `jumping` (compare `state` yourself); the light-count warning skips lights marked `userData.fixedCount` (light pools set it) instead of names starting `lightPool_`; night glow reads the `daylight` measure (`engine.audio.measure`: calendar, or the sky without one); the baseline sun follow steps aside for whoever holds `shadow.follow`; the title's Settings button comes from `engine.ui.titleItem('settings', ...)` (an unknown string in title `items` throws, listing the added ids); the water surface numbers moved to `render/fxNumbers.js`.
- New: `saves.register(key, { checkNewGame(data) })` (dev check of a part's new-game data; the world's "records placed by code" warning moved there), `engine.ops.route(fn)` / `engine.ops.refused(name, args, { reason, actor })`, `engine.world.pauseSimulation()`, `engine.inventory.contents()` / `setContents(data, { only })`. net uses only these; a game's own inventory provider needs `contents` / `setContents` for net to sync it.
- Checks: R25 follows a module held in a local (`const inv = e.inventory; inv._x`); R46 (another module's internal files) is an error; R27 also flags module names kept in `core/I18n.js`; R3 looks for `module.<name>` in the module's own folder.

### Breaking (look values on shared points)

- Every `engine.look.<part>.<key>` is a shared point (`describe().shared['look.fog.far']`): the game's value is the base, effects multiply on top, the settings menu can only restrict. A game's `look.lights.set({ sun: { intensity: 3 } })` now dims in rain and fades at sunset (it used to cover both); for the exact number use `look.lights.manual('sun')` or `{ layer: 'system' }`.
- Two owners `set` one look value on one layer throw `[shared-conflict]` in dev (was: the later write won). Fix: one owner, `mul` / `add`, or another `layer`.
- `engine.mod('sky.sunLight' | 'sky.ambient' | 'sky.fog' | 'sky.tint' | 'sky.flash' | 'sky.cover')` are now `look.lights.sun.intensity`, `look.lights.hemi.intensity`, `look.fog.far`, `look.sky.tint`, `look.sky.flash`, `look.ground.cover`; `engine.sky.modifiers` is gone (read `engine.stacks.get(name).value()` or `describe().shared`).
- Shadows: `createEngine({ shadows, shadowType })`, `engine.setShadows`, `engine.shadows`, `engine.shadowType` and `look.lights` `sun.shadow` are gone; use `engine.look.shadow.set({ enabled, type })` (core, works without a sky; a sky adds cascades, extent ...).
- Fog: `createEngine({ fogFar })`, `engine.setFogFar` and `engine.fogFar` are gone; the start value is `style.sky.fog.far` / `sky({ fog: { far } })`, a game sets `look.fog.set({ far })`, `terrain({ viewFog: true })` makes the terrain look write the layer below it (owner `terrainLook`, removed with that module).
- Fog: an explicit `near` or `density` is kept as given; the weather multiplies `far` only (it used to scale density too).
- Settings menu: shadows / bloom / ao off is a `set: false` on the settings layer; on removes it, so a scene that turned them off stays off and a low-tier device's bloom stays off.
- `look.<part>.set(...)`'s handle `remove()` returns whether it removed anything.

### Breaking (terrain and vegetation: data and look)

- `terrain()` and `vegetation()` each install two modules: data (`engine.terrain`, `engine.vegetation`) and look (`engine.terrainLook`, slot
  `'terrain-look'`; `engine.vegetationLook`, slot `'vegetation-look'`). A game draws either its own way with
  `engine.use(mine, { replaces: 'terrain-look' })` + `engine.terrain.view({ add, change, remove, show })` (or `'vegetation-look'` +
  `engine.vegetation.view({ species, change, ring, show, drop })`) and keeps collision, paths, felling and saves (recipe 28 sections 6 and 7).
  Code that lists module names (`openWorld().map(m => m.name)`) now sees `terrainLook` and `vegetationLook` too.
- Chunk records hold data only. Removed: `c.terrain` / `c.group` (terrain meshes: `engine.terrainLook.meshes.get(c)`), `c.veg` / `c.vegGroup`
  (plant meshes: `engine.vegetationLook.mesh(c, name)`; placement data: `c.plants[name]`, felled slots `c.hidden[name]`),
  `im.userData.hidden` / `im.userData.ids` (use `c.hidden[name]` and `c.plants[name].ids`).
- `vegetation.define()` returns the species' data; `geometry`, `lodGeometry`, `material` and `fadeUniforms` moved to
  `engine.vegetationLook.kind(name)`. `Vegetation.levelOf` / `updateFade` and the terrain look internals `mountTerrain.js`, `chunkLevels.js`,
  `terrainMat` / `sideMat` are gone.
- A chunk job that keeps failing is tried 3 times, then reported (`terrain:chunkFailed`, `[terrain-chunk-failed]`,
  `describe().perf.chunks.failed`); `engine.terrain.retry()` sends it again (it used to sit in loading for ever).
- `terrain.setDensity` places only the plants again (ground collision is kept); `look.ground.replace` swaps the material in place.

## 0.3.0 (2026-11-03)

WebGL renderer. Upgrade steps for a 0.2 game, most common first, with the error each old form now gives: [docs/MIGRATING-0.3.md](docs/MIGRATING-0.3.md).

### Breaking

- Options: more option bags go through one schema (`readParams`): an unknown or removed option throws `[module-params]` in dev (release: warns once, ignored). This covers `createEngine`, `openWorld`, module factories, `npcs.add`, `createPlayer`, `triggers.add`, `addWheeled`, `audio.addBus`.
- Calendar: time of day, days, seasons, clock-time timers and their save moved from `sky()` to the new `calendar()` module (`engine.calendar`). `sky({ dayLength | day | seasons | daysPerSeason | hoursPerDay })` throws `[sky-option]`; `engine.sky.timeOfDay / day / season / ...` throw `[renamed-field]` in dev; `engine.sky.at / between / daily / onSeason` are gone. `openWorld` installs `calendar` (object form `calendar: {}`, was `sky: {}`).
- Pickups: new `pickups()` module. `inventory.spawnPickup / nearestPickup` and `inventory({ pickupRadius, bobDistance })` are gone (`pickups.spawn(position, { give })`, `pickups({ radius, showDistance })`). Event `item:pickup` → `pickup:take`; `container:add / remove` removed (`item:add / remove` carry `container`, `actor`). Pickup handle `id` is the world record id. `style.pickup.model` is not read (the shape is an asset model by name). Content pickups need `pickups()` `[module-needs]`.
- NPCs: `talk / talkLabel / talkRadius` → `interact: { op: 'npc.talk', label, radius, args }`.
- Clock and holds: `engine.clock.timeScale` removed (`engine.mod('clock.rate', { owner, set })`; `clock.rate` is read-only). `engine.resume / unfreeze` removed: `pause` / `freeze` return `{ owner, remove() }` (no chaining). `defineState` returns a handle. `runState.by` → `runState.owners`.
- Sky and lights: `engine.sky.sun / hemi` → `engine.lights.sun / hemi`; `sky.modify` removed (`engine.look.*`, `engine.mod`); `sky({ sun | hemisphere | fog: 'manual' })` throws `[sky-option]` (`look.lights.manual`, `look.fog.manual`). `look.tone` has no `mapping` (the engine writes `renderer.toneMapping` once at creation; change it in three.js). `setFogFar` no longer writes `scene.fog`.
- Style shader keys moved to look hooks: `style.sky.fog.glsl`, `style.sky.clouds.glsl / uniforms`, `style.wind.glsl / uniforms`, `style.water.glsl`, `water({ glsl })` throw and name `look.<part>.patch(slot, ...)`. Style functions (`backdrop`, fog `color`, tone `exposure`) receive `{ time, weather, season, state, sky }` instead of the sky.
- Audio: `audio.register(name, synth)` removed; a synth is an asset (`assets.manifest({ sounds: { name: fn } })`). `audio.sounds` rules `'synth'` / `{ synth }` throw `[audio-synth-gone]`. `audio.addBus(name, { level, owner })` returns a handle.
- Assets: model `params` in a manifest is a schema (`{ h: { type: 'number', default: 3 } }`), not values. `assets.cached` is no longer public.
- Characters: `canSwim` → `water: 'swim' | 'block' | 'wade' | fn`; the speed argument of `move()` and `moveInput.speed` are ignored (`engine.mod('move.speed', ...)`).
- Vehicles: `rigid.addVehicle` → `rigid.addWheeled`; `seat` → `seats: []`; `seatPosition / exitPosition` take a seat index; `vehicle:enter / exit` carry a `Rideable`.
- Removed: `entities` module, `engine.entities`, events `entity:spawn / remove / state / stage` (content templates with `stages`, event `template:stage`); `engine.spawn` (`engine.content.spawn`); `vegetation.add` (`vegetation.define`); `triggers({ debug })` / `setDebug` (`engine.debug.view('triggers')`); dialogue `lock` option (`channel: 'bubble'`).
- Changed shapes: `quests.state` is a method `state(id)`; `trade()` and grid `check / preview / place` results use `code` (was `reason`) plus `facts`, `nextActions`; `describe().ui.inputContexts` → `describe().holds.input`.
- The 0.2 rename stubs (`[renamed-api]` for `setExposure`, `setToneMapping`, `sky.setEnvironment / setShadow`, `weather.define`, `post.add / enable`, `look.clouds`, `cameraOverride`, views `pos`, `style.character`) are removed; those names are now plain `TypeError` / `undefined` (renamed result fields are the exception below: a dev-only error pointing at the new name, no compatibility).
- 0.2 names that used to do the wrong thing silently now throw `[renamed-field]` in dev naming the new form, all through one rename table helper (`renamed` in `core/validate.js`; release builds skip it): `dialogue.say / start({ lock })` → `channel: 'bubble'`; `engine.clock.timeScale` → `engine.mod('clock.rate')`; the names that moved from `engine.sky` to `engine.calendar` (an explicit list); `style.pickup.model`; result `.reason`, `runState.by`, `describe().ui.inputContexts`. Writing `clock.rate` throws `[mod-owner]` (it is read-only).

### Added

- `calendar()` (`at / between / daily / onSeason / untilMark`, `isDay`, `daylight`) and `pickups()` modules, both in the `index.js` exports.
- `engine.mod` / `engine.stacks`: owned, timed, saved modifiers for any quantity (`move.speed`, `clock.rate`, sky multipliers), event `mod:end`; `engine.time` channels; `onFixed(fn, { channel, phase })`; `onRender(fn)`; `engine.wrap(target, method, fn)`; `input.gate(action, owner)`, `input.push({ owner })`, `describe().holds`.
- Look: `look.<part>.manual(keys)`, `look.state(patch)`, `look.shadow.include(material)`, `look.materials.glow` (emissive that follows daylight), `look.view`, `lights.env.intensity` / `lights.env.share`, sun `shadow`, hemi `ground`; sky `top` / `horizon`; `style.sky.dim: { tint, stars }` (default on; false keeps a sky.tint at full color at night, or stars through cloud cover); `replace(m, { effects: false })`; `terrain({ material, effects: false })`. `describe().owned` and `describe().look.<part>.<key>.writer` say who writes each value; the engine yields to a game's direct three.js write.
- Shaders: named patch slots (`{ slot, pars, glsl }`), callable `#include <threedog_detail>` / `<threedog_lighting>`, uniforms `uSunDir`, `uDaylight`, `uTimeOfDay`; material texture slots (`{ texture, channel, repeat, wrap, colorSpace }`), `aoMap`, `lightMap`, screen projection.
- Rendering: light probe bake scaffold (`engine.bakeProbes` / `loadProbes`); `bakeVertexAO`; post `ao({ radius, intensity })`; dev views `overdraw` / `shaderCost`, `debug.defineView`, `debug.reloadGlsl`, `debug.reloadAssets`; `inspect.materials()` / `inspect.perf()`.
- Assets: `manifest([packs])`, `paramsOf / setParams` (hot swap), per-entry `cache: false`, `castShadow`, `receiveShadow`; textures as a Texture or factory; sounds as synth functions.
- Content: `contentParts` (one kind split over files), `engine.content.fields()`, `content.spawn`, field tables checked by content-check, content write-back.
- Characters: `maxJumps`, `airJumpSpeed`, `jumpBuffer`, `fall`, `states`, `channel`, `id`, mover `'manual'` (switchable at runtime), `launch`, `addJumps`, `resetJumps`, `jumpState`, `stat()`, `characters.support` (moving platforms), `safeGround`; events `character:launch`, `character:fall`, `character:water`. Anything can be ridden (`Rideable`, several seats, passengers).
- Gameplay: hold / approach interactions (events `interaction:hold`, `interaction:interrupt`), per-actor bags `inventory.of(actor)`, `quests.advance`, dialogue bubbles (`channel: 'bubble'`, event `dialogue:bubble`), UI focus navigation and choice cursor, HUD anchors, grid levels / occupancy layers, `npcs.add({ channel })`.
- Cameras: follow camera `projection` / `size`, `ground`, `mouseLook`, `hideTargetNear`, `setView / getView`, preset `thirdPersonAction`; `screenToGround` on every camera rig.
- Saves: `saves.register({ movedFrom })`; `dispose({ keepContext })`; net WebSocket heartbeat / reconnect; worker watchdog.
- Exports: `calendar`, `pickups`, `contentParts`, `bakeVertexAO`. Tools package exports `@threedog/tools/browser`, `look`, `contract`, `panel`, `gallery`.
- Optional technique examples, copied into a game rather than installed as modules (`threedog examples list`).
- World: near tiers `world.simulate(kind, { fullRadius, nearEvery })` (records beyond `fullRadius` run near once every `nearEvery` seconds with the accumulated dt). NPCs use them: those farther than half of `world.radius` now step 15 times a second instead of every fixed step.
- Assets: `assets.modelNow(name)` of a registered model nothing has loaded yet (code-built ones included) warns once in dev `[asset-not-loaded]`, naming `modelNow(name) ?? await model(name)` and `preload: true`.
- Grids: default player text `grid.<code>` (zh-CN, en) for every built-in failure code (`outOfBounds`, `occupied`, `wrongGround`, `notFlat`, `noGrid`, `idTaken`, `unknown`, `notPlaced`, `noTarget`, `badFields`), registered by `grids()`; `engine.t('grid.' + r.code)` no longer warns `[unknown-name]`.
- Light pool: `lightPool.add(at, { dusk })` lets a source follow the time of day on the same daylight curve as `look.materials.glow` (street lamps off at noon, their light given to lit sources); default off.
- HUD: `hud.counter(id, { value })` takes text too (a clock, a quest step); without a value it shows the label alone instead of "0".

### Changed defaults

- Lighting (changes every game's default look under a sky): the style's ambient column is now the whole diffuse fill. The neutral room environment takes its share (`look.lights` `env.share`, 0..1, default 0.5) and the hemisphere light the rest (`env.intensity` stays the absolute `scene.environmentIntensity`, also under a sky: a game's value is written as given); before, the room map added about four times the ambient on top, so sunlit and shaded faces looked alike (rainy-street noon: shadows 19% darker -> 50%). Packs tuned against the old fill may want a higher ambient column.
- Post effects: a listed effect is on. `lut`, `grain`, `vignette`, `chromatic`, `dof`, `ao` and `outline` no longer default to `enabled: false` (placed in `style.post` they silently did nothing); pass `enabled: false` to list one off. `style check` counts on-effects by the same rule.
- Lighting: under a sky the neutral room environment follows the sky's day curve (nights darker on PBR); sun shadow bias is a few centimeters in world terms (contact shadows); neutral sky keyframes hold night longer.
- Post: on the low tier `look.post.set({ '<effect>.enabled': false })` turns off a costly effect the game added (it was a no-op). Photo bloom follows the game's post chain.
- `freeze()` keeps `uTime` moving (`{ ambient: true }` stops it). `jump()` is buffered. `item:add / remove` fire for every container.
- Batching merges only engine-placed content; game meshes opt in with `userData.batch = true`.
- i18n locale matched by language (`'zh'` → `'zh-CN'`); unknown locale warns once. `input.simulate` throws on an unknown action.
- Cold start: nothing renders before ready; shaders compile for the real target.
- NPCs: near tiers are off by default (every near NPC walks every fixed step; before, NPCs beyond half `world.radius` moved every 4th step in visible jumps). Large crowds opt in with `characters({ npcTiers: { fullRadius, nearEvery } })` or `engine.npcs.tiers(opts)`.

### Fixed

- Interactions: an interaction on a model the game moved away from its world record is found where the model stands (was missed beyond 2 m). One xz index keyed by each item's world position, re-filed only when it moved.
- Scene delta (cascades, fog, glow): a class with its own `material` accessor (troika-three-text) keeps it; the engine's material-swap hook calls the original getter / setter instead of shadowing them.
- UI display timers (toasts) run on the page's own clock: wall clock in the game, the stepped time on a headless page, so `threedog step` then `snap` no longer shows every toast from the step.
- Sky: stars sit behind the drawn clouds and dim with the weather's cloud cover (`uCloud`), so a rainy or overcast night shows no starry sky (without weather the default cover 0.25 leaves them at 75%).
- Adaptive resolution changes the render scale before a frame draws, not after: the frame of the change was presented blank (a screenshot caught it black).
- Weather grey (and any `sky.tint`) follows the sky's light: the tint color is dimmed by how bright the sky is now, so a rainy night stays dark instead of turning lit grey; the brightest sky row is unchanged.
- Under a sky the room environment follows the sky's light (ambient column x sky color), not the ambient column alone: Standard / Lambert / Phong no longer stay day-lit at night while Toon goes dark.
- `describe()` shows set values (post params, exposure, light intensity) as set (`0.25`, `1.12`), not rounded to one decimal.

### Saves

- 0.2 saves load. The calendar takes the old `sky` part (`movedFrom`); saved NPC `talk` fields become `interact`; the `world` part is version 5 (migrated on load). 0.2 builds refuse 0.3 saves as `'tooNew'`.
- A save with a `null` part is refused as corrupt; a load error in any part, `world:load` listener or `afterLoad` rolls the game back.
- Physics: new save part `rigid`. Bodies added with `addBox / addBall / addHull({ id })`, and every vehicle, save pose, rotation, velocities and sleep; a load restores them (before, a toppled crate came back upright and at rest, and a car stayed where it was at load time). Ids are unique across bodies and vehicles (`[rigid-misuse]`). Not synced by `net()`. newGame / load rebuild the physics world and emit `rigid:rebuilt { world, player, bodies }` once the bodies are back: a game re-creates its own joints there (they used to vanish silently). In dev, a rebuild that dropped joints with none re-created by the next step warns `[rigid-misuse]`.

### Tools
- `threedog snap` on a paused (step-driven) page draws the current state once before reading, without advancing game time: at tick 0 it saved a black picture.
- `threedog how`: among equal matches an AI.md row (the one recommended entry) ranks before recipe sections and technique examples; the recipe column no longer counts as task words. `docs/CONVENTIONS.md` "One task, which entry" says which entry is first where a task has several.

- Removed: `threedog new-style`, `--style` on `new-game` / `init`, positional `content set <id> <field> <json>` (now `field=value`). A game's look lives in its own `style/` folder; no published style packages.
- Game folder: a command run inside a game acts on that game wherever it sits (nested in another repo's npm workspaces, or outside `games/` here); `-w .` and `-w <path>` name a game by its folder. `threedog init [folder]` takes the folder to create (was a name for the current folder) and refuses a workspaces root.
- Errors: `engine.error.at` is the first stack line of a gameplay error (also on the describeText error line); bridge commands print `engine error [code] where: message (at …)` instead of `engine error [object Object]`.
- Error summaries (the dev log's repeat line, `threedog errors`, play / verify / test results) keep the end of a long message, where engine errors put the requirement and `[code]` (was cut at 100–220 characters).
- `new-game` starts blank; `--open-world` gives terrain, sky, follow camera and a player.
- Added: `threedog stress`, `tune show | write`, `gallery [--shots]`, `art list | copy`, `content add | remove`, `--gpu` / `--software`, `doctor --json`, `map -w <game>`. `threedog shot` prints the look numbers after every shot (`--ref`, `--no-look`, `--json`).
- The look check reaches every picture: `threedog snap` (dev bridge / MCP) runs it on the live page (`--no-look` skips it); `threedog shot http://localhost:5173/` opens a running page without building; `threedog shot --image file.png` gives the pixel-only part for a picture taken any other way and says what needs the live page. Glare is printed as `fact:` with the detail lost under it (on vs off), a `contradiction:` only where DESIGN.md says no glare (`Look intent: no-glare`).
- Look check: large clipped areas, large near-black areas and a night not dark from lighting (`clipped`, `crushed`, `time-flat`) are now `fact:` lines, a `contradiction:` only where DESIGN.md declares the opposite. DESIGN.md takes an optional `Look intent:` line of listed words (`no-glare`, `no-pitch-black`, `dark-nights`, `bright-nights`, `strong-light`, `bright`, `muted`, ...), the only source of a look wish: the free words of the "Look and controls" table and "Not for this game" are no longer read; an unknown word is reported. `style check` no longer warns above 2 post effects: it notes which are on, which are costly, and how to see each one's cost.
- content-check: fields of props, templates, pickups and kinds; model names from the game's `assets.js`; old NPC `talk` and `'synth'` sound rules are errors. Rules R41–R45 (engine code); R39 removed.
- Template: a new game's package.json depends on `@threedog/post-effects` (the style's `post` line uses it); the outside-the-repo check installs exactly the template's dependencies.
- Template: a new game has the `shot`, `types`, `perf`, `bake`, `assets` and `doctor` scripts the docs name (`npm run shot` works in a standalone game).
- Error hints: a property read on `null` no longer gets the "module not installed" hint (`null-value`: a lookup or helper such as three.js `mergeGeometries` returned null).
- Look check: a `light:` fact (key vs fill share of the brightness, how much darker shadows are; a contradiction only under a DESIGN.md "strong / dramatic light"), a fact when the camera stands inside a closed mesh, each exposure next to noon / midnight when a style's exposure curve differs; the printed block is short (at most four one-sentence hints, ranked; `--json` keeps all).
- `threedog shot` / `snap` print only what bears on the picture under it (time, weather, camera; `threedog describe` for the rest, `--json` / `--describe-only` keep the whole state). `threedog check` prints warnings as one count line per rule (`--verbose` lists them).
- Ops `interaction.use` / `pickup.take`: a `tooFar` result carries `facts: { distance, radius, at }`. `presets.keys.gridRotate` is in the types. GAMEMAP counts an action named by an interaction as used. The dev model-cache warning names the plugin's error instead of "no model cache".

## 0.1.0 (unreleased)
