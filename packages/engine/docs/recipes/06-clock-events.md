# Scheduling events on the game clock

## The time table (the single source; other docs link here)
Two fixed names: **fixed seconds** (fixed-step seconds: the `dt` of `onFixed` / module `fixed` / `world.simulate`, the N of `engine.step(N)`, `engine.elapsed`; never multiplied by the time scale) and **game seconds** (`engine.clock.now` = fixed seconds x `clock.timeScale`). "Game time" is not a unit: always say one of the two. A third ruler, **sky time of day** (`engine.sky.timeOfDay`, 0-1), is derived from game seconds: one day = `sky.dayLength` game seconds. **Frame seconds** (the `dt` of `onFrame` / module `frame`) are for presentation only.

| Use it for | Time to use | Paused / frozen | `timeScale = 2` (one real second at 60 Hz) |
|---|---|---|---|
| Movement, camera follow, physics (Rapier), AI steering | fixed seconds (`dt` in `onFixed` / `fixed`) | stops | unchanged: speed in m/s stays the same |
| Action judgement and action timelines (hit windows, invulnerability, "finish the swing"), cooldowns, hit-stop | fixed seconds: accumulate `dt` in `onFixed`, or a per-entity fixed-step counter | stops | unchanged: a 0.6 s swing is still 0.6 s |
| `world.simulate` near / far, dialogue typing, cutscenes, `engine.step(N)` | fixed seconds | stops | unchanged |
| Crop / entity growth, vegetation and pickup respawn, "ripe after 10 minutes" | game seconds (`clock.now`, `clock.after / every`; saved) | stops | twice as fast: growth that needs 600 game seconds is ripe after 300 fixed seconds |
| Calendar, day, season, clock hours, lamps and shop doors (`sky.at / between / daily / onSeason`) | sky time of day (derived from game seconds) | stops | twice as fast: with `dayLength = 360` one sky hour (15 game seconds) passes in 7.5 fixed seconds |
| UI animation and effects that follow the game (bobbing, sway) | `engine.elapsed` (fixed seconds) | stops | unchanged |
| Menu / HUD animation that must keep running while paused | frame seconds (`onFrame` `dt`) | keeps running | unchanged |
| Toast and loading fade-out, music volume fades | real time (they never affect gameplay) | keeps running | unchanged |
| `saves.autosave(minutes)` | fixed seconds of play (only while a playthrough runs: not on the title screen, not during newGame / load) | stops | unchanged |

Rules that follow: gameplay timing is in fixed seconds unless it is a thing the world does by itself over days (growth, respawn, calendar), which is in game seconds. At `timeScale = 0` game seconds stop (no `clock.after` fires, crops stop), but movement and cooldowns still run; a game that freezes the sky time of day (e.g. `clock.timeScale = 0`) must not use `clock.after` for gameplay delays. Conversion: 1 sky hour = `dayLength / 24` game seconds, 1 sky minute = `dayLength / 1440` game seconds (default `dayLength = 360`: 1 sky hour = 15 game seconds). With `timeScale = 10`, `step(10)` advances 100 game seconds = 6.7 sky hours. The docs say "game seconds" and "N sky hours/minutes", never "game minutes".
Neither fixed seconds nor `engine.elapsed` is saved; to keep a cooldown across a save, store it in a world record. Don't use `setTimeout` / `setInterval` / `performance.now()` (they ignore pause, are not saved, and can't be tested with fast-forward). The engine itself runs on the fixed step except the real-time items in the last table row.
"After how long / every how long" uses `engine.clock` (part of the core); "at what time every day / within a time window / when the season changes" uses `engine.sky` (needs the `sky()` module).

