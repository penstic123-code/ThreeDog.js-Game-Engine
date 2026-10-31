# Custom module

When to write a module: a "mechanic" that has its own state, per-frame logic and saving, and that other games might use too (fishing, farming, stamina). Something that belongs to one game only goes in `games/<game>/`;
a general one goes in `modules/<name>/index.js` inside the engine and is exported from the engine's `index.js` (then the three hard rules apply: no hard-coded art or text, no importing another module's internal files).

## 1. Template (example: stamina, in the game folder as `games/<game>/stamina.js`)
```js
// Stamina: running drains it, standing recovers it; at 0 you can't run. engine.stamina.value is 0..max
import { checkOptions } from 'threedog';    // inside an engine module write '../../core/validate.js'

export function stamina(opts = {}) {
  checkOptions('stamina()', opts, ['max', 'drain', 'regen']);   // a misspelled option name gets a console hint with the fix
  const { max = 100, drain = 20, regen = 10 } = opts;
  let e = null, baseRun = null, shown = -1;
  const api = {
    value: max, max,
    /** Eating restores stamina */
    restore(n) { api.value = Math.min(max, api.value + n); },
  };
  return {
    name: 'stamina', label: '体力', requires: ['characters'], optional: ['hud'], stage: 'gameplay',   // once installed, engine.stamina === api
    install(engine) {
      e = engine;
      e.i18n.add({ 'zh-CN': { 'stamina.label': '体力' }, en: { 'stamina.label': 'Stamina' } });   // don't hard-code UI text
      e.saves.register('stamina', { save: () => api.value, load: v => { if (typeof v === 'number') api.value = v; } });
      return api;
    },
    fixed(dt) {                                                  // timing and value changes go in fixed (60 Hz, doesn't run while paused)
      const p = e.player; if (!p) return;
      baseRun ??= p.runSpeed;
      api.value = p.state === 'run' ? Math.max(0, api.value - drain * dt) : Math.min(max, api.value + regen * dt);
      p.runSpeed = api.value > 0 ? baseRun : p.speed;            // no stamina: walk only
    },
    frame() {                                                    // UI goes in frame; update only when the value changed (hud.bar redraws on every call)
      const v = Math.round(api.value);
      if (v !== shown) { shown = v; e.hud?.bar('stamina', { value: v, max, label: e.t('stamina.label') }); }
    },
    describe() { return { value: Math.round(api.value), max }; },   // this becomes describe().stamina
  };
}
```
Install it: `engine.use(openWorld({ camera: 'follow', ...}), stamina({ max: 80 }))` (dependencies must be installed first).

## 2. Hooks and order cheat sheet
- `install(e)` returns the public object; `init(e)` (may be async) prepares at start; while `isReady(e)` returns false the loading screen waits for it (the hook is called isReady; `ready` is always a boolean property in the engine); `afterLoad(e)` (may be async) runs after a save loaded, to rebuild what the loaded state needs nearby, with gameplay frozen until it resolves.
- `fixed(dt, e)` movement, timing, gameplay keys (`input.pressed` read in fixed is this step's snapshot, independent of frame rate); `frame(dt, e)` animation, camera, UI (it reads this frame's latest input); `afterRender(dt, e)` after rendering.
- `describe(e, ctx)`: the return value goes into `describe().<module name>`; `ctx.near(object or {x,z}, { name, kind })` reports things nearby.
- `applyState(e, p)`: called by `engine.applyState` / URL parameters; it only receives the keys `time`, `weather` and `cutscene`.
- `stage`: when the hooks run (first -> last): `control` timeline, camera -> `world` terrain, level -> `environment` weather, sky, water -> `gameplay` interactions, dialogue, entities -> `presentation` particles, objective markers -> `late` (the default) characters, physics -> `audio` music. Within a stage, to read another module's result for this frame, write `after: ['its-name']` (or `before`).
- Between modules: notify with `e.events.emit('stamina:empty')` and let others `on` it; use optional dependencies as `e.hud?.` and list them in `optional: ['hud']` (for engine modules R16 of `npm run check` verifies this). Never import another module's files directly.
- Presentation modules (gameplay works without them) set `presentation: true`: an error in their hooks only disables that module; an error in a gameplay module freezes the game in development/tests and is recorded in `engine.error`.
- Cleanup is not written by hand: events, onFixed/onFrame, clock, jobs, stream, ray registrations and scene GPU memory are collected by `engine.dispose()`. DOM listeners use `addEventListener(type, fn, { signal: engine.signal })`, and UI elements attach to `engine.uiRoot` (not `document.body`).
  The `dispose(e)` hook only collects what the core can't, such as Workers, the physics world and real-time timers, and is called in reverse install order.
- While frozen (`engine.freeze`, flow pause) `fixed` is skipped entirely and `frame` still runs: check `e.frozen` before gameplay decisions.
- Changing what a saved part looks like: raise its version and add one upgrade step per old version, e.g. `e.saves.register('stamina', { version: 2, migrate: { 1: v => ({ value: v }) }, save, load })`. `load` only ever sees the current shape; a save written by a newer build is refused (load returns false, the save is kept).
- Saved state the module writes joins the ops guard (experimental): `e.ops.guard('stamina.set')` in each writing method (a no-op in production builds, no DEV check needed), `e.ops.allow(fn)` around writes that are allowed anyway (recipe 23 section 5).
- **Per-playthrough state** (one hook for every module): state that is not a save part but belongs to the current playthrough (an open dialogue, a trigger's `inside` / `once`, markers derived from quests, a pending request) is dropped on `e.events.on('session:end', ...)`: it fires before `engine.session` newGame / load / quit replaces the state. State derived from save parts is rebuilt on `'session:start'` (newGame / load) and `'save:loaded'` (`saves.load`). Save parts themselves need nothing: the session applies the new-game state or the save. A module's `describe()` should show such state, because the session spec (`npm test -- Session`) compares every installed module's describe after two new games.
- When you only need a per-frame callback and no module structure: `const h = engine.onFrame(dt => ...)` / `engine.onFixed`, and `h.remove()` cancels it.

## 3. Extra steps when it goes into the engine
- Write the declarations and JSDoc in `index.d.ts` (or `types/*.d.ts`) of the engine package; `npm run types` checks that the exports of index.js are declared.
- Add look parameters to the style pack (see `09-style-pack.md`), put text in i18n, then `npm run map` to generate API.md + `api/` / CODEMAP.md.

## 4. Verify
- `npm run check` (hard rules + types + generated docs up to date).
- In a test: watch `stamina.value` in the describe returned by `engine.step(2)`; `engine.saves.collect().parts.stamina` shows the save content.
- Add an automated test: write one entry like those in `tests/specs/*.mjs` and run only it with `npm test -- name`.
