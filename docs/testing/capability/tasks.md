# Capability test list (0.8 acceptance)

Goal: test every engine module and every `threedog` command group, to see whether an AI can do single tasks and composite tasks. Written 2026-11-05. Not yet run.

Rules for the runner
- The AI gets only the "Prompt" column, plus the normal new-project entry (AI.md). No API names, no hints. Each task starts in a fresh workspace unless it says "continue".
- "Pass line" is judged by a script (`threedog verify`, `describe`, `eval`, exit code) or one screenshot with a stated thing to see. Time limit includes reading docs.
- Out of scope: mobile, multiplayer (engine.net, `threedog relay`, fakeNetwork, webSocket), see the end of the coverage table.
- Record each run as one line in `docs/testing/runs.md`; failures go to the engine-fix list by root cause (not one patch per row).
- Source of coverage: `threedog api-count --json` (1782 items: 156 engine members, 473 sub-object members, 346 module APIs, 54 CLI commands), `packages/engine/docs/API.md`, `COMMANDS.md`.

## 1. Single tasks

Time limit in minutes (T). Pass types: S = script, P = screenshot (name what must be visible), B = both.

### 1.1 Core objects

| id | Prompt | Pass line | T |
|---|---|---|---|
| S01 | Make an empty room with a box. Pressing the Space key should make the box jump once. Show it works without me pressing anything. | S: simulated press of the jump action moves box y above start, then back; no page errors | 8 |
| S02 | Let the player rebind the jump key to another key and keep it after reload. | S: rebind, reload, `keysOf` reports new key, old key does nothing | 8 |
| S03 | Make a counter that goes up when something happens, and a message that appears 3 seconds after the game starts. | S: counter value after N steps; message exists at 3.0 s and not at 2.9 s | 6 |
| S04 | Keep two story switches and a score; save the game; load it into a fresh page. | S: values equal after save, reload, load | 8 |
| S05 | Save and load a custom thing (a list of 5 collected items) alongside the default save. Also export the save to a file and import it back. | S: after import the list has the 5 items; wrong-format import is rejected with a readable message | 10 |
| S06 | Load a model file and a texture before the game starts, with a loading bar that finishes. Show it. | B: `threedog loading` reports done, no failures; screenshot shows model textured | 10 |
| S07 | Add background sound and a sound effect on click; lower the music while the effect plays; give the player a volume slider for music only. | S: bus volumes read back (music ducked during effect, restored after); slider changes only music | 10 |
| S08 | Show all on-screen text in two languages with a switch. | S: switching locale changes three named strings; missing key shows a visible fallback, not blank | 6 |
| S09 | Let the player click objects in the 3D scene and tell which one was hit, including objects behind others. | S: `pick`/cast at two known pixels returns the front object and (second call) the one behind | 8 |
| S10 | Build 2000 small objects over a 1 km square, but only create the ones within 80 m of the player. | S: count of live objects below 200 at start, changes after teleporting 500 m, no stall frame over 100 ms | 12 |
| S11 | Make a heavy build job (500 items) not freeze the game. | S: no frame over 50 ms while building, all items present after | 8 |
| S12 | Set a limit on how heavy the scene may become and show me a warning when it goes over. | S: budget report lists the limit; adding items past it produces the warning | 8 |
| S13 | Add a glow and a colour grade to the picture and let the player turn them off. | P: picture with and without effect differs (`picture compare` difference above a stated number); toggle works | 10 |
| S14 | Hide rooms the camera cannot see so they are not drawn. | S: draw calls drop when player stands in a closed room vs open (`inspect perf`) | 12 |
| S15 | Make the ground a hill; make a character stand on it and a ball roll down it. | S: character y equals ground height within tolerance at 3 points; ball ends lower than start | 10 |

### 1.2 Modules

