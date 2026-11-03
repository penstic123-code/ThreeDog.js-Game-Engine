# Notes for this game

__GAMEPLAY_NOTE__

## First session
- A clear request: build it, no confirmation round. Ask only about a choice that changes the result and cannot be reasonably inferred (a vague
  request: offer 2-3 clearly different minimal versions with scope, core loop and main risk). If the look is not given, ask for reference images,
  the overall style and what would be wrong for this game (DESIGN.md "Loved / Not for this game").
- Everything else you decide: write it into DESIGN.md marked "(picked, not asked)" with a one-line why, and list those picks in your report so the
  user can change them. The same when the user cannot be asked. To change something DESIGN.md already settled: ask first when you can.

## What done means
The template is a starting point, not a look. Gray placeholders (empty style/index.js, capsule player, box props) mean the art is not made yet, and making
it is your job as much as the gameplay. A feature is done when it plays AND looks as DESIGN.md describes; a placeholder goes into STATUS.md as unfinished,
never reported as done. Plan time for both; when time is short, say which look work is left. Build a thin slice first (one place, one action, one goal, one shot with its real look), then widen it, not a spread of empty systems. Stop at DESIGN.md "Done
for this version"; ideas past it go to STATUS.md Next.

## How to work
1. Before you write, list every place the change must reach (callers, content, saves, tests, the records it changes) and what it could break for the player.
2. Take the first option that fully works: does it need to exist (name what you skipped) -> already in this game or the engine (GAMEMAP.md,
   `threedog how "<2-4 English task words>"` (e.g. `how "save game"`, `how "rigid push"`; on "no match" try the words it suggests), `threedog catalog`, the AI.md index; note the system in DESIGN.md Systems) -> plain three.js or the browser
   (looks are plain three.js on `engine.scene / camera / renderer`, `node_modules/threedog/docs/THREE.md`) -> an installed package -> the least code that
   works. "Least" is about code, never about the result.
3. Check `threedog lib list` before writing an effect from scratch. Use your own approach first. Technique examples (`threedog examples list`) are a reference for when a shot check or your own review finds something you
   cannot fix, never a starting point or the look.
4. No abstraction, option or "for later" code nobody asked for. When a new way replaces an old one, delete the old one in the same change.
5. Debugging: find the root cause before changing anything (grep the callers, `engine.describe()`, recipe 16 §11 "When something happens"), then fix it once where
   it lives. No drive-by refactor while fixing. If you cannot reproduce it, say which specific information is missing instead of guessing.
6. Learning from three.js examples, open-source code and articles is fine: learn the technique and write it for this game; check the license and tell the
   user before using someone else's code or assets.
7. Check at the end of a piece: logic with weight leaves one small test or assert; a look round ends with one shot. Run only the related tests.
8. A shortcut with a known limit gets `// shortcut: <the limit>, <when to upgrade>`. Other comments say only the why the code cannot show.
9. Never cut: save-data safety, input checks where data comes in, anything the user asked for.
10. Report what is true: what was verified, what was not, what is still a placeholder. Never call a look "close to the reference".
11. Subagents: split work only after DESIGN.md fixes the systems and their interfaces. Each subtask gets its scope, the files it must not touch and its
    Done. The look and the gameplay direction stay with one agent.
12. Before a long task ends, update STATUS.md (it is the handover page).

Tuning the look: the round loop, the shot check and the look questions are in recipe 35 (`node_modules/threedog/docs/recipes/35-style-from-reference.md`;
its top says what to skip without a reference picture); each knob and how to judge it: recipe 60 (`60-judge-the-picture.md`).
Take pictures with `threedog shot` or `threedog snap`: both run the look check (glare, shadows, night); a screenshot script of your own skips it.
Taste is judged against DESIGN.md and its "Loved / Not for this game" list, never against a technique example.

## Content vs code
What a save keeps with its own state is content: a template (`content/templates.js`) plus a placement with an id (`content/props.js`); code-built scenery
may use `engine.add(mesh, { id })` (`engine.thing(id)` says what a save keeps). `npm run check` rejects startup code that creates what a save
stores whole (`world.add`, `engine.content.spawn`, pickups, NPCs). Code holds rules: ops, `onFixed` for game time (damage, cooldowns, AI, timers),
`onFrame` for looks (animation, camera, HUD). Things made during play come from `engine.content.spawn` inside an op. Content (items, NPCs, dialogues,
quests...) goes in `content/`; models, textures and sounds are registered by name in `assets.js`; files go in `public/`.
One-file three.js pieces go in `plugins/` (its README).

## Commands and docs
`npm run dev`, `npm run check`, `npm test`, `npm run map`, `npm run build`. After a change: `npm run map` only if you changed code, JSDoc or content, then
`npm run check`, then only the related tests (`npm test -- name`). MCP (`.mcp.json`) exposes the dev bridge as tools while `npm run dev` runs (recipe 16
§10); an `op` or `step` sent that way changes this session and its saves only, edit `content/` to change the level.
Reading order (stop when you have enough): STATUS.md -> DESIGN.md -> `docs/design/<system>.md` or `docs/plans/<feature>.md` -> GAMEMAP.md
(`npm run map`; "Read for this game") -> `node_modules/threedog/docs/AI.md` (index) -> the recipe it points to.
Records: a change updates only the records it makes wrong (a new or changed rule, system or Done: DESIGN.md and its `docs/design/` file; progress: STATUS.md); a small fix touches none. `npm run check` reports a file, command, test or engine name in backticks in DESIGN.md that no longer exists. A finished
plan moves to `docs/plans/done/` with one line in STATUS.md. Reply in the language the user writes in.

<!-- "How to work" items 1-2, 4 and 7-9 adapt principles from the ponytail skill (github.com/DietrichGebert/ponytail, MIT). -->
