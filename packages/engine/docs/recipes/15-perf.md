# Performance investigation (F3, budget, profile, describe().perf)

**In this recipe**: 1. Where things stand · 2. Set a budget · 3. Whose CPU is slow · 4. Common fixes · 4a. Less detail far away · 4b. Render scale · 5. Verify

Order: first use numbers to decide which category is over (frame rate? draw calls? CPU? startup?), then find who takes the most, and after changing,
compare before/after with the same method.
Which renderer measures: `threedog shot`, `perf`, `stress` and `gallery --shots` use the hardware GPU when headless can reach it (`threedog doctor` says whether it can; COMMANDS.md, `--gpu`). On a machine without one, ask the user to press F3 in the browser (bound by `createEngine({ bindings: { ...presets.bindings.debug } })`; the open-world template does).
What this machine can carry: `threedog stress` (COMMANDS.md) prints where 16.7 / 33 ms are crossed for each kind of load. Turn the row for your target machine into `engine.budget` limits (section 2).

## 1. Where things stand
- **One report with verdicts**: `engine.inspect.perf()` / `threedog inspect perf` (MCP `inspect` target `perf`): draw calls (shadow and post passes
  included), triangles, shader programs, texture memory (estimate: three.js does not report VRAM), JS ms per frame split by phase, compile stalls (frames
  in which three.js compiled new programs during play, worst ms; `startup.compileMs`), the costliest programs, and one line per budget, `✗` with the next
  call to make. Budgets are your `engine.budget` limits, else a reference (desktop, 60 fps; a reading aid, not enforced). Plain three.js:
  `renderer.info.render`, `renderer.info.programs.length`, `renderer.info.memory`. Textures in detail: `engine.inspect.materials()` (below).
- **Which materials cost**: `engine.debug.view('shaderCost')` colors each material green -> red by its compiled program (fragment code lines + samplers,
  approximate; gray = not compiled yet); `engine.debug.view('overdraw')` shows pixels drawn many times over (bright = many layers: foliage cards, particles).
  `'off'` restores. For real GPU timings use `threedog capture` (Spector.js) or the browser's GPU profiler.
- **Other view modes and the panel**: `debug.view('triggers')` shows hidden zones (`triggers({ debugColor, debugOpacity })` colors them); modules add their own modes (`engine.debug.defineView(name, { what, apply })`)
  and `engine.debug.viewModes()` lists every mode. `engine.debug.panel` is the F3 panel (dev builds; null without the `debug()` module).
- **F3 panel** (`debug()` module; `openWorld` installs it in dev builds only, collapsed; the action `debugPanel` opens it, `presets.bindings.debug` binds F3): frame rate, CPU ms/frame, draw calls, triangles,
  chunks, vegetation instances, time of day; with a budget set also over-limit items and startup time.
- **Text**: `engine.describe().perf` =
  `{ fps, cpuMs, cpu, apply, drawCalls, triangles, pixelRatio, budget, startup, stream, batching, jobs, commits, chunks?, vegetation? }`;
  the perf line of `npm run shot -- / --describe-only` (in headless mode fps/cpu are `-`; look at draw calls and triangles).
- **CPU time of a frame**: `engine.inspect.perf().cpuMs` is the main-thread time from input to the end of the afterRender hooks; its `cpuPhases` splits it into
  `fixed` (input + fixed steps), `frame` (frame hooks, stream, jobs), `render` (draw submission, upload of new objects, shader compiles) and `afterRender`.
  GPU time is not in it. With `npm run perf -- --only=stream` the stream-in numbers below are measured for you.