| id | Prompt | Pass line | T |
|---|---|---|---|
| M01 | Make a rolling landscape from a seed. The same seed must give the same land. | B: height at 5 points equal across two runs; screenshot shows hills | 10 |
| M02 | Put trees, bushes and grass on the land, denser in some areas; let the player cut one tree down for good. | S: `instanceAt` finds a tree; after removal it is gone and stays gone after save and load | 12 |
| M03 | Make a day that lasts 4 minutes, with the sky, sun and fog changing. | P: screenshots at 06:00, 12:00, 20:00 clearly differ in sky colour (palette compare) | 10 |
| M04 | Add seasons and a daily event at 08:00. | S: skipping to 08:00 triggers the event once per day; season name changes after N days | 8 |
| M05 | Add rain and snow that change by themselves, and let me force one. | B: `state weather=rain` shows rain particles in screenshot; auto mode changes weather within 5 game minutes | 10 |
| M06 | Add a lake with moving water that reflects the sky. | P: water visible with different pixel colours on two sides of one frame; no page errors | 10 |
| M07 | Place 300 named objects in the world, find all within 20 m of a point, move one, delete one. | S: query counts match expected numbers before/after; ids stable | 8 |
| M08 | Make a 20x20 tile map where each tile has a type; paint some tiles and read them back. | S: tile read-back equals what was painted; preview image exists | 8 |
| M09 | Walls the player cannot walk through, circles and boxes, and ask whether a straight line between two points is clear. | S: walk into wall blocked at expected x; `lineClear` true/false at two known cases | 8 |
| M10 | Stack 20 crates that fall and settle; fire a ball into them. | B: after 5 s, crates below start height and at rest; ball impulse moves at least one | 12 |
| M11 | Build a four-wheeled car that drives over the ground. | B: forward input for 3 s moves car at least 10 m, car stays upright; screenshot shows wheels on ground | 15 |
| M12 | Camera options: follow, first person, fixed, top-down strategy. Switch between them with a key. | S: camera position differs per mode; switching 4 times leaves no error | 10 |
| M13 | A 10-second cutscene where the camera flies and a door opens, which the player can skip. | S: at 5 s door half open; skip jumps to final state; input locked during, returned after | 12 |
| M14 | Load a hand-built level with named start points and a goal, from a model file. | S: marker list matches names in file; player spawns at the start marker | 12 |
| M15 | Zones that fire when the player enters and leaves, one only once. | S: enter/leave counts correct over a scripted walk | 6 |
| M16 | Sparks on a hit, smoke from a chimney, and a trail on a moving object. | P: screenshot at emit time shows particles; `count` goes to zero after lifetime | 10 |
| M17 | 200 birds (or fish, cars, soldiers) moving as a flock, cheap to run. | S: all 200 alive after 30 s, frame time under a stated budget (`inspect perf`) | 12 |
| M18 | A settings screen with volume, graphics quality and key bindings, saved. | S: change value, reload, value kept; reset restores default | 10 |
| M19 | Music that changes with the situation (calm, danger), with a short sound on events. | S: music state follows a scripted situation change; stinger played once | 8 |
| M20 | A walking character the player controls, plus 3 villagers who walk to places by themselves around obstacles. | B: NPC reaches target within 30 s; player blocked by obstacle; screenshot shows 4 characters | 15 |
| M21 | Press E near an object to use it, with a prompt shown only when near. | S: prompt visible within 2 m, hidden at 4 m; press runs the action once | 6 |
| M22 | A conversation with choices that changes a story switch, and speech bubbles over heads. | S: choosing option 2 sets the switch; dialogue ends cleanly | 10 |
| M23 | A bag with limited slots and stacking, a shop that buys and sells, and a chest. | S: buy fails with a clear reason when poor/full; trade changes counts and money both ways | 12 |
| M24 | Items on the ground that can be picked up and drop back. | S: nearest pickup chosen; pickup adds to bag; drop re-creates it at player | 8 |
| M25 | A three-step quest with a failure branch and a reward. | S: scripted run completes quest; second run fails and reports why | 10 |
| M26 | Photo mode that hides the interface and saves a picture. | S: image file written; UI hidden in it (P) | 8 |
| M27 | Sounds that change with place (near water, in forest). | S: ambience state differs at two positions | 8 |
| M28 | Find a path across a map with obstacles for an NPC, and show the route. | S: path avoids blocked area, length reasonable; unreachable target returns a clear failure | 10 |
| M29 | A town of 2000 buildings that stays smooth by drawing far ones as cheap blocks. | S: whole town in view with at most 1000 draw calls and 200k triangles (`inspect perf`), set before measuring | 15 |
| M30 | A street at night with 100 lamps that all look lit but the machine copes. | P: screenshot shows lit lamps; `inspect perf` shows light count within limit | 12 |
| M31 | Describe a small village in data files (houses, props, people) rather than code, and load it. | B: `describe` lists all entries; screenshot shows them | 12 |
| M32 | A title screen, a game scene and a game-over scene with fades between. | S: flow visits the three in order; no leftover objects from previous scene | 10 |
| M33 | An on-screen objective arrow, a coin counter and a progress bar. | P: all three visible in screenshot; values update when state changes | 8 |

