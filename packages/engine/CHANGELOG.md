# Changelog (threedog)

The engine has not been released yet, so this log is not maintained before release. At release time it is written in one pass from git history and `docs/API.md`: "what changed, how a game upgrades", placed under the version heading.

## 0.3.0 (unreleased)

WebGL renderer. Upgrade steps for a 0.2 game, most common first, with the error each old form now gives: [docs/MIGRATING-0.3.md](docs/MIGRATING-0.3.md).

### Breaking

- Options: more option bags go through one schema (`readParams`): an unknown or removed option throws `[module-params]` in dev (release: warns once, ignored). This covers `createEngine`, `openWorld`, module factories, `npcs.add`, `createPlayer`, `triggers.add`, `addWheeled`, `audio.addBus`.
- Calendar: time of day, days, seasons, clock-time timers and their save moved from `sky()` to the new `calendar()` module (`engine.calendar`). `sky({ dayLength | day | seasons | daysPerSeason | hoursPerDay })` throws `[sky-option]`; `engine.sky.timeOfDay / day / season / ...` throw `[calendar-option]`; `engine.sky.at / between / daily / onSeason` are gone. `openWorld` installs `calendar` (object form `calendar: {}`, was `sky: {}`).
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
- 0.2 forms that used to do the wrong thing silently now throw naming the new form: `dialogue.say / start` options are checked (`lock` → `channel: 'bubble'`); `engine.clock.timeScale` and writing `clock.rate` → `[mod-owner]`; every calendar member read on `engine.sky` (the list comes from the calendar contract) → `[calendar-option]`; `style.pickup` keys are checked (`model` → `[module-params]`); in dev, reading a renamed result field (`.reason` of any failure, `runState.by`, `describe().ui.inputContexts`) → `[renamed-field]` (one helper, `core/validate.js`).

### Added

- `calendar()` (`at / between / daily / onSeason / untilMark`, `isDay`, `daylight`) and `pickups()` modules, both in the `index.js` exports.
- `engine.mod` / `engine.stacks`: owned, timed, saved modifiers for any quantity (`move.speed`, `clock.rate`, sky multipliers), event `mod:end`; `engine.time` channels; `onFixed(fn, { channel, phase })`; `onRender(fn)`; `engine.wrap(target, method, fn)`; `input.gate(action, owner)`, `input.push({ owner })`, `describe().holds`.
- Look: `look.<part>.manual(keys)`, `look.state(patch)`, `look.shadow.include(material)`, `look.materials.glow` (emissive that follows daylight), `look.view`, `lights.env.intensity`, sun `shadow`, hemi `ground`; sky `top` / `horizon`; `replace(m, { effects: false })`; `terrain({ material, effects: false })`. `describe().owned` and `describe().look.<part>.<key>.writer` say who writes each value; the engine yields to a game's direct three.js write.
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

- Lighting (changes every game's default look under a sky): the style's ambient column is now the whole diffuse fill. The neutral room environment takes its share (`look.lights` `env.intensity`, 0..1, default 0.5) and the hemisphere light the rest; before, the room map added about four times the ambient on top, so sunlit and shaded faces looked alike (rainy-street noon: shadows 19% darker -> 50%). Packs tuned against the old fill may want a higher ambient column.
- Post effects: a listed effect is on. `lut`, `grain`, `vignette`, `chromatic`, `dof`, `ao` and `outline` no longer default to `enabled: false` (placed in `style.post` they silently did nothing); pass `enabled: false` to list one off. `style check` counts on-effects by the same rule.
- Lighting: under a sky the neutral room environment follows the sky's day curve (nights darker on PBR); sun shadow bias is a few centimeters in world terms (contact shadows); neutral sky keyframes hold night longer.
- Post: on the low tier `look.post.set({ '<effect>.enabled': false })` turns off a costly effect the game added (it was a no-op). Photo bloom follows the game's post chain.
- `freeze()` keeps `uTime` moving (`{ ambient: true }` stops it). `jump()` is buffered. `item:add / remove` fire for every container.
- Batching merges only engine-placed content; game meshes opt in with `userData.batch = true`.
- i18n locale matched by language (`'zh'` → `'zh-CN'`); unknown locale warns once. `input.simulate` throws on an unknown action.
- Cold start: nothing renders before ready; shaders compile for the real target.

### Fixed

- UI display timers (toasts) run on the page's own clock: wall clock in the game, the stepped time on a headless page, so `threedog step` then `snap` no longer shows every toast from the step.
- Sky: stars sit behind the drawn clouds and dim with the weather's cloud cover (`uCloud`), so a rainy or overcast night shows no starry sky (without weather the default cover 0.25 leaves them at 75%).
- Adaptive resolution changes the render scale before a frame draws, not after: the frame of the change was presented blank (a screenshot caught it black).
- Weather grey (and any `sky.tint`) follows the sky's light: the tint color is dimmed by how bright the sky is now, so a rainy night stays dark instead of turning lit grey; the brightest sky row is unchanged.
- Under a sky the room environment follows the sky's light (ambient column x sky color), not the ambient column alone: Standard / Lambert / Phong no longer stay day-lit at night while Toon goes dark.
- `describe()` shows set values (post params, exposure, light intensity) as set (`0.25`, `1.12`), not rounded to one decimal.

### Saves

- 0.2 saves load. The calendar takes the old `sky` part (`movedFrom`); saved NPC `talk` fields become `interact`; the `world` part is version 5 (migrated on load). 0.2 builds refuse 0.3 saves as `'tooNew'`.
- A save with a `null` part is refused as corrupt; a load error in any part, `world:load` listener or `afterLoad` rolls the game back.
- Physics: new save part `rigid`. Bodies added with `addBox / addBall / addHull({ id })`, and every vehicle, save pose, rotation, velocities and sleep; a load restores them (before, a toppled crate came back upright and at rest, and a car stayed where it was at load time). Ids are unique across bodies and vehicles (`[rigid-misuse]`). Not synced by `net()`. newGame / load now re-create the impulse joints a game made between engine bodies (they were dropped silently) and warn about joints they cannot carry.

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
