# Changelog (threedog)

What changed in each version and how a game upgrades.

## Unreleased

## 0.8.0 (2026-11-06)

npm never had 0.7.1: coming from 0.7.0, read this section and the 0.7.1 section below it, and follow `docs/MIGRATING-0.8.md`, which goes from 0.7.0 straight to 0.8.0.

- Decoded sounds no longer pile up: they are assets now, so `assets.release` takes a sound (name or path), `assets.trim()` and level changes free long ones, and long sounds over a memory budget go by themselves, the longest unused first. Playing sounds play on, a freed one loads again when played, effects under 10 s stay cached, `preload: true` keeps a track. A failed file by path now reads `Asset failed to load`, same code `asset-load`.
- Characters, vehicles and rigid bodies draw between fixed steps (`engine.stepBlend`), and the camera rigs follow that drawn place, so motion stays smooth on a screen faster than 60 Hz or when a frame runs no step or two. `root.position` and `mesh.position` stay the step's truth: gameplay reads what it read before, and the drawn pose is one step behind it, as swarms already were.
- `jumpBuffer: 0` means "this step only" instead of never jumping, a press now gets its whole `jumpBuffer` (one step more than before), and with `coyoteTime: 0` walking off an edge spends the ground jump instead of leaving a free air jump.
- `character.walkTo` no longer counts a long leg after a corner as being stuck: a path of several long legs used to replan at each one and ended `'stuck'` after `maxRepaths`.
- `session.load` asked while a new game is still running (right after a page opened with `?play`) waits and then loads; it used to join the new game, answer `true` and load nothing.
- `threedog types`: a name declared and never read is a hint in a game's code and an error in `packages/`. `shot <url>` on a built page keeps its fog, shadow, key and light facts and names what it could not read there (no three.js for the tools on a built page).
- `quests.define` refuses a quest without a `steps` list when it is defined; it used to throw on every check after `start`.
- The engine gives no help for this version's old names: a stale uniform name in shader text reads 0 with no warning, and an old `sky()` or `water()` option is an ordinary unknown option. See `docs/MIGRATING-0.8.md`.
- `saves.register({ movedFrom })` is removed; only the calendar used it. The time and day of a 0.2 save under the old `sky` part are no longer read. Every released sample save from 0.7.0 on still loads.
- `engine.sky.uniforms` is public, like `engine.water.uniforms`: the live handle for the uniforms given to `engine.sky.clouds()` and `engine.sky.layer()`, on both renderers (`engine.sky.dome.material.uniforms` only ever worked on WebGL).
- The field `calendar.daysPerSeason` is removed: nothing read it and writing it did nothing. The `calendar({ daysPerSeason })` option stays.
- `engine.THREE` is removed: `import { THREE } from 'threedog'`. Holding the whole of three.js on the engine kept every class in every game's bundle, and the package now has a `sideEffects` list: a bare `createEngine()` page went from 1561 KB to 1336 KB (470 KB to 397 KB gzipped). A dev page holds three.js under a private name for the engine's own tools (the picture check), a production build does not.
- The contract files are importable from an install: `import contract from 'threedog/modules/gameplay/inventory.contract.js'`, as `@threedog/tools/contract` says. They are plain data for checking a replacement.
- A model's clips moved from `model.userData.animations` to `model.animations`, three's own place. A game that cloned a model and then animated the clone crashed: three copies `userData` through JSON, which breaks the clips. A model with clips is now never batched, as the batching rule always said.
- `phase` on the engine has one more value, `'starting'`, while modules run their `init`; `'loading'` now starts after them.
- `uiFocus` is marked experimental: its shape may still change. `engine.input.push` is the stable route.

