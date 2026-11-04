# Notes for this game

__GAMEPLAY_NOTE__

## Already here
The picture is plain three.js, as free as you like. The engineering below is the engine's, one line each; `main.js` has them as commented lines to copy. Start screen, autosave and Esc pause
already run: delete one only if the game has none (writing it yourself leaves it out of saves, tests and `describe()`). Docs: `node_modules/threedog/docs/` (`AI.md`, `recipes/`) in the nearest parent folder that has `node_modules`.
| Needs | Already here | Recipe |
|---|---|---|
| Save, resume after refresh | `main.js`; own state: `engine.saves.register('game', { version: 1, save, load })` | 20 |
| Esc pause, settings, quality | `settings({ freezeWorld: true })`; own row: `engine.settings.define` | 07, 26 §6 |
| Start, win, lose screens | `ui.title`; `makeWindow`; again: `engine.session.newGame()` | 26 §5, "A window" |
| Input | `engine.input.action('use', { label: 'Use', keys: ['KeyE'] })`, `engine.input.pressed('use')` | 58 |
| Camera | `followCamera()`, `firstPersonCamera()`, `rtsCamera()`, `fixedCamera()` | 21 |
| Walking character, walls | `characters()`, `createPlayer`, `collision()` | 63 |
| Talking NPC | `dialogue()`: `engine.dialogue.define(name, nodes)`, `.start(name)`; flags are saved | 02 |
| Press E on any mesh | `interactions()`: `engine.interactions.add(mesh, { label, onUse })` | 02, 20 |
| Quest with a marker arrow | `quests()`, `hud()`: `engine.quests.define(id, { title, steps: [{ text, target, done }] })` | 04 |
| Grass, trees, flowers on your geometry and spots | `vegetation()`: `engine.vegetation.define(name, { geometry, positions })` | 05 §2e |
| HUD | `hud()`, `engine.hud.counter('score', { label: 'Score', value: 0 })`; a counter's total: `engine.hud.value('score')`; other values: `engine.vars` | 26 |
| Short popup message | `toast(engine, 'Picked up')`, imported from `threedog` | 26 §3 |
| Sounds | `content/audio.js`, `engine.audio.sfx('door')` | 31 |
| Tests | `npm test`: a smoke test | `COMMANDS.md` |

## First session
- A clear request: build it, no confirmation round. Ask only about a choice that changes the result and cannot be inferred. Picture not given: ask for reference images, the style and what would be wrong here (DESIGN.md "Loved / Not for this game").
- Everything else you decide: write it into DESIGN.md as "(picked, not asked)" with a one-line why, and list the picks in your report. Changing what DESIGN.md settled: ask first.

## What done means
Gray placeholders (gray picture/ folder, capsule player, box props) mean the art is not made yet: making it is your job. A feature is done
when it plays AND looks as DESIGN.md describes; a placeholder goes into STATUS.md as unfinished. Build a thin slice first (one place, one action, one goal, one shot
with its real picture), then widen it. Stop at DESIGN.md "Done for this version"; later ideas go to STATUS.md Next.

## How to work
1. Before writing, list every place the change must reach (callers, content, saves, tests, records) and what it could break for the player.
2. Take the first option that fully works: does it need to exist -> already in this game or the engine (the table above, GAMEMAP.md,
   `threedog how "<2-4 English task words>"`, `threedog catalog`, AI.md; note the system in DESIGN.md Systems) -> plain three.js or the browser (`THREE.md`) ->
   an installed package -> the least code that works. "Least" is about code, never the result.
3. Check `threedog lib list` before writing an effect from scratch; `threedog art board`: all art. Technique examples (`threedog examples list`) are a reference for what a shot check or review
   finds you cannot fix, never a starting point or the picture.
4. No abstraction, option or "for later" code nobody asked for. A new way replaces the old one: delete the old in the same change.
5. Debugging: root cause first (grep the callers, `engine.describe()`, recipe 16 §11), then fix it once where it lives. Cannot reproduce: say what is missing.
6. Check the license, and tell the user, before using someone else's code or assets.
7. End of a piece: logic with weight leaves one small test or assert; a picture round ends with one shot.
8. A known-limit shortcut gets `// shortcut: <limit>, <when to upgrade>`. Other comments: only the why.
9. Never cut: save-data safety, input checks at data entry, what the user asked for.
10. Report what is true: verified, not verified, still a placeholder. Never call a picture "close to the reference".
11. Before a long task ends, update STATUS.md.

The picture is plain three.js in `picture/`, one file per job; gameplay code uses material names, signals and `picture/` exports (`picture.lamp(id).off()`), not lights.
__PICTURE_ROUTE__ Optional looks: `celLighting` (56), `outline`, `lut`, `paletteLut` (52), voxelGI (34). Costly things read `engine.tier`. Signals, adding a sky or post
effects: recipe 62. Picture rounds: recipe 35; judging: recipe 60.
`threedog shot --play` or `threedog snap` run the picture check; other screenshots skip it.
Judge taste against DESIGN.md "Loved / Not for this game".

## Content vs code
What a save keeps with its own state is content: a template (`content/templates.js`) plus a placement with an id (`content/props.js`); code-built scenery
may use `engine.add(mesh, { id })`. `npm run check` rejects startup code that creates what a save
stores whole (`world.add`, `engine.content.spawn`, pickups, NPCs). Code holds rules: ops, `onFixed` for game time (damage, cooldowns, AI, timers),
`onFrame` for what shows (animation, camera, HUD). Things made in play come from `engine.content.spawn` inside an op. Content (items, NPCs, dialogues, quests...) goes in `content/`; models, textures, sounds are registered by name in `assets.js`, files in `public/`; one-file three.js pieces in `plugins/`.

## Commands and docs
`npm run dev`, `npm run check`, `npm test`, `npm run map`, `npm run build`. After a change: `npm run map` (only if code, JSDoc or content changed), `npm run check`, then the related tests (`npm test -- name`). MCP (`.mcp.json`): the dev bridge as tools while `npm run dev` runs (recipe 16 §10).
Reading order: STATUS.md -> DESIGN.md -> `docs/design/<system>.md` or `docs/plans/<feature>.md` -> GAMEMAP.md (`npm run map`) -> `AI.md` (above) -> its recipe.
Records: a change updates only the records it makes wrong (a rule, system or Done: DESIGN.md and its `docs/design/` file; progress: STATUS.md). A finished
plan moves to `docs/plans/done/`. Reply in the user's language.

<!-- "How to work" items 1-2, 4 and 7-9 adapt principles from the ponytail skill (github.com/DietrichGebert/ponytail, MIT). -->