- **Applying background results** (`engine.budget.cost.report()`, also `describe().perf.apply` and the budget categories `applyBuildMs` ...): terrain
  chunks, vegetation, colliders and stream builds come back from workers or jobs and are paid for on the main thread, in stages: `transit` (worker round
  trip minus the worker's own compute: queueing and structured clone, an async wait, approximate), `build` (creating the three.js objects), `collider`
  (physics colliders), `upload` (extra render time of the frames that first draw new objects: GPU upload and shader compile, approximate), `stream`
  (the synchronous part of a `stream.add` build callback). Per stage: `n`, `totalMs`, `maxMs`, smoothed `frameMs`, and `bytes` (transit).
- **Startup**: `engine.startup` = `{ totalMs, startMs, preloadMs, streamMs, compileMs, firstFrameMs, phases, modules: { name: { init, ready } } }`. `firstFrameMs` is page open to the first frame drawn after the loading screen, and `phases`
  splits it into parts that add up to it: `script` (page open until `createEngine`), `construct`, `setup` (game code until `start()`), `init` (saves,
  renderer, module init), `preload`, `world` (nearby builds), `compile` (shaders + hidden warm-up frame), `draw`. `inspect.perf().text` prints the line.

## 2. Set a budget (so going over reports itself)
Off by default and costs nothing. The game gives the limits in `createEngine` (only the given categories are checked):
```js
const engine = createEngine({ canvas, budget: { drawCalls: 250, fps: 55, low1: 30, triangles: 600000, chunkApplyMs: 3, rigidBodies: 300, startupMs: 5000 } });
// or at runtime: engine.budget.enable({ drawCalls: 200 });
const r = engine.budget.report();   // { ok, over: [{ category, value, limit, top }] }; going over also prints one console hint
```
`top` lists the biggest draw-call users grouped by an object's `userData.budgetTag`. Tag your own things to see who it is:
```js fragment
house.userData.budgetTag = 'houses';        // children inherit the parent's tag; untagged ones count as 'other'
engine.budget.byTag();                      // [{ tag, drawCalls, triangles }...], largest first
engine.budget.metric('fishCount', () => fish.length, { limit: 50 });   // a module's own category
```

## 3. Whose CPU is slow
```js
engine.profile(true);                       // start timing each module's fixed/frame/afterRender
// ...run for a few seconds (engine.step(3) in a test doesn't render; the real-time loop is more accurate: wait a few seconds)
engine.profile();                           // { terrain: 0.06, rigid: 0.23, ... } average milliseconds per rendered frame; cleared after reading
engine.profile(false);
```
`onFrame/onFixed` callbacks are not in the module timings; if you suspect them, temporarily turn them into a small module (see `14-custom-module.md`)
and they get timed.

## 4. Common fixes
| Symptom | Fix |
|---|---|
| Many draw calls | Use `vegetation` / InstancedMesh for repeated objects; install `hlod()` for a block of buildings; share geometry and materials between copies of a model (`assets.model` shares by default) |
| Expensive shadows | `engine.shadows.budget(light, { every: 3 })` (update every 3 frames), reduce `light.shadow.mapSize` / the box's `extent`; filter `renderer.shadowMap.type = THREE.BasicShadowMap` (hard edge, cheapest) / `THREE.PCFShadowMap` (default) / `THREE.VSMShadowMap` (softest, costliest), blur with `light.shadow.radius` (pcf and vsm only) and `.blurSamples` (vsm only); a switch recompiles materials, so avoid doing it every frame; the vegetation species option `shadowRing` (default 1) sets within how many chunk rings it casts shadows; change it while playing with `engine.vegetation.setShadowRing('tree', 0)` |
| Stutter while walking | Put generation work in `engine.jobs.add(function* () { ...; yield; })` or `engine.stream.add`; chunk upload budget `engine.terrain.applyBudgetMs` |
| Slow start | Look at which is slowest in `engine.startup.modules`; `npm run bake` for large models; preload only the necessary assets |
| Slow physics | Keep dynamic rigid bodies within a few hundred (the `rigidBodies` budget); `rigid({ terrainRing: 1 })` |
| Too much loaded at once | Each `engine.stream` source loads its own surroundings: remove sources you no longer need, give a far camera `physics: false` and a `radius`, use `detail: 'simple'` for a distant view (recipe 18 section 10) |

**Main thread busy with simulation or pure computation: use workers.** `createEngine({ threads: 'auto' | n | false })`, default 'auto';
false = all on the main thread, same results.
- Many far records: `world.simulate(kind, { far, worker: true })` (recipe 18 section 7).
- Many paths per step (NPC crowds, AI squads): `engine.characters.findPathAsync(from, to, done)` (recipe 12 section 4); built-in NPCs already use it.
- Your own worker script: `engine.threads.lane({ create: () => new Worker(new URL('./w.js', import.meta.url), { type: 'module' }), local: makeHandler })`;
  the worker file is `serve(makeHandler())` from `threedog/worker`. Results that change gameplay go through `engine.commits`.

**Two worker limits**, with examples in `../CONVENTIONS.md`, "Worker limits": `engine.commits` runs your `fallback()` when the worker is late and does not clear pending requests on a load or level change, so give each a `valid()`; `threads.pure` functions are recompiled from source and capture nothing.

## 4a. Less detail far away: which tool for which job

Four tools lower the cost of distant things, and each owns a different case. Pick by what is actually over budget: triangles or draw calls.

| You have | Use | Saves | Costs |
|---|---|---|---|
| A few heavy models (a statue, a vehicle, a tower) | `engine.assets.lod` or `lod: true` | Triangles | Each copy stays its own draw calls |
| Many copies of a light model (crates, fences) | `engine.batching`, on by default | Draw calls | Every copy keeps full triangles |
| A static level seen from far off | `engine.hlod` | Draw calls, by merging per cell | Same triangles unless a node `xxx_LOD1` exists |
| Plants by the thousand | `engine.vegetation` with `lodGeometry` | Both, per chunk ring | Plants only |

```js fragment
// 1. once: writes public/optimized/tower.lod1.glb, .lod2.glb and lists them in assets.optimized.js
// threedog assets optimize --lod            (--lod-shares 0.5,0.2 sets the triangle share of each level)
// 2. one line in the game; without it no level is ever downloaded
const tower = await engine.assets.lod('tower');                                  // distances follow the model's size
const gate = await engine.assets.lod('gate', { distances: [40, 120] });          // or your own, in meters
// content/props.js: { model: 'tower', x: 10, z: 4, collide: 'box', lod: true }  // or lod: [40, 120]; also on a template
tower.levels[1].object;   // a plain THREE.LOD: read, replace, tower.addLevel(...), tower.autoUpdate = false
```

- **Batching:** instances share one geometry, so a copy cannot change level alone. A LOD object is never batched, which means `lod` on a model placed many times can
  cost more than it saves. Compare `describe().perf` with and without it; dev warns at 32 copies.
- **What stays on the full model:** `engine.raycast`, `engine.rays`, your own `THREE.Raycaster`, `collision` and saves. A level draws with the full mesh's material, so swap
  materials on `tower.levels[0].object` and on each level.
- **Asking what is drawn:** far off the full model waits on the batch layer with `visible` true, so read `tower.getCurrentLevel()`, not `tower.levels[0].object.visible`.
- **Skipped by the tool, with the reason in its report:** skinned, morphing and animated models, and models under 1000 triangles. `assets.lod` still works on them: one level, and a
  dev warning.
- **The level follows `engine.camera`** only, so a shadow pass does not change it. `delete tower.update`, while level 0 shows, restores the plain method; far rays then miss the full model.
- **A narrow lens:** `camera.zoom` counts towards the distance, `camera.fov` does not. A sniper scope that narrows `fov` shows the far level up close, so use `zoom` or set
  `tower.autoUpdate = false` while scoped.
- **Check the last level up close once:** a low level can lose round details (a dial, a dome) that a few dozen pixels hide and a scope shows. If it shows, raise `--lod-shares` or move the distance out.
- **Popping:** levels switch at once, softened by a hysteresis of 0.1 of the distance (`hysteresis` changes it). There is no crossfade; if a switch shows, move the distance out.
- **Scale:** default distances follow a prop's `scale`. On `assets.lod` they follow the model as loaded, so give `distances` when you scale it yourself.

## 4b. Render scale (resolution) is never lowered silently
- Default render scale: `min(devicePixelRatio, 1.5)`; the low tier uses at least 0.75 x devicePixelRatio (a 2x laptop screen gets 1.5, not 1), never above 1.5.
- Adaptive resolution (`createEngine({ adaptiveResolution, targetFps })`, default on, floor 0.6) lowers the scale by 0.1 per second while frames cost more
  than the target allows (main-thread time, plus GPU time where the browser has the timer query; without it, a low fps that is not just the display's own
  refresh). The first 3 s after ready and frames that compile shaders are not judged, and a display or power mode locked at 30 Hz is not overload. The first
  time it lowers, dev builds warn once: `render scale X -> Y because frames cost N ms ...; turn off with adaptiveResolution: false`. It is the only thing
  lowered automatically (shadows and post are never traded first). `engine.setPixelRatio(p)` sets the top it climbs back to, so a ratio the game chose stays; a direct
  `renderer.setPixelRatio` stops it altogether, and so does `pixelSize` (recipe 62 section 4b).
- `describe().render.scale`: `{ current, devicePixelRatio, upscaled, pixelSize, autoLowered, adaptive, floor, max }`. `upscaled: true` means current < devicePixelRatio, the picture
  is softer than the screen: if that looks wrong in a screenshot, check this before the style. Fixed quality: `pixelRatio: n` plus `adaptiveResolution: false`.

## 5. Verify (once before and once after, under the same conditions)
- `npm run perf` (native vs engine vs per-module cost of openWorld), run before and after on the same machine; differences under 10-30% are noise.
- Compare a specific scenario: `npm run shot -- / --pos x,z --time 12:00 --describe-only` to see draw calls and triangles.
- Attach the before/after numbers when reporting.