- 249 public names are now `@experimental`, so 1.0 does not freeze them: the ones no game, recipe, example or template uses, and the coordination features no test game has used (`engine.stacks`, `engine.wrap`, `engine.mod`, `time.channel`). None is removed; `docs/api-surface.txt` lists each one. They sit in: `adaptive`, `assets`, `audio`, `batching`, `budget`, `calendar`, `characters`, `checkOptions`, `collision`, `control`, `decoders`, `dialogue`, `error`, `firstPersonCamera`, `fixedCamera`, `flow`, `followCamera`, `ground`, `i18n`, `inRange`, `input`, `interactions`, `inventory`, `jobs`, `level`, `materialPatches`, `mod`, `music`, `nav`, `ops`, `page`, `particles`, `photo`, `pickups`, `player`, `post`, `quests`, `random`, `rays`, `rigid`, `rtsCamera`, `runState`, `saves`, `session`, `settings`, `sky`, `stacks`, `startup`, `stateApplied`, `stateRefused`, `stream`, `terrain`, `terrainMaterial`, `time`, `timeline`, `toggleOnKey`, `ui`, `uniforms`, `urlState`, `validate`, `vars`, `vegetation`, `water`, `weather`, `world`, `wrap`.
- NPCs and `character.walkTo` follow a path by one rule: an NPC skips points it has passed and no longer stands still for a step at each point, so it runs a few centimetres ahead of where it was mid-walk.
- `inventory.slotsUsed` is gone: read `inventory.of().slotsUsed`.
- `settings({ sections })` takes an entry `{ id: 'graphics', omit: [...] }` that leaves graphics rows out; an omitted row stays the game's value, and no preset or stored value moves it. A fixed pixel look omits `pixelRatio`, `antialias`, `adaptive` (recipe 62 section 4b).
- The WebGPU renderer no longer asks for `powerPreference` on Windows, where Chrome ignores it and warned on every page load.
- A damaged save is refused in more cases: an NPC `nav` that is not an object or a path that is not a list of points, a character speed that is not a sane number, a record with no `position`, content marks or an interactions part of the wrong shape, a physics body past ±1e7 (it hung the page for good). Each is `save-bad-record` at load (load false, game rolled back) instead of freezing the game. Found by the long fuzz runs.
- Docs: recipe 28 section 4b, a road laid on terrain: the road and the height function read the same data.
- A KTX2 model or texture asked for before `engine.start()` loads on WebGPU: the engine waits for the renderer's init itself, and `await engine.renderer.init()` is no longer needed.
- `engine.setCamera(kind, options)` before play (boot code, or with the title up) keeps its options when play starts.
- A moving physics body that freezes outside `rigid({ terrainRing })` warns once in dev, by name (`rigid-misuse`); recipe 11 explains the freeze.
- `hud.counter` with no label shows the value alone; it used to show the id.
- `inspect.perf()` on a halted page: `cpuMs` and `fps` are null and the text says they are not measured (they read 0). Its `lights` line says it counts point and spot lights.
- `input.holders` and `runState.blockedBy` count pushes and removes that wait for the next fixed step, so the status line of a halted page no longer names a closed window.
- Saves now hold the camera view: a new save part `cameraRig` (yaw, pitch), so Continue no longer loses a first-person view. Old saves load as before. `session.load` / `newGame` rebuild the installed rig on the same object, so a `const rig = engine.cameraRig` kept at boot stays the camera and a save part's `load()` that writes the rig keeps its write.
- Error codes merged before 1.0, one code per failure: `options-object` is now `bad-position`; `npc-option` is `character-option`; `pickup-prop-id` is `world-id`; `session-handle` is `module-handle`; `world-missing` is `module-needs`; `load-failed` is `asset-load`. `bad-arg` is gone: `input.bind` raises `input-keys`, `characters.support` raises `character-option`, `settings({ presets })` raises `module-params`.
- Some raises moved to the code that says what went wrong: `engine.stacks.define` of a known name raises `engine-misuse` (was `mod-owner`), `swarm.onStep` with no function raises `swarm-step`, `weather.set` with bad seconds raises `weather-option` (both were `module-params`), a damaged saved swarm raises `save-bad-record` (was `save-refused`).
- Four throws that protected nothing are now one dev warning: `engine.wrap` on a `_private` method works, `createEngine({ fallback })` without WebGPU starts, a vegetation `rule` beside `positions` plants the listed spots, `ui.theme.promptHeight` starts.
- Error text follows the current names: `shared-layer` no longer lists a `style` layer, `input-bound-twice` no longer mentions a module keys option, `rigid-misuse` covers the ragdoll cases, `quest-step` covers definitions, and other fixes that named the wrong call.
- Editor test fixes: the test pickup sat under the editor panel and could not be clicked (moved), the grid-item test model now turns with its record, and a drag where the outer turn ring would stand is checked to move the camera and write nothing (the turn handle shows the yaw ring only).
- Editor, first walked through by hand on a new game: opening it closes the title screen, Esc no longer opens the game's menu over the scene, the buttons stay in one place, a save says "Saved", a refusal is colored, a second Add lands beside the first, yes/no fields are lists (an unset `static` no longer looks like "no"), and a value the game cannot load (a `place` that does not exist) is taken back from the file at once instead of breaking the next start. `threedog content add` to a list written on one line opens it, one entry per line.
- `threePatches.off('lod-view-camera')` now works: LOD objects made after it keep three's own `update` and `clone`.
- `threedog how`: a sentence that only points at a recipe no longer ranks its row, and a text line joins the ranking only if it holds the typed word itself, so "webgpu", "node material" and "climb" reach their recipes again.
- A module's `type` is optional: without one it is `'rules'`. A module going against its type (a `ui` module binding keys, a `picture` module defining an op) now warns once in dev and the call goes through; it used to throw. An unknown type name still throws.
- `threedog state` and `threedog snap` (also `snap --play`) move no game time: they used to add a tick or two.
- Animators update in a core step right after the `onFrame` list, so an `anim.sync` / `go` / `set` from any `onFrame` shows the same frame.
- `engine.step()` during an unawaited `start()` or session change warns once in dev (`step-during-load`).
- `views.show` writes the fov through the engine's owner, so `autoView.manual('fov')` keeps the game's value, and `release()` gives the fov back.
- `assets.report` and `inspect.materials` share one texture slot table: `specularMap` is data in both, and a `lightMap` may be linear or sRGB in both.
- `createEngine({ audio: { music } })` key spelling is checked by `music()` when it installs, not in core.
- Removed: the error messages for names gone since 0.4 and earlier (`createEngine({ post })`, `createEngine({ style })`, `engine.elapsed`, a fourth `clock.after` argument): the first two are now plain unknown options. Error codes `renamed-field` and `shadow-type`, and `withHint` from `threedog/error-hints` (`hintText` stays).
- Removed before 1.0, nothing implemented it: the ground API's optional `ground.navGeometry`. The navmesh comes from `staticTrimeshes()`.
- `content.load` reads a pack's own `places` file; the `places` option goes on top, and `{ places: data.places }` is no longer needed.
- `weather()` no longer needs `sky()`: rain and snow fall without it, or under a game's own sky, which reads `weather.current.grey` and `weatherDraw.flash`.
- A low-tier device changes only defaults. `particles.define` `max`, `weather({ particles })`, a weather `count` and `sky.environment({ interval })` stand as the game gave them, as `colorResolution` already did.
- `sky.replace(false)` is in the type: it draws no sky. A skybox now reaches full brightness at the brightest row of the game's keyframes, not at ambient 1.2.
- `hlod` puts everything back when the module unloads. The shadows switch reaches near-only plants and plants on vegetation's own ground. `terrain({ viewFog })` keeps working under a replaced `terrain-draw`.
- `music.play`, `music.stinger`, `hud.counter`, `hud.bar`, `calendar.at`, `calendar.daily`, `calendar.between` and `vegetation.removeInstance` check their option keys.
- Removed, no reader anywhere: `settings.saved`.
- New in `threedog/tsl`: `noise`, `hash` (the engine's value noise, until now only in sky hooks) and `instanceOffset` (an offset through the instance's rotation and scale). `ctx.fx` in patches, sky hooks and post effect nodes now holds the same full list.
- `#include <threedog_uniforms>` declares every name on `engine.uniforms`, `uNight` and the sky values included. A shader that also declares one of them itself drops its own line.
- `engine.shadows.cache`: a batch now answers for its originals, so `{ static: cityRoot }` covers batched copies, and an InstancedMesh whose instances change, or that leaves the scene, redraws the kept map by itself.
- New: `adaptive.base`, the ratio this device or game starts at. A settings preset's `pixelRatio` is a share of it.
- Removed before 1.0, no game used them (`MIGRATING-0.8.md`): `adaptive.paused`, `settings.removeSection`.
- `hlod` hides a far original on the batch layer, the way `engine.batching` does. The `hlod-visible` patch and `userData.rayVisible` are gone: `mesh.visible` on a registered mesh is plain three.js again, and reads the game's value near and far. The full model of a far `assets.lod` waits on the same layer, so read `getCurrentLevel()` to see what is drawn.
- Occlusion culling keeps a game's `mesh.layers` write made while the mesh was hidden; showing it used to put the old mask back.
- Settings store only what the player changed, like `input.rebound()` for keys: one volume change no longer pins the render scale and every graphics value for later launches, and a preset is stored by name. A preset's `pixelRatio` is a share of the device's default ratio, so `medium` is no longer blurry on a 2x screen and `high` no longer renders 1.5x on a 1x one. `settings.values` is read only and `settings.get('pixelRatio')` is the real ratio. Stored files of version 1 are read: a value equal to the default lets go.
- `engine.setPixelRatio(p)` is now the top adaptive resolution climbs back to: it was undone within two minutes while the raw three.js call stayed. Adaptive may still lower it under load.
- New, off unless called, `@experimental`: `engine.rigid.ragdoll(character, { impulse, position, bones, limits, mass })` turns a skinned character limp and `rd.remove()` returns it to animation (recipe 11, section 3b). Reads common skeletons by itself, names what it cannot read; the mover, animator, capsule and camera yield and come back; the pose goes to the plain three.js bones in fixed steps; not saved. Partial or blended ragdoll is left out. `control.take` has a new layer, `physics`, between `cutscene` and `net`.
- Swarm: a handle kept in a field now stays good. Handles pass 2^24 after 16 births, and a Float32 column rounded them, so `row()` answered -1 as if the target had died. A game's own `fields` are `Float64Array` now (twice the memory per field); `x`, `y`, `z` and `r`, `g`, `b` stay `Float32Array`.
- `audio.buses.master` exists, as recipe 31 always said. A name that is no bus warns once with `[unknown-name]` and gives `master`, so `node.connect(audio.buses.wrong)` no longer throws and freezes gameplay in dev.
- Pure functions: a number such as `1e9` or `0xff` is no longer read as an outer variable named `e9` or `xff`, so `terrain({ height })` accepts them.
- `content.load`'s `unknown content` error now says `rules` must be listed in `content/index.js` too, and recipe 20 says the same.
- Docs: `n.fbm`, `noise` and `hash` run 0 to 1 (recipe 28); every `bloom` option with its default (52); pool lights and walls (09); `onBeforeCompile` on WebGPU and a node-material sky (54, 08); where the canvas is (01); `vegetation.define` order and keeping plants off a line (36); how `describe` nests a part (19). Recipes 02 and 04 no longer send a game to engine source or engine tests.
- Tools tell the truth, from four AI-built games. `check` reads `content/index.js`, what the page really loads: a kind listed there without `rules` is now an error instead of a green check and a dead page, and a file left out is a warning. A kind's `load` is optional: a game that imports its own file no longer writes an empty function. Valid TSL (`p.xy`, `.mul` on a `uniformArray` element) is a hint, not "engine API misused", and the worker check no longer reads `1e9` as a variable `e9`.
- `applyState({ fresh, play, pos })` keeps `pos` (a new run used to undo it while `state` printed Set). A view moves `engine.focus` to its target and waits for the world there, so `shot --view` no longer needs a `--pos` beside it. `threedog perf -w game` measures a game's page, as its usage line always said.
- `threedog test` says before the run, and again on a timeout, that a spec with `page.screenshot` left the GPU for software rendering; `software: false` keeps it on the GPU for a real picture. COMMANDS.md: a steering test holds the loop and advances with `engine.step`, so machine load cannot change its path.
- Picture check: edges are not read when the picture changes by itself between two identical renders (moving film grain read as "shadow stripes on 92%"); a line over a default budget says why the number exists and that nothing is cut at it. `threedog how` no longer prints a GLSL sample under a row in a WebGPU game. New games: CLAUDE.md names `threedog play`, STATUS.md no longer asks for three versions against "build it".