## 1. Where to write it
Game logic goes in `games/<game>/main.js` (or the game's own module); a one-off story timer can also be started by a dialogue / quest effect and then call `after` in code.

```js
import { parseClock, formatClock } from 'threedog';

// Time-window switch: lamps on from 18:00 to 06:00 (crosses midnight). On registration, at start, after loading a save, applyState, or turning the time back, it aligns to the current time immediately (returns a handle; lampHours.remove() cancels)
const lampHours = engine.sky.between('18:00', '06:00', { on: () => lamp.visible = true, off: () => lamp.visible = false });

// An event when a clock time is crossed (an "action" once per day): open the market at 12:00
engine.sky.at('12:00', day => market.open(), { days: [1, 3, 5] });   // only on days 1, 3, 5; a function also works: day => day % 7 === 6

// After how long: pass an event name to make it saveable (still fires after loading a save); a function cannot be saved
engine.clock.after(120, 'bread:ready', { oven: 1 });
engine.events.on('bread:ready', ({ oven }) => engine.inventory?.add('bread', 1));

engine.clock.every(30, () => spawnBird());                           // every 30 game seconds (not 30 sky seconds)
engine.sky.daily(day => console.log('day', day));              // every day at 00:00
engine.sky.onSeason('winter', () => engine.weather?.set('snow', 20));

// Clock conversion: 'HH:MM' <-> fraction of a day 0-1
engine.sky.timeOfDay = parseClock('17:30');                               // jump straight to 17:30 (see the catch-up rules below)
formatClock(engine.sky.timeOfDay);                                        // '17:30'
```
**Use between for states, at for actions.** "The lamp is on, the shop is open, the NPC is home" are states, so use `between`: it checks the current time every step, and no way of jumping the time can leave the state wrong.
`at` is an event for "crossing a clock time", with these catch-up rules:
- It fires only when time moves **forward** across the time: walking naturally, `step` fast-forward, or setting `sky.timeOfDay` later (17:00 -> 19:00 on the same day). When several trigger points are crossed at once, `catchUp` decides: `'once'` fires once (default), `'all'` fires them all, `'skip'` fires none.
- Turning time **back** does not fire; it only resets the baseline: `applyState({ time })` to an earlier time, or lowering `sky.timeOfDay` (19:00 -> 05:50 is going back within the same day, not "a night passed").
- Loading a save does not fire; it only resets the baseline (trigger points between the save and the load are not made up).
So "applyState to 05:50, then wait until 06:00" fires the 06:00 `at`, but after "applyState back to 17:50" the lamp will not switch itself off: use `between` for states like a lamp.
Length of a day: `openWorld({ dayLength: 600 })` / `sky({ dayLength })` (game seconds); `engine.clock.timeScale` speeds things up temporarily (see the table above).
For "which time" or "has this been done" in a story, use `engine.vars.bump / setFlag`; don't keep your own variables (vars are saved automatically).

## 2. Skipping time (sleep until morning, wait an hour)
`engine.skip` moves game seconds and the sky clock forward without running every fixed step, so even a game with a real-length day can sleep through the night instantly.
```js
await engine.skip({ to: '06:00' });                          // until the sky clock next reads 06:00 (at 06:00 exactly: a full day)
engine.skip({ seconds: 600 });                               // 600 game seconds
await engine.skip({ to: '06:00', fade: 0.6, save: 'auto' }); // fade out, jump, save, fade in (through flow.transition when flow is installed)
engine.events.on('time:skip', ({ seconds }) => engine.vars.bump('restSeconds', seconds));   // after the jump
```
What catches up, and how:
- `clock.after / every`, `sky.at / daily / between`, `day:new`, `season:change` fire **in time order, once per crossing, as if stepped** (a 3-day sleep fires `daily` 3 times; `catchUp` does not apply). Inside a callback `clock.now` and `sky.timeOfDay` already read the callback's own moment.
- World records with `far` catch up the whole span in **one** `far(rec, dt)` at the end (dt in fixed seconds = game seconds / `timeScale`), near ones included; kinds with only `near` are not made up. Growth and respawns measured with `clock.now` (entities, pickups, vegetation, the crop example in recipe 18) are exact; a far function that accumulates dt matches stepping within one far turn (`world.farEvery`); schedule NPCs end at the same place within one far turn of walking.
- Not run while skipping: `onFixed`, module `fixed` hooks, physics, near simulation. Fixed seconds (`engine.elapsed`, `engine.tick`, cooldowns) do not move. So anything that must advance during a sleep is measured in game seconds (`clock.now`) or lives in a world record with `far`.
- Input is locked and gameplay frozen for the whole skip (keys pressed during the fade do nothing). With `fade: 0` (default) the time has moved when `skip` returns; with a fade the Promise resolves after the fade in, which needs frames (in a paused test keep calling `engine.step`).
- `timeScale = 0` skips as if at 1x. The jump itself is the op `time.skip { seconds }` (logged and replayable; it refuses `seconds <= 0`).
- A module that keeps its own time implements the hook `skip(dt, e, done)` (called once per segment; `done` on the last one).

## 3. Verify
- Without waiting real time: in a test or the console, `engine.sky.timeOfDay = parseClock('17:59'); engine.step(5)`, then look at the result (`step` returns the describe).
  Time-window switch: after `await engine.applyState({ time: '17:50' })` read the state immediately (between has already aligned), then `engine.step(...)` across the boundary.
  The length of a day is `describe().time.dayLength` (game seconds); with `timeScale` 1, `step(1 sky minute)` = `step(dayLength / 1440)`; if the time scale is not 1, divide by `timeScale` as well.
- Reproduce a scenario: `npm run shot -- / --time 17:58 --wait 10 --describe-only`, then look at the time (18:0x) and your effect (lamps, NPCs, items).
- After `npm run map`, the "timed events" section of GAMEMAP.md lists every `sky.at/between/daily/onSeason` and `clock.after/every`.
- Related tests: `npm test -- 游戏时钟 SKIP`.
