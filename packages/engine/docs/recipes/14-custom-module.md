# Custom module

When to write a module: a "mechanic" that has its own state, per-frame logic and saving (stamina, a heat meter, wave spawning, oxygen, a combo
counter). The contracts every module should follow (state, game time, skip, describe, ops) and a second copyable module are in
`49-game-module-contract.md`; this page is the template and the hook cheat sheet. A module is a file of your game (next to `main.js`, or in `plugins/`);
keep art and text out of its code (style values, `i18n`) so it can go to another game through your asset library (`threedog lib add`).

## 1. Template (example: stamina, in the game as `stamina.js`)
```js
// Stamina: running drains it, standing recovers it; at 0 you can't run. engine.stamina.value is 0..max
import { readParams } from 'threedog';

export function stamina(opts = {}) {
  const PARAMS = { max: { type: 'number', default: 100 }, drain: { type: 'number', default: 20 }, regen: { type: 'number', default: 10 } };
  const { max, drain, regen } = readParams('stamina', PARAMS, opts);   // a misspelled option throws in dev with the fix; put PARAMS on the module as params to show it in engine.catalog()
  let e = null, ctx = null, tired = null, shown = -1;
  const api = {
    value: max, max,
    /** Eating restores stamina */
    restore(n) { api.value = Math.min(max, api.value + n); },
  };
  return {
    name: 'stamina', type: 'rules', label: 'Stamina', requires: ['characters'], optional: ['hud'], stage: 'gameplay',   // once installed, engine.stamina === api
    install(engine, c) {
      e = engine; ctx = c;                                       // what the module adds through ctx leaves with it (uninstall, replaces, a rolled-back use)
      e.i18n.add({ 'zh-CN': { 'stamina.label': '体力' }, en: { 'stamina.label': 'Stamina' } });   // don't hard-code UI text
      e.saves.register('stamina', { save: () => api.value, load: v => { if (typeof v === 'number') api.value = v; } });
      return api;
    },
    fixed(dt) {                                                  // timing and value changes go in fixed (60 Hz, doesn't run while paused)
      const p = e.player; if (!p) return;
      api.value = p.state === 'run' ? Math.max(0, api.value - drain * dt) : Math.min(max, api.value + regen * dt);
      // no stamina: run speed = walk speed. A modifier, not a write to p.runSpeed: the base stays the game's, and haste / mud entries still combine
      if (api.value <= 0 && !tired) tired = ctx.mod('move.runSpeed', { id: 'player', set: p.speed });   // owner: the module
      else if (api.value > 0 && tired) { tired.remove(); tired = null; }
    },
    frame() {                                                    // UI goes in frame; update only when the value changed (hud.bar redraws on every call)
      const v = Math.round(api.value);
      if (v !== shown) { shown = v; e.hud?.bar('stamina', { value: v, max, label: e.t('stamina.label') }); }
    },
    describe() { return { value: Math.round(api.value), max }; },   // this becomes describe().stamina
  };
}
```
Install it: `engine.use(openWorld({ camera: 'follow', ...}), stamina({ max: 80 }))` (dependencies must be installed first). Or put the file in `plugins/` with `export default stamina({ max: 80 })`: plugged with `engine.use` at start, switched off by `plugins.json` `off` (THREE.md, plugins folder).

## Type: what the module may own (required)
`type` is not when it runs (that is `stage`); it says what the module may own. Missing or unknown throws with the fix. Pick by what it changes:

| type | for | refused in dev |
|---|---|---|
| `'rules'` | game logic: save parts, ops, events; may take input, control or the camera for a while. The usual one for a game module | - |
| `'world'` | game state: records, ops, ground / collision / navigation data | drawing (rule R47: no `scene.add`, `renderer.` in its file) |
| `'picture'` | what is seen and heard: picture values, three.js objects, particles, sounds | `ops.define`, writing world records |
| `'ui'` | panels and menus: declares input actions, runs ops | `input.bind` (keys are the game's), `saves.register` (preferences are not game saves) |
| `'actor'` | characters and their control | - |
| `'net'` | multiplayer: remote characters, the transport | - |
| `'tool'` | a one-shot job that undoes itself (a photo, a bake) | - |

No subtypes: inside a type the differences are declarations (`provides`, `requires`, `ctx.mod` values, material slots, post stage, sounds).
A module that does two kinds of thing is two definitions returned together (`weather()` returns the `weather` state and the `weatherDraw` drawing part;
`engine.use(weather())` installs both). The refusal names the module, its type, what it did, why not, and the fix; copy the fix.

## 2. Hooks and order cheat sheet
- `install(e, ctx)` returns the public object; `init(e, ctx)` (may be async) prepares at start; `ctx.track(handle)` ties a listener or timer to
  the module (next bullet but four); while `isReady(e)` returns false the loading screen waits for it
  (the hook is called isReady; `ready` is always a boolean property in the engine); `afterLoad(e)` (may be async) runs after a save loaded, to rebuild
  what the loaded state needs nearby, with gameplay frozen until it resolves.
- `fixed(dt, e)` movement, timing, gameplay keys (`input.pressed` read in fixed is this step's snapshot, independent of frame rate); `frame(dt, e)`
  animation, camera, UI (it reads this frame's latest input); `afterRender(dt, e)` after rendering.
- `describe(e, ctx)`: see recipe 49 contract 4; `ctx.near(object or {x,z}, { name, kind })` reports things nearby. `skip(dt, e, done)`: recipe 49 contract 3.
- `applyState(e, p)`: called by `engine.applyState` / URL parameters; it only receives the keys `time`, `weather` and `cutscene`.
- `stage`: only when the hooks run (first -> last): `control` timeline, camera -> `ground` terrain, level -> `environment` weather, sky, water -> `gameplay`
  interactions, dialogue -> `effects` particles, objective markers -> `late` (the default) characters, physics -> `audio` music. Within
  a stage, to read another module's result for this frame, write `after: ['its-name']` (or `before`); across stages the stage always wins, so a
  `before` / `after` that contradicts it (a `control` module `after` an `audio` one) makes `engine.use` throw `module-order` naming both modules: give
  them the same stage or drop the line. `engine.use(a, b)` is all-or-nothing: if `b` fails, nothing of `a` stays installed.
- Between modules: notify with `e.events.emit('stamina:empty')` and let others `on` it; use optional dependencies as `e.hud?.` and list them in
  `optional: ['hud']` (for engine modules R16 of `npm run check` verifies this). Never import another module's files directly.
- A module the game cannot run without sets `critical: true`: if its `init` fails, `engine.start()` rejects with the module name and reason (default
  false: a failed init is reported and start goes on). A module installed after start gets no `fixed` / `frame` before its `init` finished:
  `engine.moduleStates` shows `initializing` / `running` / `failed`, and `await engine.loading.settled()` waits for it. A module whose `isReady` never
  turns true makes `start()` reject after `engine.loading.timeoutMs` (default 120 s), naming it.
- The `type` decides what an error does: in a `picture` or `ui` module (gameplay works without it) an error in a hook only switches that module off
  (`module:disabled`, listed in `engine.disabledModules`); in any other type it freezes the game in development/tests and is recorded in `engine.error`.
- Listeners and timers the module adds go through `ctx.track(...)`: `ctx.track(e.events.on('item:add', fn))`, also `onFixed` / `onFrame` /
  `clock.after` / `audio.measure` / a `makeWindow` window, anything with `remove()`. They leave with the module: when its `engine.use(...)` batch
  rolls back, when its `init` fails, and on `engine.dispose()` before its `dispose` hook (the spec `npm test -- "Lifecycle: every built-in"`
  checks every engine module). A class the module builds takes `ctx.track` as a constructor argument. DOM listeners use
  `addEventListener(type, fn, { signal: engine.signal })`, and UI elements attach to `engine.uiRoot` (not `document.body`); scene GPU memory,
  jobs and stream entries are collected by `engine.dispose()`. The `dispose(e)` hook only collects what the core can't, such as Workers, the
  physics world, WASM objects and real-time timers, and is called in reverse install order.
- A module's changes to shared values go through `ctx.mod(point, { mul: 0.8, layer: 'effect' })` (= `ctx.track(e.mod(point, { owner: ctx.name, ... }))`),
  so they leave with it too. A module that must be the only one of its kind declares `provides: ['inventory']`; others `requires: ['inventory']`
  (a capability, never a module name), and a game swaps it with `engine.use(mine(), { replaces: 'inventory' })` (`55-mods-time-wrap.md`). `engine.unuse('name')` removes a module with nothing in its place, and refuses while another still requires it. Picture slots: `62-picture-code.md` 3e:
  `engine.inventory` is then the new module's API, so the dependents keep working. A missing capability throws naming both fixes: install the
  engine's part of that name first, or your own module with `provides`.
- `engine.phase` says where the engine is: `'constructed'` -> `'loading'` (start() running: frame hooks run, fixed steps do not, so no game
  time passes while the machine loads) -> `'ready'` (the world is built; fixed steps from here) -> `'running'` (start() resolved) ->
  `'disposed'`. `engine.ready` is true in the last two live ones; `engine.step()` while loading runs frame hooks only.
- While frozen (`engine.freeze`, flow pause) `fixed` is skipped entirely and `frame` still runs: check `e.frozen` before gameplay decisions.
- Changing what a saved part looks like: `version` + `migrate` (recipe 49 contract 1). A save written by a newer build is refused (load returns false).
- Saved state the module writes joins the ops guard (experimental): `e.ops.guard('stamina.set')` in each writing method (a no-op in production builds,
  no DEV check needed), `e.ops.allow(fn)` around writes that are allowed anyway (recipe 23 section 5).
- **Per-playthrough state** is a save part: whatever changes during play and matters for what happens next (a zone's `once` / cooldown, a
  transition's progress, a hand-picked music track, a check timer, markers an effect placed) goes in `e.saves.register(...)`. The engine calls it
  on all three paths: save, load, and new game (a new game loads the state captured when `start()` finished), so there is nothing to reset by
  hand. What cannot be saved ends with its playthrough: a background result goes through `engine.commits` (a load or new game drops old ones;
  keep `e.commits.epoch` on a queued request and drop it when that changed), and an effect of a running playthrough (an open dialogue, a
  running cutscene, the music playing) stops on `ctx.track(e.events.on('session:end', ...))`. What is derived from save parts is rebuilt on
  `'session:start'` and `'save:loaded'`. A module's `describe()` should show such state: the session spec (`npm test -- Session`) compares every
  installed module's describe after two new games, and the Lifecycle spec round-trips the engine's own.
- When you only need a per-frame callback and no module structure: `const h = engine.onFrame(dt => ...)` / `engine.onFixed`, and `h.remove()` cancels it.

## 3. Extra steps when it goes into the engine
- Write the declarations and JSDoc in `index.d.ts` (or `types/*.d.ts`) of the engine package; `npm run types` checks that the exports of index.js are declared.
- Hand out a picture as `.material`, `.uniforms`, `.patches` (see `09-materials-lights-models.md` §3), put text in i18n, then `npm run map` to generate API.md + `api/` / CODEMAP.md.

## 4. Verify
- `npm run check` (hard rules + types + generated docs up to date).
- In a test: watch `stamina.value` in the describe returned by `engine.step(2)`; `engine.saves.collect().parts.stamina` shows the save content.
- Add an automated test: write one entry like those in `tests/specs/*.mjs` and run only it with `npm test -- name`.