- Physics follows the `world` time channel: `engine.mod('time.world', { mul: 0.2 })` slows rigid bodies and vehicles with everything else, and a hit-stop at speed 0 holds them. To keep bodies at full speed, slow a channel of your own instead of `world`.
- The press that opens a window or dialogue from a fixed step no longer also acts on it. `h.fresh` counts input frames, ended by `input.endFrame()`, so it holds at any frame rate and no longer depends on who called `uiFocus` first.
- Renamed before 1.0 (`MIGRATING-0.8.md`): `engine.pause` is `engine.haltLoop` and `engine.paused` is `engine.halted`, because it stops rendering and an AI asked to pause a game reached for it and got a dead screen; a game freezes (`engine.freeze`, flow `'paused'`). The `pause` stack is `halt` and the error code `pause-owner` is `halt-owner`. `runState.state` is `'loading' | 'title-frozen' | 'halted' | 'frozen' | 'running'`: `'test-paused'` and `'paused'` go, and so does the `kind: 'test'` option.
- `engine.freeze(owner, { ambient: true })` is now a real still: skeletal animation, character animation and particles stop with `uTime`. A plain freeze, as behind a pause menu, keeps them moving as before. `engine.still` is true during one, for a game's own frame code.
- A page hold is a freeze (`MIGRATING-0.8.md`): a window in the background or a lost graphics device freezes gameplay by owner `'page'`, a full still. Cutscene tweens and camera moves used to run on over a stopped world, and `runState` said `running`. `page.held` is removed (`engine.frozen`, `runState.owners`), and `describe().page.held` goes with it. `step()` obeys it like any freeze; a page with the loop stopped has no hold, so tools still step a background window.
- Removed: error code `character-hook`. Nothing raises it: assigning `player.onStep` or `player.onLand` gets no warning; use the events `character:step` and `character:land`.
- Marked experimental, no promise at 1.0: `nav.crowd`. It hands out the raw Recast object, like `nav.navMesh`, `query` and `tileCache`.
- New, off unless called: `engine.shadows.cache(light, { static })` draws what does not move once and redraws only the rest, by copying a kept depth map into the light's shadow map on WebGPU (recipe 45). One plain map only, no cascades; other renderers draw everything, with a warning. Marked `@experimental`: no frame time has been measured yet.
- `threedog assets optimize --lod` writes lower-detail levels of each model (meshoptimizer simplification, geometry only) and reports triangles per level; skinned, morphing, animated and small models are skipped with the reason. `engine.assets.lod(name)` (experimental) or `lod: true` on a prop or template draws them as a plain `THREE.LOD`; off by default, and rays, collision and saves keep the full model. A LOD object is never batched.
- `threedog assets optimize` no longer needs the external `ktx` program: when it is not on PATH the textures are encoded by `ktx2-encoder` (npm, MIT, Basis Universal as WebAssembly), still by slot (normal / occlusion / roughness as linear UASTC, color as sRGB ETC1S). `ktx` on PATH stays the first choice; the output names the encoder and the encoding time. The "`ktx` is required" error is gone; with no encoder at all it says `npm i -D ktx2-encoder`. Field page `docs/testing/field/2026-11-05-ktx/`.
- Saves survive upgrades, now guarded: fixed sample saves from 0.7.0 and from 0.7.1 (`packages/engine/tests/save-compat/samples/`, every save part plus the stored settings) are loaded by a test on every run, and a save from a newer engine is checked to be refused with a message and no change. Nothing in the engine needed fixing. Every release now adds a sample and old ones are never edited (`docs/plans/release-checklist.md`).
- `engine.batching.tint` on a batch that had already drawn did nothing on real WebGPU: three built the batch's shader before the batch had any instance color, so the first tint never reached the GPU. The first tint now rebuilds the batch material once. Guard in bundles.mjs reads pixels on real WebGPU.
- `engine.batching` batches are no longer `DynamicDrawUsage`: on `WebGPURenderer` that refreshed every batch in full, every pass, every frame. City flight on a real GPU: frame median about 10.6 to 8.7 ms (one pair). Writes to a batch reach the screen as before.
- Three's `BundleGroup` works beside the engine, no new API: `engine.batching` leaves a mesh under a `BundleGroup` alone, `hlod.add` skips it with a warning, `describe().render.bundles` and the `inspect.scene()` reason `in-bundle` report it. It gained nothing on the city scene; recipe 05 says when it may pay.
- `engine.stream` unloads through `engine.jobs`, behind every build, so a row of blocks no longer leaves in one frame. An entry out of range can stay a few frames longer in the real-time loop; `engine.step` still finishes in the same frame.
- `engine.remove` counts the scene only when a part is held by neither `assets.shared` nor `batching.held`. Batching relists only the parents that changed.
- A damaged world save record whose `motion` is not an object (e.g. the number 25) is now refused at load as `save-bad-record` (load false, game rolled back) instead of throwing `Cannot create property 'vx' on number` in the fixed step and freezing the game; `motion: null` and game-own fields stay allowed.
- A hang the fuzz found: a position far past float precision (`applyState({ pos })` with z = -3.6e178, or any `placeAt` / ground call) froze the page for good, because the chunk loops (`cx = floor(x / size); ...; cx++`) stop advancing once `x / size` passes 2^53. Positions with |x| or |z| above 1e9 are now refused with the `bad-position` code and the position in the message (`xzOf`), so `applyState` reports `pos` as refused and the game goes on. Each fuzz case also has a time limit now (`FC_CASE_MS`; 60 s in the browser items, 30 s in the writer item): a case over it is a failure that prints its input, seed and path. Dev warning, once: a world record whose `jump` or `safe` is the wrong kind of value (a damaged or hand-edited save) is still repaired when the character writes its motion, but the warning `character motion: the world record's 'jump' is ...` now names the field.
- Fuzz tests (fast-check, fixed seed, short in the normal suite): the content writer now refuses values that are not data (NaN, Infinity, undefined, functions, bigints) by name instead of writing them as code, and writes a carriage return and -0 correctly; a damaged `scene` save part is refused as `save-bad-record` (load false, game rolled back, no frozen gameplay) instead of throwing a code error. Long run for a release: `FC_RUNS=300 threedog test Fuzz` (see `docs/plans/release-checklist.md`).
- Editor (dev server only): pickups get a height handle and can be added from the panel (items the game defines); a grid item turns in quarter turns and writes `rotation`; undo of a cleared field puts it back in front of the property that followed it (the content write takes an optional `spot`); an entry with computed values can be deleted and the delete undone; the turn handle's outer rings no longer tip the anchor. NPC facing is not content data, so NPCs get no turn handle, and schedules are still edited by hand.
- Dev warning, once: the game added its own light while the engine's placeholder lights (`engine.lights.sun`, `engine.lights.hemi`) are still in the scene, so the two add up. It names the fix, `createEngine({ lights: false })`; nothing is refused or changed, and there is no warning with `lights: false`, with the placeholders removed, or for a module's or pool's lights. New field page `docs/testing/field/2026-11-05-many-lights/` (frame time vs light count, lightPool, shadows, adding a light mid-play).
- Fewer freezes from hooks: a quest reward that throws (`content-place`, `ground-missing`) no longer leaves the quest half finished. `content.run` runs every effect of a list and rethrows the first error, the quest still finishes (`quest:done`, toast) and the failure is reported softly. A job that fails inside its commit tick no longer freezes the fixed step a second time; its promise rejects once. `ground-missing` (a prop, spawn or `snapToGround` beyond `terrain({ shape })`) and `swarm-disposed` (`spawn()` after `dispose()`, returns -1) are warnings now: the fallback was already safe.
- Surface names these changes touch, as the API lock lists them: `decoders`, `openWindows`, `uniforms.uCloud`, `uniforms.uCloudScale`, `uniforms.uCloudSpeed`, `uniforms.uCover`, `uniforms.uCurve`, `uniforms.uMoonPower`, `uniforms.uSunPower`, `sky.gradientCurve`, `sky.moonSize`, `sky.orbitSway`, `sky.orbitTilt`, `sky.starScale`. See `MIGRATING-0.8.md`.
- Removed before 1.0 (`MIGRATING-0.8.md`): `rays.cast`, `rays.pick`, `i18n.t`, `engine.openWindows`, `engine.decoders`, `EASINGS`, `assets.reportText` and `assets.users`.
- Removed and renamed before 1.0 (`MIGRATING-0.8.md`): `player.object` is `player.root`, `player.addTo` is `engine.add(player.root)`, `hud.add` is `hud.bump`, `dialogue.cps` is `dialogue.charsPerSecond`, `rtsCamera({ angle })` is `pitch`, `weather.define` is `weather.defineField`, `terrain.T` is `terrain.generator`, `terrain.CHUNK` is `terrain.chunkSize`.
- Marked experimental, no promise at 1.0: `player.saveMotion`, `player.loadMotion`, `engine.terrainDraw`, `engine.vegetationDraw`, `engine.weatherDraw`.
- Removed or renamed before 1.0 (`MIGRATING-0.8.md`): `rigid.R` is `rigid.rapier`; `collision.circles` and `collision.boxes` go (use `collision.forEachStatic`); `stream.readyCheck` is `stream.addReadyCheck`; `music.addTracks` is `music.define(name, track)`; `debug.startBench`, `debug.benchmarking` and the panel's stress button go (use `threedog stress`); the types `Object3D`, `Vector3`, `Vector2`, `Color`, `Quaternion`, `Material`, `BufferGeometry` and `Texture` are no longer exported from `threedog` (import them from `three`). `threedog assets` needs a verb (`optimize` or `check`). `doctor --json` prints `{ ok, summary, items }`.
- One meaning for `@experimental`: the name may change or go with no migration note. `api-count` reads the tag, a tag on a module or an engine member covers what hangs off it, and `docs/api-surface.txt` ends the line with it, so rule R55 lets it move and requires a note when a stable name gets marked. Newly marked: `net`, `Net`, `fakeNetwork`, `webSocket`, `threads`, `grids`, `Grids`, `Grid`, `Layer`, `hlod`, `ops.guard`, `ops.allow`, `terrain.edit`, `stream.source`, `stream.sources`, `stream.teleport`, `post.get`, `post.list`, `post.own`, `post.setAntialias` (tagged before, read by the lock only now), `rigid.rapier`, `rigid.world`, `rigid.playerBody`, `rigid.playerCollider`, `nav.navMesh`, `nav.query`, `nav.tileCache`, `nav.helper`, `assets.gltf`, `assets.draco`, `assets.ktx2`, `post.object`, `post.targets`, `shadows.csm`, `commits`, `swarm`, `terrainDraw`, `vegetationDraw`, `weatherDraw`, `bakeProbes`, `loadProbes`, `loadLightmap`, `moduleOrder`, `moduleStates`, `disabledModules`, `player.saveMotion`, `player.loadMotion`, `jobs.loadingMs`, `jobs.maxSteps`, `jobs.slowStepMs`, `stream.unloadFactor`, `batching.held`, `world.steps`, `level.heightfield`, all of `threedog/tsl` (`wind`, `cloudShadow`, `season`, `objectOrigin`, `uniforms`, `celLighting`, `detailBump`, `detailNoise`, `rim`, `shadowTint`, `waterFresnel`, `waterSurface`, `waterWave`, `wrapDiffuse`), `voxelGI`, `temporalAA`, `sunShafts`, `lightVolumes`. Only `--json` and MCP shapes are an interface; printed text may change.
- Uniforms renamed (`MIGRATING-0.8.md`): `uCloudScale` to `uCloudShadowScale`, `uCloudSpeed` to `uCloudShadowSpeed`, `uCloud` to `uWeatherCloud`, `uCurve` to `uSkyCurve`, `uCover` to `uGroundCover`, `uSunPower` to `uSunBrightness`, `uMoonPower` to `uMoonBrightness`. The dome's own `uCloudScale` and `uCloudSpeed` are now `uSkyCloudScale` and `uSkyCloudSpeed`, on `engine.sky.uniforms` and in sky hooks.
- `engine.batching`: the default cell is now four stream cells (256 m), not one (64 m). A cell no wider than a streamed block could not batch across blocks, so a model used a few times per block drew every copy alone. The city field run on WebGPU went from 19.8 ms to 9.4 ms a frame (real GPU, 14.4 km flight). Culling is coarser: 13-25% more triangles drawn there. A game with heavy props can set `createEngine({ batching: { cell: 64 } })`.
- Removed or renamed before 1.0 (`MIGRATING-0.8.md`): `engine.tick` is `engine.time.tick`; `engine.cpuMs`, `cpuMs`, `engine.cpuPhases`, `cpuPhases`, `cpuPhases.fixed`, `cpuPhases.frame`, `cpuPhases.render`, `cpuPhases.afterRender` are read through `engine.inspect.perf()`; `engine.terms`, `terms`, `terms.cloudShadow`, `terms.season` are `engine.shaderTerms`; `engine.view`, `view`, `view.manual` are `engine.autoView`; `terrain.isReadyAround` and `rigid.groundReady` are gone (`engine.stream.addReadyCheck` already waits on them); `lightPool.usage` is `engine.describe().lightPool`; `saves.queue` and `saves.prefix` are private (new `saves.putAttachment`, `saves.removeAttachment`, `saves.attachments`, `saves.storageKey`).
- Failure and "not found" have one shape (`MIGRATING-0.8.md`): `inventory.add` returns `{ ok: true, key, added }`, or `{ ok: false, code: 'full', facts }`, also on containers. `grids.get`, `inventory.get`, `interactions.get` give `undefined` when there is none, and `interactions.get` and `interactions.items` are typed.
- `clock.after(seconds, fnOrEvent, { data, channel })`: the third argument is options, as in `clock.every`; the old form throws.
- `player.onStep` and `player.onLand` were one-slot properties, and a second system silently took the slot: they are gone. Listen to the new `character:step` and to `character:land`.
- Writing `stream.radius`, `terrain.viewChunks`, `terrain.density`, `post.antialias` or `weather.auto` now takes effect like its `setXxx`.
- `engine.moduleOrder`, `moduleStates`, `disabledModules`, `bakeProbes`, `loadProbes` and `loadLightmap` are marked experimental.
- Tools: a second `tune write` always takes effect: a line with a hand comment or a Windows line ending used to run after the new value and win while the tool said "Written". The file keeps its line endings, and code in a material literal (`side: THREE.DoubleSide`) stays.
- Editor: steps run one at a time, each from the file as the last step left it, so an overlapping save, drag or Ctrl+Z no longer corrupts the undo history or gets refused as a conflict. A drag or a row being typed in survives a save landing under it; a dead dev server is a refused step. A file put back to the editor's last text now reloads the page. Add skips an id only the file has; a broken list in a json row is refused; a field written as `null` can be edited; key order no longer counts as a conflict; a failed check leaves a hand save alone; removing an NPC reloads the page.
- Tools: `threedog stress` stops on a lost WebGPU device or an uncaptured GPU error (it read as spare capacity), frees each step's instanced mesh, and keeps the load inside the view. Both stress pages now share `@threedog/tools/stress-load`, so a game on WebGL gets gpu ms too.
- `engine.stateRefused`: what the URL parameters or the latest `applyState` could not do. `shot` and `capture` fail on a value you named that the page refused (`--weather rian`). A weather refused early and accepted late is no longer reported, and a hook refusing `at` is a refusal, not a position error.
- `describe().world.changed` leaves out where a record with motion stands (a walking NPC), so the Changed line keeps what a command did; runtime rows hold a copy of the position.
- `check` in a game: file size (R1), copied passages in game docs (R22), paths, commands and links in game docs (R18), a module with no key (R51) and setup-time creation (R33) are warnings now. R33 stays an error only for `{ initial: true }`, and its fix names `// runtime: <reason>`. A stale GAMEMAP warns in a game and still fails for the engine's examples. `lib` no longer reads `createEngine(cfg)` as WebGL.
- No key is not an error: `interaction-no-key` is a dev warning and play goes on. `interaction.use` runs when code asks, `ops` does not offer it, and the `noKey` code is gone. `engine.input.bind('interact', [])` says no key on purpose.
- Sky: a second `engine.sky.environment()` replaces the first. `engine.sky.replace(false)` means no drawn sky. `sky({ time })` with a calendar warns once in either install order. `engine.sky.layer` takes any non-empty name. `engine.sky.sunDir` is the same vector as `uSunDir`, and a game's write stays (`engine.autoView.manual('sunDir', false)` gives it back). `camera.aspect` is the owned value `view.aspect`. A direct write to `uSkyTop`, `uSkyHorizon`, `uDaylight` or `uTimeOfDay` warns once (`signal-overwritten`) with the entry to use.
- `applyState`: `season` with no calendar and an `at` nothing knows go into `refused` instead of throwing after a partial apply. The `state-at` code is gone.
- `world`: `{ save: false }` records may hold anything, unless the kind is simulated with `worker: true`. A class instance in a saved record (`Vector3`, `Color`) is refused at once instead of failing after a load, and the error gives the line to copy.
- Fewer freezes from the loop: an `approach` interaction on a held character is refused with `cannotWalk`, an NPC yields when a game holds it on the base layer, a WebGL-only material added after start is reported without stopping play.
- New games: the template colors the engine's background instead of assigning one, so `sky()` shows and `palette.background` still works. Style advice in the template reads as defaults, with plain three.js named as equally valid.