### 1.3 Add-on exports

| id | Prompt | Pass line | T |
|---|---|---|---|
| X01 | Use a custom shader-style effect on a surface (animated colour that responds to time and a slider), written with the engine's shader helpers. | B: two frames at different times differ in the surface region; slider changes it | 15 |
| X02 | Write a cartoon outline with the post-effects package, and a pixel-snap look as an own post pass (`engine.post.add`; the package has no pixel effect). | P: screenshot shows outline pixels around a shape (edge count above threshold) | 15 |
| X03 | Make an island from noise using the terrain-noise package, with the shape controllable by three numbers. | B: heights at fixed points change with each number; screenshot shows an island shape | 12 |
| X04 | Use five of the ready-made helpers from the main package (easing, sampling a grid, option checking, reading parameters, a toon ramp texture; the main package has no colour palette helper). | S: five calls give expected values; bad option is rejected with readable code | 8 |

### 1.4 Command groups (what the AI does with the tools)

| id | Prompt | Pass line | T |
|---|---|---|---|
| C01 | Create a new project, run the checks and type check and fix everything they report in a sample project with 3 planted mistakes. | S: `check --json` and `types` both ok; fewer than 3 fix attempts per mistake | 12 |
| C02 | Start the game for yourself, tell me whether it loaded and whether there are errors, then stop it. | S: `status` reported correctly; no dev server left running | 6 |
| C03 | Run the game for 5 game seconds with W held, tell me where the player is, then press the use key and say what happened. | S: reported position matches `describe`; step/hold/press used (no real-time sleeps) | 8 |
| C04 | Change the weather and time of day in the running game without editing code, and prove it with one picture. | B: `state` output; screenshot palette differs | 6 |
| C05 | The game throws an error somewhere (planted). Find the cause and fix it. | S: `errors` empty after fix; fix touches the planted line only | 10 |
| C06 | Find which thing is under the screen point (480,270), tell me its definition file and line, and why the shop's buy action refuses right now. | S: answer contains correct id and file:line, and the failure code | 10 |
| C07 | List what the player can do now and run one of those actions without simulating keys. | S: `ops` lists it; `op` changes state | 6 |
| C08 | Write a test that plays a scripted scenario and prints pass or fail, and show what it did and did not test. | S: `verify` PASS; output lists tested ops; planted bug makes it FAIL | 12 |
| C09 | Without editing code by hand, move a prop to x=12, add a new tree, remove a bench, and make three copies of a stall. | S: content files changed accordingly; `describe` matches; `--dry` shows diff without writing | 12 |
| C10 | Capture the arrangement of a hand-moved group in the running game into a reusable file. | S: arrangement file exists and `stamp` reproduces the same layout | 10 |
| C11 | A mesh exists but I cannot see it. Find out why. (Planted: wrong layer / zero scale.) | S: `scene` names the cause; fix makes it visible (P) | 10 |
| C12 | The game is slow. Tell me what the frame draws and which part costs most, then fix the worst one. | S: `inspect perf` before/after: draw calls or ms reduced; `capture` used | 15 |
| C13 | List all materials and textures and tell me which are too big; shrink them. | S: `inspect materials` MB total lower after | 12 |
| C14 | Check a model file for problems, then make a game-ready copy under budget. | S: `assets check --strict` fails before, passes after optimise | 10 |
| C15 | Compare a new model export against the old and tell me what is missing. | S: `assets check --against` output names the missing items | 6 |
| C16 | Reuse an art piece (a material or a model) already in the library in my game, and check it fits. | S: `lib status`/`lib check` ok; file copied; no duplicated three.js value writes | 10 |
| C17 | Add my own new reusable piece to the library with a summary. | S: `lib add` entry found by `catalog --find` | 8 |
| C18 | Pull a technique example, adapt it to my game. | S: `examples pull` files present; game runs without errors | 10 |
| C19 | Show me every art resource of the game on one page and every model in a gallery picture. | P: board and gallery open, listing at least the registered items | 8 |
| C20 | Compare the picture to a reference image and tell me in numbers what is different, then fix the largest difference. | S: `picture palette` and `picture compare` numbers improve after fix | 12 |
| C21 | Take a picture from a named camera view and compare to an earlier one. | S: `shot --view --compare` prints a pixel diff; zero for unchanged scene | 6 |
| C22 | Tune sizes and colours with the live panel, then make them permanent in code. | S: `tune write --apply` changes source; reload shows same values | 10 |
| C23 | Bake the lighting of a room so it needs no real-time lights. | B: lightmap file written; screenshot shows soft shadows with lights off | 15 |
| C24 | Skip ahead to 06:00 and also jump 10 minutes; check things that depend on time caught up. | S: calendar and a timer-driven item both show new state | 6 |
| C25 | Describe the game state, save the baseline, change something, and show what differs. | S: `snap-describe save/diff` lists exactly the changed field | 8 |
| C26 | Ask the tools what this game can do and find how to make a door that opens, in your own words. | S: `catalog` and `how` used; answer names a real recipe | 6 |
| C27 | Read the running game through the MCP interface instead of the terminal. | S: `mcp` server answers a describe call | 8 |
| C28 | Check the machine is ready for the engine; report the surface size of the API an AI meets. | S: `doctor` and `api-count --json` output summarised correctly | 5 |
| C29 | Regenerate the docs maps after adding a module and a new event. | S: `npm run map` output contains the new names; `check` ok | 8 |
| C30 | Run the stress ramps and tell me at what load the game drops below 30 fps. | S: `stress --json` numbers quoted; axis named | 12 |
| C31 | Build the game for release and serve the built version. | S: `build` ok; `preview` page loads without errors; asset sizes reported | 8 |
| C32 | Run the whole browser test suite for one game and report only failures. | S: pass/fail counts match actual run | 10 |
| C33 | Use a script file to drive the game into an end-of-game state to test it. | S: script runs via `js --file`; state reached | 8 |

