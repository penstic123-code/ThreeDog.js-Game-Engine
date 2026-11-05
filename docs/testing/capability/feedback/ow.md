# Feedback: open world test (Ember Road)

Started 16:32:46. Limit 60 minutes.

| Milestone | Clock | After |
|---|---|---|
| First picture (town, player, NPC, own colors) | 16:49:30 | 16 min 44 s |
| First playable (chain finishes in a scripted run) | 16:57:33 | 24 min 47 s |
| Finished (check, tests, shots, this file) | 17:24 | about 51 min |

Roughly the first 6 minutes went on reading docs and the next 10 on writing the game, including retyping files after the sandbox refused a shell command (item 1). Other agents' tests ran on this machine at the same time, so some shots took a minute or more.

## Where I got stuck

1. **My own mistake, cost about 6 minutes.** The session's sandbox refused a long shell command with heredocs. I rewrote the files by hand and forgot `picture/lights.js` and `picture/index.js`. The game ran on the gray template picture, so windows stayed dark at night, there was no fog, and I debugged a "glow bug" that was not there. Nothing in the engine could have told me. `threedog js` on `picture.materials.update` found it.

2. **Trees missing, no message.** I called `engine.vegetation.define` before `engine.content.load`. `vegetation.list()` came back empty, no error, no warning, `check` passed, and `shot` showed bare ground. No doc I read gives this order. Moving the calls after `content.load` fixed it. The generated `main.js` has `createPicture` before `content.load`, which is the natural place to put plants, so others will hit this.

3. **`terrain({ height })` refused `1e9`.** Tool said: "it reads 'e9', which is neither its parameter nor a global". That is false: `e9` is part of a number, not a variable. I wrote `Infinity` instead. Cost 1 minute, only because the message quotes the name.

4. **Nearly the whole map was one ground type.** I assumed `n.fbm` runs from -1 to 1. No doc I found gives its range, only examples. Sampling suggests 0 to 1. Result: 'forest' almost everywhere and no water, with nothing wrong in any tool. A grid sample through `engine.groundType` showed it, and I recentered the noise.

5. **`shot --view` showed an empty sheet of color.** A named view moves the camera but the world only loads around the player, so the dusk and night shots were blank ground. The picture check said only "fog covers 58%". Adding `--pos` near the view fixed it. A view placed below the hill then gave floating trees with no hint that the camera was underground. I raised the camera.

6. **`threedog state fresh=1 play=1 pos=560,-700 time=11:00` dropped `pos`.** It printed `✓ Set` and the player stayed in town; time and weather did apply. Two separate `state` calls work.

7. **Trees standing on the road and blocking the follow camera.** The vegetation rule has no "keep away from this line". I added a `verge` ground type 13 m either side of the road. Works, but the camera can still end up behind a crown in the deep wood.

8. **A refused op says nothing to the player.** Pressing E on the beacon by day would have done nothing visible. I found no event or option for it, so `beacon.use` wraps `beacon.light` and toasts the reason.

9. **Goal line on screen.** Nothing in the table shows the current step as text; I built it from `hud.counter` and `describe({ only: ['quests'] })`, every 30 frames.

## Things that told me something false

- `pure-function` error: "reads 'e9'" (item 3).
- `threedog state`: "✓ Set" while ignoring `pos` (item 6).
- `check`: "nothing sets beaconLit" when `e.content.run({ setFlag: 'beaconLit' })` did set it. The message does say what it looks for, so I changed to `e.vars.flags.beaconLit = true`.
- `api/calendar.md` says `time` takes `'HH:MM'` or a number; through `openWorld({ time })` the type check allows only a number. The calendar page is right for `calendar()`, wrong for what a game starts with.
- `STATUS.md` from the template says "Offer three minimal versions"; `CLAUDE.md` says a clear request is built with no confirmation round. I followed CLAUDE.md.
- `GAMEMAP.md` from a new game prints `Place home: [object Object]` and `Save entries the game registers itself: ' + 'game`, the second read out of a comment in `main.js`. The game registers no such entry.
- `threedog inspect perf` on the paused headless page: `✓ cpuMs 0 ms`, `✓ lights 0 / 8`, `fps 0`, while the game has 8 lights. The ticks measure nothing there.
- `threedog describe ui.dialogue` with no conversation open says describe "has no ui.dialogue" and lists top-level keys, which reads like a wrong path.
- Recipes 02 and 04 send the reader to engine source (`modules/content/rules.js`, `npcSim.js`) and to tests a game does not have (`npm test -- 小城`). The rules list is also in `api/content.md`, which is what I used.

## What worked well

- `threedog how` found the right recipe every time.
- `check` caught five real mistakes in the first pass, and R51 named the missing key with the line to add.
- NPC schedules, dialogue, quests, pickups, saves and Continue all worked the first time they ran, from the recipes alone.
- The quest and road tests passed on their first run. `engine.step` makes a whole chain take about 30 seconds.
- `snap` says plainly when the picture came from the WebGL2 fallback.

## What does not work or was not tested

- Nobody played it. The chain test uses ops and teleports; only the first conversation was done with real keys. Both roads were walked by `player.walkTo`, not held keys.
- Mouse look and pointer lock were never exercised.
- 47 frames per second in the Blackwood is from a headless GPU run, not a real display.
- No sound, no interiors. Villagers stop outside their doors at night.
- The roads are saw-toothed from above: ground color lives on 4 m cells. `shading: 'texture'` might fix it; not tried.
- The beacon's flame is a plain cone, throws no light and is invisible from far away, so the ending's "people look north" is not shown.
- Weather changing by itself was only checked as a setting, not watched over time.
- `night.png` is dark on purpose, but the player is hard to read away from lamps.