- Loading: a model whose textures failed to decode (KTX2 transcoder, bad image) now counts as loaded with missing references: `describe().loading.ok` is false, `warnings` names the file, and `threedog loading` says "N partial" instead of "N/N ok". Before, GLTFLoader swallowed the failure and everything read ok.
- Audio: `describe().audio` (present while a bus is ducked or a voice plays) and `engine.audio.info` (now documented) report the duck level the active ducks ask for, not the gain node's value mid-fade, so a fade reads right on a headless page where the audio clock stands still.
- Errors: the `asset-load` hint tells "called before the backend is initialized" (a load before `engine.start()`) from a real 404; the `not-installed` hint says it is a plain TypeError and when engine.<module> is the cause. The error log names an Event or an empty-message rejection instead of `{"isTrusted":true}`.
- Tools: `shot --keep --out name.png` writes exactly `name.png` (the timestamp is only for generated names); the scenario line uses ground and weather ids, not the translated names. Recipes 16, 26 and 34 note the position formats, that `bloom` / `ao` rows already exist, and that occlusion culling hides nothing in step mode.
- Pathfinding: without a navmesh, `characters.findPath` returns `null` (`noPath` when detailed) for a target inside a wall or water, and its straight legs are sampled every 0.12 m, so a route no longer clips wall corners (up to 0.3 m before).
- Describe: records without a name (props, template instances) now appear in `nearby` by id with their kind, the nearest 8 only.
- Describe: `ambience` carries `audioLocked` while its rules wait for a click or key press, so an empty `on` on a bridge page is not read as "no rule matches here".
- Tools: `play --stop` asks the server up to three times and stops a stuck one named in dev.json, instead of removing the record and leaving the process alive.
- Docs: recipe 26 covers hiding the interface for a photo mode (engine ui and plain three.js), custom title items closing the title, and the HUD unit following the engine locale.