## 2. Composite tasks

All 30 to 60 minutes. Same rules; the AI gets the Prompt only. Pass line has three parts: it runs with no page errors (`status`, `errors`), a scripted playthrough passes (`verify`), and a named screenshot check. "Covers" lists single rows whose abilities are used (a composite pass does not replace the single row).

| id | Prompt | Pass line | T | Covers |
|---|---|---|---|---|
| K01 | A racing game: three laps on a hilly track at dusk, an opponent car, lap times saved. | S: scripted drive finishes 3 laps, lap times persisted after reload; P: dusk sky, car on track | 50 | M01 M03 M10 M11 M12 M30 M33 S04 S07 C03 C08 |
| K02 | A tower defence on a grid: place towers, waves walk a path, money, win and lose screens. | S: scenario places 3 towers, wave 3 beaten, then a second run loses; P: grid with towers and enemies | 50 | M08 M17 M28 M16 M23 M25 M32 M33 S08 C07 C08 |
| K03 | An interior puzzle: a single room, doors, keys, a switch, a hidden item; no combat. Cosy lamp-lit style. | S: scenario solves puzzle in listed order; wrong order gives clear failure; P: warm lit room | 40 | M09 M14 M21 M22 M24 M30 M31 S13 C06 C23 |
| K04 | An open world with day and night, weather, towns far apart, forests, villagers and a three-quest chain. | S: quest chain completes after teleport; P: three times of day; frame time within budget | 60 | M01 M02 M03 M05 M06 M20 M25 M27 M29 S10 S14 C12 C30 |
| K05 | A 2D-looking game (flat shapes, sprites, side view) with jumping, coins and a boss. | S: scenario collects 10 coins, defeats boss; P: screenshot has no visible perspective depth | 45 | M09 M12 M16 M19 M33 X02 S01 S05 C20 |
| K06 | A stylised-shader game: toon water, a glowing crystal world, custom sky, the player flies a small boat. | P: three shots show shader effects (palette compare); S: boat reaches 3 buoys | 55 | X01 X02 X03 M06 M11 M13 S13 C11 C13 C21 |
| K07 | A farming and shop sim: crops grow with days and seasons, bag, sell at a market, save and load, two languages. | S: skip 3 days, harvest, sell, money correct after reload; P: market screen | 45 | M04 M23 M24 M18 M32 S04 S05 S08 C24 C25 |
| K08 | A ghost-hunting game in a dark house: flashlight, photo mode to catch ghosts, sounds that change by room. | S: photo at ghost counts it; P: dark scene readable | 45 | M14 M19 M26 M27 M30 M16 M13 S07 C11 C19 |
| K09 | A city-builder lite: place roads and buildings on land, small people move around, budget and performance kept under a limit. | S: place 100 buildings, perf under budget; P: city view | 55 | M01 M07 M08 M17 M28 M29 S11 S12 C09 C10 C14 |
| K10 | A rhythm-and-dialogue visual novel with a quest log, camera moves, tuned colours from a reference picture. | S: scripted choices reach two different endings; P: palette within tolerance of reference | 40 | M22 M25 M13 M19 M18 S02 S03 C20 C22 |
| K11 | Take any game above and ship it: assets optimised, built, previewed, docs maps and checks clean, test run recorded. | S: `build`, `preview`, `check`, `assets --strict`, `test` all ok | 30 | C01 C14 C29 C31 C32 C28 C13 |

