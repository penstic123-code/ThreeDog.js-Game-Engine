# Writing a game system module (a smelter, a recharging turret, growing crops) that plugs into the engine's contracts

A game system is a module (`{ name, install, ... }`) given to `engine.use(...)`. If it follows the five contracts below it saves, loads, skips time,
shows in `describe()` and the dev bridge, and can be driven by ops, without special cases. Read recipe 14 (template, hook cheat sheet), 06 (clock, skip), 18 (world records), 23 (ops).

## The five contracts
1. **State.** Prefer world records (`engine.world.add({ kind, ... })`, recipe 18): saved, streamed and far-simulated for you. State that is not a
   record (a counter, a machine's queue) goes in `engine.saves.register(key, { save, load, version?, migrate? })`. Raise `version` by 1 whenever the
   saved shape changes and add `migrate: { oldVersion: d => newData }`. Never keep game state only in a closure or module variable.
2. **Time, normal play.** Store *when* something happened in game seconds (`engine.clock.now`), and derive the state from `now - startedAt`. Never use
   `Date.now`, `performance.now` or `setTimeout` for game time: they ignore pause, `timeScale`, `step` and saves. If you must accumulate, do it in
   the module `fixed(dt, e)` hook (dt is fixed seconds; game seconds = dt x `clock.timeScale`).
3. **Time, skipped** (`engine.skip`, the op `time.skip`, recipe 06 section 2). `fixed` hooks, physics and near simulation do **not** run during a skip.
   A state derived from `clock.now` is exact for free. A module that accumulates in `fixed` must also implement `skip(dt, e, done)` (called once per
   segment, `done` on the last; do heavy work once when `done`), or put the logic in a world record `far(rec, dt)`, which gets one catch-up call.
4. **Observable.** Module hook `describe(e, ctx)` puts its return value in `describe().<module name>` (plain JSON; the bridge `describe <name>` and
   `describeText()` show it). A game without a module uses `engine.describe.add(name, fn)`. The name must be new (it throws on a clash).
5. **Actions are ops.** `engine.ops.define('noun.verb', { args, can, run, offers, reasons, desc })`. `can` is read-only and returns `true` or a reason
   string (a key of `reasons`); `run` changes state; `offers(e, ctx)` lists the arg sets possible right now (shown by the bridge `ops` command and
   `describe`). Call with `engine.ops.run(name, args)` -> `{ ok, value }` or `{ ok: false, code, facts, nextActions }` (read `r.code`). Never mutate state from UI code directly.

## Declaring stage and dependencies
`stage` picks where the hooks run (first to last): `control, world, environment, gameplay, presentation, late (default), audio`; `before / after`
(module names) only order modules inside one stage; a contradiction with the stage order throws. `requires: ['world']` must already be installed (throws
otherwise: put those `engine.use` calls first). `optional: { sky: 'what is lost without it' }` is a soft dependency (use `engine.sky?.`). Core never imports
modules. The module `name` must not clash with an existing engine property.

## One copyable module: something that finishes after a delay (a smelter, a turret recharge, a crop)
```js
export const jobs = () => {
  const started = new Map();                                 // id -> startedAt (game seconds)
  return {
    name: 'jobs', stage: 'gameplay', requires: [],
    install(e) {
      e.saves.register('jobs', { version: 1,                // contract 1: saved and restored
        save: () => [...started],
        load: d => { started.clear(); for (const [id, t] of d) started.set(id, t); } });
      const progress = id => Math.min(1, (e.clock.now - started.get(id)) / 120);   // contracts 2+3: derived from clock.now, so normal == skipped
      e.ops.define('job.start', { args: { id: 'string' }, desc: 'Start a job on a machine',   // contract 5
        can: (_, { id }) => (started.has(id) ? 'busy' : true),
        run: (_, { id }) => { started.set(id, e.clock.now); return id; }, reasons: { busy: 'Already running' } });
      e.ops.define('job.collect', { args: { id: 'string' }, desc: 'Collect a finished job',
        can: (_, { id }) => (!started.has(id) ? 'idle' : progress(id) < 1 ? 'notDone' : true),
        offers: () => [...started.keys()].filter(id => progress(id) >= 1).map(id => ({ id })),
        run: (_, { id }) => { started.delete(id); e.inventory.add('item', 2); return id; },
        reasons: { idle: 'Nothing running', notDone: 'Not done yet' } });
      return { progress };                                    // becomes engine.jobs
    },
    describe: e => ({ running: started.size, done: [...started.keys()].filter(id => e.jobs.progress(id) >= 1) }),   // contract 4
  };
};
```
Needs the `inventory`
module (add `requires: ['inventory']`, or drop the `inventory.add` line).

## Check "advance 10h normally == skip 10h" (bridge, no new tools)
```
npx threedog op job.start id=a ; npx threedog step 36000 ; npx threedog describe jobs     # A: normal play
npx threedog reload ; npx threedog op job.start id=a ; npx threedog op time.skip seconds=36000 ; npx threedog describe jobs   # B: skipped
npx threedog js "JSON.stringify(engine.jobs.progress('a'))"    # same number both times; compare whole state with: threedog snap-describe save|diff
```
Both runs must give equal `describe jobs` (and `describe time`); if B differs, the module accumulates in `fixed` and needs a `skip` hook or `far`.

## What the engine does NOT check for you
- That `save` really includes **all** your state, or that `load` is the inverse of `save` (an unsaved field silently resets on load).
- That your state is equal after skip versus step: it only skips the hooks it knows about. A `setTimeout`, a closure counter or a `fixed` accumulator
  is silently *not* advanced during a skip.
- That `can` is side-effect free and that `run` does not need `can` to have passed; `offers` is not checked against `can`.
- That `describe` returns everything that matters (a field left out is invisible to the AI and to snapshot diffs).
- That the stage/`before`/`after` you chose is the right one for your logic (only contradictions throw).
- Raising `version` and writing `migrate` when the saved shape changes (the engine only reports a missing step when an old save is loaded).