- Library: `lib pull` refuses an entry that cannot draw on the game's renderer, with nothing copied, and `lib check` fails on such a copy (GLSL in a WebGPU game, a node material in a WebGL game). `--force` copies it to port by hand; the check reads the copy, so a port clears it. Node materials and TSL now count as WebGPU only when an entry's `backends` are read from its code, and an entry without `backends` gets them from its files.
- Library: `lib pull` prints the import path where the file landed, not the path stored from the game the entry came from.
- Assets: `assets.texture()` and models with textures before `start()` work on the WebGPU route. The upload waits for the first frame instead of throwing "initTexture() called before the backend is initialized".
- Docs: COMMANDS.md says where each kind of library entry lands; the `modular-building` README says what `examples pull` copies and that the demo page stays in the engine repository.
- `threedog capture` works on WebGPU games: it hooks the draws of WebGPURenderer, prints the renderer it measured, skips Spector on real WebGPU and says so, and fails on a frame with no draws. It now prefers the hardware GPU.
- `threedog stress` measures the game: from a game folder or with `-w` the load goes on top of the game's scene on its own renderer. A WebGPU game without real WebGPU is refused. The neutral page stays for the engine repo and is named as such.
- `engine.inspect.perf()` says "nothing measured yet" before any draw is counted: new field `measured`, `ok` is false, no tick on frame metrics.
- `threedog bake light` traces rays through a BVH instead of a probe grid: sky no longer leaks into rooms through walls, and pillars shade the floor. `--spacing` is gone, `--samples` now means rays per texel (default 128). The sky now matches the strength of the hemisphere light it stands for, so bake again and compare. A map with no light fails and writes nothing; a failed shader is printed.
- `threedog tune write` merges into the earlier block instead of replacing it; the block passes `threedog types`; `tune` takes `-w`; with no file it names the values that need one.
- Docs: tuning without a mouse (COMMANDS), turning the ambient off after a bake and the `?bake=1` flag (recipe 34).