## 3. Coverage table

Every module (API.md) and every command group (COMMANDS.md) has a row.

| Item | Rows | Item | Rows |
|---|---|---|---|
| events | S03 C05 (exercised by every module row; no own row) | input | S01 S02 |
| clock | S03 | vars | S04 |
| saves | S04 S05 C33 | assets | S06 C13 |
| audio | S07 | i18n | S08 |
| rays | S09 | jobs | S11 |
| stream | S10 | budget | S12 |
| post | S13 X02 | occlusion | S14 |
| ground | S15 | terrain, terrainDraw | M01 X03 |
| vegetation, vegetationDraw | M02 | sky | M03 |
| calendar | M04 | weather, weatherDraw | M05 |
| water | M06 | world | M07 |
| grids | M08 | collision | M09 |
| rigid | M10 M11 | cameraRig | M12 |
| timeline | M13 | level | M14 |
| triggers | M15 | particles | M16 |
| swarm | M17 | settings | M18 |
| music | M19 | characters, npcs | M20 |
| interactions | M21 | dialogue | M22 |
| inventory | M23 | pickups | M24 |
| quests | M25 | photo | M26 |
| ambience | M27 | nav | M28 |
| hlod | M29 | lightPool | M30 |
| content | M31 C09 | flow | M32 |
| hud | M33 | net | not tested (multiplayer out of scope) |
| exports threedog (helpers) | X04 | threedog/tsl | X01 |
| @threedog/post-effects | X02 | terrain-noise | X03 |
| dev, check, types | C01 | test | C32 |
| play, status | C02 | step, press, hold, describe, state | C03 C04 |
| errors | C05 | pick, thing, explain | C06 |
| ops, op | C07 | verify | C08 |
| content set/add/remove/stamp/ids | C09 | content capture | C10 |
| scene | C11 | capture, inspect perf | C12 |
| inspect materials | C13 | assets, assets check, bake | C14 C15 |
| lib status/check | C16 | lib add | C17 |
| examples | C18 | art list/copy, art board, gallery | C16 C19 |
| picture palette/compare, shot | C20 C21 | tune, panel | C22 |
| bake light | C23 | skip | C24 |
| snap-describe | C25 | catalog, how | C26 |
| mcp | C27 | doctor, api-count | C28 |
| map | C29 | stress, perf | C30 |
| build, preview | C31 | js --file | C33 |
| session, eval, snap, reload | used inside most C rows; no own row | loading | S06 |
| relay | not tested (multiplayer) | | |

