# Performance investigation (F3, budget, profile, describe().perf)

Order: first use numbers to decide which category is over (frame rate? draw calls? CPU? startup?), then find who takes the most, and after changing, compare before/after with the same method.
Note: cloud tests use software rendering (SwiftShader), so the numbers are for **relative comparison** only; for real-device results ask the user to press F3 in the browser. Measurement method and reference data are in `../PERF.md`.

## 1. Where things stand
- **F3 panel** (`debug()` module, included in openWorld, collapsed by default, press F3 to open): frame rate, CPU ms/frame, draw calls, triangles, chunks visible/loaded, vegetation instances, chunk upload ms, pending generation, time of day;
  with a budget set it also shows over-limit items and startup time; the "20-second stress test" makes the player run forward fast automatically and reports the average frame rate and the worst frame at the end.
- **Text**: `engine.describe().perf` = `{ fps, cpuMs, drawCalls, triangles, pixelRatio, budget, startup, stream, jobs, chunks? }`;
  the perf line of `npm run shot -- / --describe-only` (in headless mode fps/cpu are `-`; look at draw calls and triangles).
- **Startup**: `engine.startup` = `{ totalMs, startMs, preloadMs, streamMs, modules: { name: { init, ready } } }`; `npm test` also prints a startup line (with the slowest module) for each item.

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
`onFrame/onFixed` callbacks are not in the module timings; if you suspect them, temporarily turn them into a small module (see `14-custom-module.md`) and they get timed.

## 4. Common fixes
| Symptom | Fix |
|---|---|
| Many draw calls | Use `vegetation` / InstancedMesh for repeated objects; install `hlod()` for a block of buildings; share geometry and materials between copies of a model (`assets.model` shares by default) |
| Expensive shadows | Style pack `sky.shadow.updateEvery: 3` (update every 3 frames), reduce `mapSize`/`extent`; `vegetation.setShadowRing(name, 1)` stops far vegetation casting shadows |
| Stutter while walking | Put generation work in `engine.jobs.add(function* () { ...; yield; })` or `engine.stream.add`; chunk upload budget `engine.terrain.applyBudgetMs` |
| Slow start | Look at which is slowest in `engine.startup.modules`; `npm run bake` for large models; preload only the necessary assets |
| Slow physics | Keep dynamic rigid bodies within a few hundred (the `rigidBodies` budget); `rigid({ terrainRing: 1 })` |
| Too much loaded at once | Each `engine.load` source loads its own surroundings: remove sources you no longer need, give a far camera `physics: false` and a `radius`, use `detail: 'simple'` for a distant view (recipe 18 section 10) |

**Main thread busy with simulation or pure computation: use workers.** `createEngine({ threads: 'auto' | n | false })`, default 'auto';
false = all on the main thread, same results.
- Many far records: `world.simulate(kind, { far, worker: true })` (recipe 18 section 7).
- Many paths per step (NPC crowds, AI squads): `engine.characters.findPathAsync(from, to, done)` (recipe 12 section 4); built-in NPCs already use it.
- Your own worker script: `engine.threads.lane({ create: () => new Worker(new URL('./w.js', import.meta.url), { type: 'module' }), local: makeHandler })`;
  the worker file is `serve(makeHandler())` from `threedog/worker`. Results that change gameplay go through `engine.commits`.

**Two worker rules** (full text and examples in `../CONVENTIONS.md`, "Worker limits"):
- `engine.commits`: when the due tick comes and the worker has not replied, the main thread runs your `fallback()` and applies that (a later reply is ignored). The engine does not clear pending requests on save load or level change, so give every request a `valid()` that checks identity (generation counter, record still exists, same zone) or call `t.cancel()`.
- `engine.threads.pure(fn)` / `world.simulate(..., { worker: true })`: the function is recompiled from its source, so it cannot capture outside variables or imports; put constants inside it. A bad outside variable is reported by name on the first call.

## 5. Verify (once before and once after, under the same conditions)
- `npm run perf` (native vs engine vs per-module cost of openWorld), compared with the tables in `../PERF.md`; differences under 10-30% are noise.
- Compare a specific scenario: `npm run shot -- / --pos x,z --time 12:00 --describe-only` to see draw calls and triangles.
- Related tests: `npm test -- 性能预算`, `npm test -- 阴影`, `npm test -- 启动耗时`. Attach the before/after numbers when reporting.