- Input: pressing the interact key with nothing to use is no longer silent. The press lands in the op history as a refused `interaction.use` (`inputLocked` with the context holding the input, or `nothingNear`), and `threedog test` prints it, the input lock and the open dialogue under a failed spec. `describe().ui.dialogue.advance` names the keys that advance a dialogue.
- `threedog init`: leaves a game that passes its first `threedog check` (it writes GAMEMAP.md; the extra `map` step is gone from the READMEs and recipe 01); a package already in `devDependencies` is not also added to `dependencies`; files the template layers wrote are no longer reported as "existing files kept".
- `threedog check -w <game>` reads that game alone: tsc and R18 no longer go through every game, example, spec and engine doc only to throw the results away, the generated-doc checks of the engine stay in the root check, and the other parts run beside the rules instead of after them. The line that counted other workspaces' type errors is gone with it.
- Characters and NPCs take `model: [name, ...args]` like props (it crashed inside `Object3D.add` and `check` could not see it); arguments on a file or async model stop with `character-option`. The open-world template declares `home` in `content/places.js`, so `{ place: 'home' }` passes `check`. `art board` and `lib` run in a repository root stop and ask for `-w <game>`. Recipe 02 says `humanoid` is your own asset, and the game template says how to set `locale`.
- Editor (dev server only, F2): first version done. Edit the selected entry's properties from its field table, add an entry from the game's templates and named models, delete one, undo and redo (Ctrl+Z, Ctrl+Y; the file comes back byte for byte, a hand edit in between refuses it). Moves now cover height and rotation, the real model follows the drag, and `static: false` entries, physics bodies, grid items (`cell`) and NPCs (`start`) can be picked and moved. `threedog content` write-back gained `unset` and `restore` in `contentWrite` for this; the CLI is unchanged.
- `engine.applyState` resolves to `{ ok, refused: [{ key, value, reason }] }`: a weather name the game lacks or a key no module handles is reported, not dropped. A module hook refuses with `{ refused: { key: reason } }` and lists its keys in `stateKeys`. `fresh: 1` now means yes; a `fresh`, `wait` or `pos` value it cannot read throws `state-value`.
- `describe()` has `vars` (story flags and counters) and `world.changed` / `world.removed` (what play changed, capped at 50 with the rest counted), so a snapshot and `expectDescribe` see them. Snapshots drop `picture.writers` (frame counters), compare story counters exactly, and an `--only` path found nowhere fails instead of matching nothing.
- A bad position is refused, not an engine error: `thing.set` answers `badPosition` in `can`, and an op whose argument is that position fails with that code, so gameplay no longer freezes on it. A NaN an op worked out itself is still an engine error, where it happened.
- Bridge commands report what took effect: `state` fails with the reason and exit 1, `step` and `hold` say how many seconds really passed and fail when short, `press` fails when the engine stopped, scenarios stop on a refused state or a stopped engine. `op` refuses a value that does not fit its shape, and accepts `position=3,0,4` for an untyped argument. `press` and `op` print a `Changed:` line.
- Bridge output: every cut says so and how to see the rest; `ops` no longer prints `[object Object]`; `log()` shows in `js` checks scripts and when a script throws; `status` counts only errors since `threedog reload`; `catalog --find` searches the library and says when nothing is found; `threedog --help` and `<bridge command> --help` exit 0.
- A page that died at start answers in seconds, not over 100: the wait counts errors from before the command, and the bridge's headless page records them from its first line.
- `new-game --open-world` games start with `presets.weather.temperate`, so `state weather=rain` works in them.
- `threedog how`: searches the api pages and every docs line, not only the AI.md rows and recipe headings; handles word forms (`pixelate`, `arrangement`); orders GLSL or TSL answers by the game's renderer (from `main.js`); says "the docs never use" a word only after a search of every docs line.
- Calls that did nothing and said nothing now warn or leave a record, none is refused: container start items that do not fit (warn, names the container), `quests.start` on a done quest (warn), a swarm spawned before the first new game or load and cleared by it (warn), `music.stinger` with audio not running (the `music:stinger` event still fires, with `played: false`; it also gets `played: true` when it sounded).
- Settings: `settings.reset(key?)` puts one value (or all) back to the engine's or the game's default; `resetBindings()` still does keys.
- Docs: `readParams` throws on a wrong type in every build (only an unknown key is dev-only); `heightScale` wording; recipe 11 sample car drives 20 m in 3 s; swarm in the new game's CLAUDE.md and GAMEMAP "Not used yet".

