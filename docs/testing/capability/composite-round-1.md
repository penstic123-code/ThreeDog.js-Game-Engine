# Composite games, round 1

Run 2026-11-05. Four AI agents each built one whole game from a short brief, in parallel on one machine, on branches `test/composite-k02`, `k04`, `k06` and `k08`. The games stay on those branches and are not in master. Each game's own notes are copied under `feedback/` as written.

**No person played any of these games.** Every "playable" below means a script or a test drove it. Whether any of them is fun, readable or fair is unknown.

## The four games

| Game | Branch | Kind | Limit | First picture | First playable | Finished |
|---|---|---|---|---|---|---|
| Lantern Road (`td`) | `test/composite-k02` | tower defence | not stated in its notes | 12 min 40 s | 15 min | 39 min |
| Ember Road (`ow`) | `test/composite-k04` | open world with a quest chain | 60 min | 16 min 44 s | 24 min 47 s | about 51 min |
| `crystal` | `test/composite-k06` | shader-heavy boat flight | 55 min | 13 min (17 min for one that looked right) | 21 min | about 53 min |
| The Last Exposure (`ghosts`) | `test/composite-k08` | haunted house photography | 50 min | 17 min | 21 min | about 47 min |

All times are the agents' own clocks. Other agents ran on the same machine, so some steps were slowed by that.

## Proven by script, and not

| Game | Proven by script | Not proven |
|---|---|---|
| `td` | `check` clean, 26 checks in 3 items, towers placed by real mouse clicks through Playwright, a lose run | Real-time play by hand; balance (waves 1 to 3 too easy); no sound |
| `ow` | Quest chain to the end by ops and teleports, first conversation with real keys, both roads by `player.walkTo`, saves and Continue | Held keys on the road, mouse look and pointer lock, frame rate on a real display (47 fps is a headless GPU figure), weather changing over time |
| `crystal` | `check`, a scripted flight, 11 of 11 once after the step limit went to 1500 | Whether that flight test is stable (one run); frame rate on any machine; Continue restoring a save; keyboard play |
| `ghosts` | 29 of 29 on real WebGPU including a winning run, real key events for Q, C, F, one frame time (19.9 ms, headless) | Sound was never heard; right and left mouse under pointer lock; difficulty, nerve drain and film count are guesses |

## Root causes and their state

"Fixed" means changed on `fix/composite-engine` with a guard. Tool items belong to other branches and are listed so nothing is lost.

| # | Root cause | Reported by | State | Guard |
|---|---|---|---|---|
| 1 | A swarm handle grew past what a Float32 column holds, so a stored target read -1 like a dead one. Confirmed: 16 births are enough, sooner than the game's note says | `td` | Fixed at the cause: a game's own fields are Float64. Recipe 65 corrected | `swarm` spec |
| 2 | `audio.buses` had no `master`, though every other audio call treats it as a bus; `connect(undefined)` throws and a throw freezes gameplay in dev | `ghosts` | Fixed in code, so recipe 31 is now true. A wrong name warns and gives `master` | `Audio` spec |
| 3 | The pure-function scan read names out of numbers (`e9` in `1e9`, `xff` in `0xff`) | `ow` | Fixed | `core review` spec |
| 4 | `rules` must be listed in `content/index.js`; neither recipe 20 nor the `unknown content` error said so | `td` | Fixed in both. `check` passing while the page dies is the tool side, not done here | `doc facts` spec |
| 5 | Facts a game has to guess: `n.fbm`'s range, bloom's options, pool lights and walls, where the canvas is | `ow`, `crystal`, `ghosts`, `td` | Recipes 28, 52, 09, 01. No new name for the canvas: `engine.renderer.domElement` is three's own and the canvas is the game's already | `doc facts` spec |
| 6 | Recipes told WebGPU games things that are only true on WebGL: `onBeforeCompile` "on any material", a GLSL-only own sky | `crystal` | Recipes 54 and 08 corrected | none: wording only |
| 7 | Recipes sent a game to engine source and engine tests | `ow` | Recipes 02 and 04 fixed. About 20 other recipes still name engine tests with `npm test --`: open, for the docs review | `doc facts` spec, for 02 and 04 |
| 8 | `engine.describe('part')` nests the part under its name, which recipe 19 did not show | `ghosts` | Recipe 19 corrected | none: wording only |

### Claim that did not reproduce

`vegetation.define` before `content.load` "loses every species" (`ow`). Run on the game itself with `plantForests` moved: directly before `content.load`, and directly after `createPicture` (also across a fresh new game), all five species stayed in `vegetation.list()`. Moved before `engine.use` it throws a clear error. Nothing in the engine empties the species table, and the vegetation code is the same on `test/composite-k04`. So the reported cause is not the one: what emptied the list is unknown. The same agent had lost files while retyping them after a refused shell command (its item 1), which may be related, but that is a guess.

What was done: the `vegetation ground` spec now pins the order, and recipe 36 says `define` works at any time after `engine.use`. It also records one real quiet spot: a species named by a model appears when its promise settles, so `list()` right after that call does not show it.

### Looked at, no change

- A refused op shows the player nothing (`ow`): by design, and recipe 23 says to show it through i18n.
- `engine.onRender(fn)` gives `ctx`, not `dt` (`ghosts`): documented, and the agent found it there.
- `applyState({ pos })` goes through walls (`ghosts`): a test tool, working as asked.
- No "keep away from this line" in vegetation (`ow`): `densityMap` already does it, now said in recipe 36.
- No rooms in the light pool (`ghosts`): the game knows its rooms, and a rule in the engine would make games alike. Recipe 09 gives the ways out.

### Belongs to other work

- Tools: `check` on kinds with no `load` and on plain data under `content/`, `check` on `setFlag` and on TSL types, `threedog state` dropping `pos`, `perf -w`, `perf` on a paused page, `shot --view`, posing a GPU shot, `how` for reverb and dark rooms, the picture check's stripes, light count and "no detail" wording, `GAMEMAP.md` printing `[object Object]`, the `describe ui.dialogue` message, the test timeout that hides a move to software rendering, the template's `STATUS.md` and commands.
- `api/calendar.md` against `openWorld({ time })`: with the work on time.
