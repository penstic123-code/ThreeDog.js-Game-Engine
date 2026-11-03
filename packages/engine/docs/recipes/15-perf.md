# Performance investigation (F3, budget, profile, describe().perf)

Order: first use numbers to decide which category is over (frame rate? draw calls? CPU? startup?), then find who takes the most, and after changing,
compare before/after with the same method.
Which renderer measures: tests that compare pixels run on software rendering (SwiftShader; numbers only for relative comparison), the others on the GPU when headless can reach it. `threedog shot`, `perf`, `stress` and
`gallery --shots` use the hardware GPU when headless can reach it (`threedog doctor` says whether it can; `--gpu` / `--software` or
`THREEDOG_RENDER=gpu|software` force one). On a machine without one, ask the user to press F3 in the browser (bound by `createEngine({ bindings: { ...presets.bindings.debug } })`; the templates do). Method and reference data: `../PERF.md`.
- **What this machine can carry**: `threedog stress [--only lights,skinned] [--json]` ramps one load at a time (triangles, draw calls, instances, lights,
  shadow lights, shadow map size, overlapping transparency, particles, post effects, skinned characters) on a neutral scene until the frame passes 33 ms,
  and prints where 16.7 / 33 ms are crossed, with CPU and GPU ms. Turn the row for your target machine into `engine.budget` limits (section 2).