- Assets: manifest entries whose `fallback` names loop back (a to b to a) now fail once with `asset-fallback-cycle` naming the chain, instead of waiting on each other forever.
- Sky: removed the options `moonSize`, `starScale`, `gradientCurve`, `orbitTilt`, `orbitSway`. They only set the start value of a uniform or field that stays writable (`engine.uniforms.uMoonSize` etc.), so the engine keeps one entry, not two; using one throws `sky-option` naming the entry. Notes in `docs/MIGRATING-0.8.md`.
- `engine.remove` keeps a geometry or material another object in the scene still uses, and disposes it with its last user. `stream.add`'s default unload goes through it, so unloading one block no longer makes the renderer rebuild every block that shares its models. Code that relied on `remove` disposing a shared geometry at once should dispose it itself. On WebGPU the records of loaded objects now stay until those objects leave the scene, so peak GPU memory is higher (about 110 MB in the city stress run) and levels off.
- Batching: its per-frame check is bounded in meshes instead of roots, and batched originals stay out of three's walks during the engine's draw (`describe().threePatches`: `batching-draw-walk`). A district of streamed blocks went from about 60-70 ms to about 22 ms a frame.
- API lock for 1.0: `docs/api-surface.txt` lists every public name with its signature (engine repository only). `threedog check` rule R55 fails when the surface differs from it; a removed or retyped name also needs a line naming it under this heading. `threedog api-count --lock` rewrites the snapshot. The old `api count` total guard is gone (the snapshot covers it).

## 0.7.1 (2026-11-05)

Never on npm: it reaches users inside 0.8.0. Bug fixes for asset lifetime, WebGPU memory and `assets optimize`, plus new optional tools; nothing public was removed. Upgrade notes are in `docs/MIGRATING-0.8.md`.

- Asset lifetime: a load now owns its data. Copies of a model that fell back count on the entry that really has the data, so `assets.trim()` and `release` no longer free what those copies use, and `modelNow` works for such a name. `users('shrub')` is the copies asked for by that name; `users('rock')`, the name it fell back to, counts them too. When the fallback's data is freed, the name loads again on its next use.
- A load ended while it runs (`release`, `trim`, a palette write, a name registered again, `dispose`) is freed when it arrives and never written back; a download is aborted, and a font never reaches `document.fonts`. Code awaiting it: after `release` and the like it gets a fresh load, never freed data; after `dispose` the promise stays pending for good, and so does any later `model()` / `texture()` / `font()`, so nothing rejects during teardown or resumes against a dead engine.
- A palette write no longer leaves a generated model's old build behind: it is freed with its last copy, or at once with none. Registering a name again does the same. Generated textures and internal `cached()` builds stay as they were, because nothing counts who uses them.
- Recipe 18 §4b follows one object from creation to removal and says who owns what at each step.
- New `--json` on `threedog check` and `threedog test`: one result on stdout, `{ ok, summary, items: [{ code, level, file, line, message, fix }] }` (fields only when known); the text goes to stderr and the exit code is unchanged. Items carry the rule id, the TS code, `content` or `test`, and the rule's fix. The MCP `check` tool reads this shape instead of parsing text.
- `new-game` and `init` write `AGENTS.md` beside `CLAUDE.md` (the same text) for tools that do not read CLAUDE.md; an existing `AGENTS.md` is kept.
- New optional module `swarm()`: many same-kind gameplay objects (bullets, enemy crowds, pickups, debris) in typed arrays, one `InstancedMesh` each. `engine.swarm({ name, capacity, geometry, material, fields })`, then `spawn`, `free`, `row`, `onStep`, `near`, `clear`, `dispose`. Stable handles, fixed-step update on a time channel, drawing smoothed between fixed steps, opt-in saves. Recipe 65. Nothing changes for a game that does not install it.
- New `engine.stepBlend`: how far the drawn frame is between two fixed steps, for drawing fixed-step state smoothly.
- New `threedog content stamp`, `content set --source` and `content capture`: copy an arrangement (`content/arrangements/<name>.js`, read by tools only) into plain entries, batch-edit every copy explicitly, and capture a named group from the running game into an arrangement. Rule R52 warns while a captured and stamped group is still named in code.
- Recipe 65 shows pure-picture bulk with TSL compute on WebGPU (plain three.js, no engine API).
- WebGPU memory: a mesh dropped while its material stayed in use kept its render record, geometry arrays and GPU buffers until the renderer died. The engine now sweeps these records every few seconds, for engine paths and plain `scene.remove` alike, so a game has nothing to do (recipe 56): a plain three.js scene dropping 60,000 meshes went from 1.1 GB of heap to a flat 200-260 MB, and a 7.8 km terrain flight from +72 MB to +25 MB, flat to 15.6 km. It reads a private three.js list; if an upgrade moves it, the sweep turns off with the warning `webgpu-records-unread`. `threePatches.off('webgpu-record-sweep')` switches it off.
- Dev warning `geometry-undisposed`: geometries nothing in the scene uses keep piling up on the renderer. The fix is `geometry.dispose()` when a mesh is gone for good.
- `threedog check` rule R53 fails on merge conflict markers committed in any tracked text file.
- `threedog assets optimize`: the optimized pack now comes last in `assets.js` (a game rewritten by the old command is moved over), so `/optimized/x.glb` wins over an original of the same name, and that override no longer prints the "replaced by manifest" warning. A cached model is no longer skipped from the problem count: `--strict` and a lower `--budget` judge it like a fresh run. `module-cycle` no longer fails with an internal TypeError when the first module in the list only waits behind a cycle.