Not testable or not worth a row
- `engine.net`, `threedog relay`, `fakeNetwork`, `webSocket`: multiplayer, out of scope.
- Touch controls (`touchButton`) and phone sizes: mobile, out of scope.
- `npm run perf` (plain three.js vs engine comparison): engine-maintainer measurement, not an AI task; C30 covers `stress`.
- Sound itself cannot be heard by a script; S07, M19, M27 judge bus state and played-event records only.
- GPU-dependent rows (X01, X02, C12 capture, C23 bake) give different numbers on software rendering; the runner must note which renderer was used.
- Error codes (187) are covered only through failures that rows trigger on purpose (S05, M23, M28, C06); no row tries all of them.

## 4. Batches (one agent each)

Order: cheapest and most likely to fail first. Run batches 1 and 2 before anything else; a failed row there is fixed by root cause before later batches.

| Batch | Rows | Why here | Est. |
|---|---|---|---|
| 1 Tools, no game needed | C28 C01 C02 C26 C29 C31 C32 C25 C21 | Cheap, scripts judge them, tool bugs block everything else | 70 min |
| 2 Drive and read the game | C03 C04 C05 C06 C07 C08 C24 C33 C27 | AI-facing loop; most likely to expose unclear output | 80 min |
| 3 Content and art tools | C09 C10 C16 C17 C18 C19 C14 C15 C13 | Writes files, easy to get wrong | 90 min |
| 4 Picture tools | C11 C12 C20 C22 C23 C30 | Heavy, GPU-sensitive, fails often | 80 min |
| 5 Core objects | S01-S15 | Pure script judgement | 130 min |
| 6 World modules | M01-M10 M14 M15 | Terrain, sky, physics | 130 min |
| 7 Character and story modules | M11-M13 M16-M33 | Biggest group; may split into M11-M25 and M26-M33 + M16-M20 | 200 min |
| 8 Add-on packages | X01-X04 | Shader and post effects, likely to fail | 50 min |
| 9 Composite A | K01 K02 K03 K05 | Mixed genres, flat to 3D | 3 h |
| 10 Composite B | K04 K06 K09 | Largest, most modules | 3 h |
| 11 Composite C | K07 K08 K10 then K11 | K11 needs earlier output | 3 h |

Counts: 15 core-object rows, 33 module rows, 4 add-on rows, 33 command rows = 85 single tasks; 11 composite tasks; 11 batches.