- **Guards in `npm test`**: a loose slowdown alarm (`slowdown`: a fixed scene more than 30% costlier than `tests/perf-baseline.json`) and a
  bundle ceiling (`bundle size`: the blank template's gzip JS); both name what to look at when they fail.

## 1. Where things stand
- **One report with verdicts**: `engine.inspect.perf()` / `threedog inspect perf` (MCP `inspect` target `perf`): draw calls (shadow and post passes
  included), triangles, shader programs, texture memory (estimate: three.js does not report VRAM), JS ms per frame split by phase, compile stalls (frames
  in which three.js compiled new programs during play, worst ms; `startup.compileMs`), the costliest programs, and one line per budget, `✗` with the next
  call to make. Budgets are your `engine.budget` limits, else a reference (desktop, 60 fps; a reading aid, not enforced). Plain three.js:
  `renderer.info.render`, `renderer.info.programs.length`, `renderer.info.memory`. Textures in detail: `engine.inspect.materials()` (below).
- **Which materials cost**: `engine.debug.view('shaderCost')` colors each material green -> red by its compiled program (fragment code lines + samplers,
  approximate; gray = not compiled yet); `engine.debug.view('overdraw')` shows pixels drawn many times over (bright = many layers: foliage cards, particles).
  `'off'` restores. For real GPU timings use `threedog capture` (Spector.js) or the browser's GPU profiler.
- **Other view modes and the panel**: `debug.view('triggers')` shows hidden zones; modules add their own modes (`engine.debug.defineView(name, { what, apply })`)
  and `engine.debug.viewModes()` lists every mode. `engine.debug.panel` is the F3 panel (dev builds; null without the `debug()` module).
- **F3 panel** (`debug()` module, included in openWorld, collapsed by default; the action `debugPanel` opens it, `presets.bindings.debug` binds F3): frame rate, CPU ms/frame, draw calls, triangles,
  chunks visible/loaded, vegetation instances, chunk upload ms, pending generation, time of day;
  with a budget set it also shows over-limit items and startup time; the "20-second stress test" makes the player run forward fast automatically and
  reports the average frame rate and the worst frame at the end.
- **Text**: `engine.describe().perf` =
  `{ fps, cpuMs, cpu, apply, drawCalls, triangles, pixelRatio, budget, startup, stream, batching, jobs, commits, chunks?, vegetation? }`;
  the perf line of `npm run shot -- / --describe-only` (in headless mode fps/cpu are `-`; look at draw calls and triangles).
- **CPU time of a frame**: `engine.cpuMs` is the main-thread time from input to the end of the afterRender hooks; `engine.cpuPhases` splits it into
  `fixed` (input + fixed steps), `frame` (frame hooks, stream, jobs), `render` (draw submission, upload of new objects, shader compiles) and `afterRender`.
  GPU time is not in it. With `npm run perf -- --only=stream` the stream-in numbers below are measured for you.
- **Applying background results** (`engine.budget.cost.report()`, also `describe().perf.apply` and the budget categories `applyBuildMs` ...): terrain
  chunks, vegetation, colliders and stream builds come back from workers or jobs and are paid for on the main thread, in stages: `transit` (worker round
  trip minus the worker's own compute: queueing and structured clone, an async wait, approximate), `build` (creating the three.js objects), `collider`
  (physics colliders), `upload` (extra render time of the frames that first draw new objects: GPU upload and shader compile, approximate), `stream`
  (the synchronous part of a `stream.add` build callback). Per stage: `n`, `totalMs`, `maxMs`, smoothed `frameMs`, and `bytes` (transit).
- **Startup**: `engine.startup` = `{ totalMs, startMs, preloadMs, streamMs, compileMs, modules: { name: { init, ready } } }`; `npm test` also prints a
  startup line (with the slowest module) for each item.

## 2. Set a budget (so going over reports itself)
Off by default and costs nothing. The game gives the limits in `createEngine` (only the given categories are checked):
```js
const engine = createEngine({ canvas, style, budget: { drawCalls: 250, fps: 55, low1: 30, triangles: 600000, chunkApplyMs: 3, rigidBodies: 300, startupMs: 5000 } });
// or at runtime: engine.budget.enable({ drawCalls: 200 });
const r = engine.budget.report();   // { ok, over: [{ category, value, limit, top }] }; going over also prints one console hint
```
`top` lists the biggest draw-call users grouped by an object's `userData.budgetTag`. Tag your own things to see who it is:
```js
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
| Expensive shadows | Style `sky.shadow.updateEvery: 3` (update every 3 frames), reduce `mapSize`/`extent`; filter `look.shadow.set({ type: 'basic' })` (hard edge, cheapest) / `'pcf'` (default) / `'vsm'` (softest, costliest), switch live with `engine.look.shadow.set({ type: 'vsm', radius: 3 })` (radius: pcf and vsm only; blurSamples: vsm only; a switch recompiles materials, so avoid doing it every frame); the vegetation species option `shadowRing` (default 1) sets within how many chunk rings it casts shadows; change it while playing with `engine.vegetation.setShadowRing('tree', 0)` |
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

**Two worker rules** (full text and examples in `../CONVENTIONS.md`, "Worker limits"):
- `engine.commits`: when the due tick comes and the worker has not replied, the main thread runs your `fallback()` and applies that (a later reply is
  ignored). The engine does not clear pending requests on save load or level change, so give every request a `valid()` that checks identity
  (generation counter, record still exists, same zone) or call `t.remove()`.
- `engine.threads.pure(fn)` / `world.simulate(..., { worker: true })`: the function is recompiled from its source, so it cannot capture outside
  variables or imports; put constants inside it. A bad outside variable is reported by name on the first call.

## 4b. Render scale (resolution) is never lowered silently
- Default render scale: `min(devicePixelRatio, 1.5)`; the low tier uses at least 0.75 x devicePixelRatio (a 2x laptop screen gets 1.5, not 1), never above 1.5.
- Adaptive resolution (`createEngine({ adaptiveResolution, targetFps })`, default on, floor 0.6) lowers the scale by 0.1 per second while frames cost more
  than the target allows (main-thread time, plus GPU time where the browser has the timer query; without it, a low fps that is not just the display's own
  refresh). The first 3 s after ready and frames that compile shaders are not judged, and a display or power mode locked at 30 Hz is not overload. The first
  time it lowers, dev builds warn once: `render scale X -> Y because frames cost N ms ...; turn off with adaptiveResolution: false`. It is the only thing
  lowered automatically (shadows and post are never traded first).
- `describe().render.scale`: `{ current, devicePixelRatio, upscaled, autoLowered, adaptive, floor, max }`. `upscaled: true` means current < devicePixelRatio, the picture
  is softer than the screen: if that looks wrong in a screenshot, check this before the style. Fixed quality: `pixelRatio: n` plus `adaptiveResolution: false`.

## 5. Verify (once before and once after, under the same conditions)
- `npm run perf` (native vs engine vs per-module cost of openWorld), compared with the tables in `../PERF.md`; differences under 10-30% are noise.
- Compare a specific scenario: `npm run shot -- / --pos x,z --time 12:00 --describe-only` to see draw calls and triangles.
- Related tests: `npm test -- 性能预算`, `npm test -- 阴影`, `npm test -- startup time`. Attach the before/after numbers when reporting.