## 0.7.0 (2026-11-05)

- Public surface audit (`threedog api-count --unused`): removed `engine.level.object` (same as `level.root`); dropped from the public types (code stays, engine-internal) `engine.triggers.action`, `engine.settings.action`, `engine.interactions.action` (copies of the module option), `engine.inventory.defs`, `engine.quests.defs` (use `inventory.item(id)` and `quests.list()`). 98 more unused names are kept on purpose, each with a reason in `packages/tools/api-count.mjs`
- Follow camera: `collision({ cameraOcclusion })` now defaults to `'both'`: meshes registered with `engine.rays.addStatic(mesh, { occluder: true })` stop the arm without a gameplay collider (a crown, an eave). Level buildings count too; `'colliders'` keeps the old test.
- `character.placeAt` over a registered support stands on it; `mover: 'manual'` runs the `states` hook. Recipe 57 "Moved by script" (ride, lift, ladder), recipe 32 says what a support needs.
- Script runs: `?fresh` / `applyState({ fresh })` / `threedog state fresh=1` delete the saves for a clean start; `inputLocked` carries `facts.by`; `snap --play`; `shot` and `snap` name the backend that drew the picture; `snap` timeouts say what the page was doing; a `js` script waiting on a stopped clock ends with the reason; the WebGPU fallback is one line in errors.log.
- `threedog assets optimize [--dry]`: Meshopt + KTX2 copies of art/models/ in public/optimized/, textures encoded by slot (a normal map is never compressed as color), `assets.js` pointed at the results, reruns skip unchanged files, per-file size / GPU memory / problems. `npm run assets` crashed on start (a name used twice); fixed.
- Light probes: `engine.bakeProbes` now builds three's per-pixel probe grid on both renderers, stored in half precision; `follow`, `height`, `probes.probe` and `own()` are gone, probe files are version 2 (MIGRATING-0.7.md). `describe().render.probes` reports lit objects outside the grid and light counted twice.
- Real-time light on WebGPU: `@threedog/post-effects/tsl` adds `voxelGI`, `temporalAA`, `sunShafts`, `lightVolumes`. Post effects gain `needsBuffers` (normal, diffuse, velocity merged into one scene render), `backend`, `skipOnLowTier` and `facts`; `describe().render.post` says `held` and why.
- Occlusion culling: `engine.occlusion.enabled` skips hlod cells and batched groups while hidden, on both renderers; `describe().render.occlusion`.
- Lightmaps: `threedog bake light` (system Chrome, real WebGPU) and `engine.loadLightmap(file)`; `describe().render.lightmap`.
- `celLighting` in `threedog/tsl`: colored cel bands on `MeshToonNodeMaterial`, cast shadows in the same bands. `paletteLut` in `@threedog/post-effects`: a fixed palette for `lut()`. Docs no longer say `rampTexture` colors work on three's toon: it reads only the red channel.
- New games start on WebGPU with TSL: `threedog new-game` and `init` write `import 'threedog/tsl'` and `createEngine({ renderer: 'webgpu' })`; `--webgl` starts the GLSL form instead. `--example` and `templates/example` are removed. `createEngine` called with no `renderer` still builds the WebGL renderer. With no WebGPU in the browser the game runs on three's WebGL2 backend, slower.
- `engine.hud.value(id)` reads the current value of a counter or bar. `describe().renderer` gives `requested`, `backend`, `reason`, and `gpu`, `tsl`, `glsl`, `compute` (what that backend can run).
- `threedog/layers` exports `RESERVED_LAYERS`, the one table of the three.js layers the engine keeps (26 to 29 and 31); a game's own layers are 1 to 25.
- `threedog js --wait <seconds>`: a script waiting on the game clock on a page nobody steps ends with the reason instead of a silent timeout.

## 0.6.0 (2026-11-04)

- Fixed: on WebGPU, cascades on a light whose `target` has a parent took the target's local position, so shadows fell another way than the light shone; they use its world position now, as WebGL does.
- Breaking: `grids.preview({ look })` is `{ draw }` and a layer's `tiles: { look }` is `tiles: { color }`; an unknown `tiles` key now throws.
- New: picture parts. `PICTURE_SLOTS` and the type `PictureSlot` name the picture values only one writer may hold (sky, fog, tone, environment, background, sun); `describe('picture').picture.slots` shows the holders; `engine.unuse(name)` removes a module. On the dev server a write to a value another part holds warns `picture-held`, and a removed picture part's leftovers warn `picture-leftover` (recipes/62-picture-code.md 3e).
- Fixed: the sky dome stayed in the scene after `engine.use(mySky(), { replaces: 'sky' })`.
- Breaking: `look` no longer names picture things. The game folder is `picture/` and `createPicture(engine)`, gameplay calls `picture.lamp(id)`; the module type is `'picture'`; the drawing parts are `terrainDraw`, `vegetationDraw`, `weatherDraw` with slots `terrain-draw`, `vegetation-draw`.
- Breaking: the look check is the picture check: `--no-picture`, `picture` and `pictureMs` in `shot --json`, the `Picture intent:` line in DESIGN.md, `lib add --kind picture`, `@threedog/tools/picture-check`. Seven recipes and the `plain-picture` example are renamed.
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
