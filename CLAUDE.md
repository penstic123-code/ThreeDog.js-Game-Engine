# CLAUDE.md — rules for developing threedog.js

threedog.js is a web 3D game engine on top of three.js 0.187 (plain three.js, no React) in two layers: **core** (every game needs it) -> **modules** (installed on demand with `engine.use`). Art is each game's own (its `style/` folder and `assets.js`); the engine ships none. three.js stays fully writable: a direct write takes a value over and the engine yields (`core/owned.js`). Details of each area load from `.claude/rules/` when you touch matching files. How to *use* the engine is in `packages/engine/docs/AI.md` (shipped with the package).

## Hard rules (`npm run check` verifies them)
1. **The engine provides mechanisms, never hard-coded art.** Colors, models, sky, lighting, particle looks and UI colors come from the game (`engine.style` from its `style/` folder, names in `assets.js`, or plain three.js); without them the engine shows neutral gray. Sounds are the game's. Engine modules build materials through `makeMaterial` (dev-only debug overlays may use a plain line material); games may use three.js materials directly.
2. **Core never depends on modules.** `packages/engine/core` must not import `packages/engine/modules`; module dependencies go in `requires`, optional ones are used as `engine.xxx?.` and listed in `optional`.
3. **Game content never enters the engine.** Dialogue, quests, items and map layout live in `games/<game>/` (data in `content/`; engine examples in `packages/engine/examples/`); no game's name or data appears in the engine.

## Repository layout
```
packages/engine/   threedog: core/ modules/ (one folder per module) render/ ui/ examples/ docs/ tests/ types/ (no art)
packages/styles/   lowpoly/ = private re-export of examples/world/style (used by tests and older games; never published, not a recommendation)
packages/terrain-noise/  optional terrain generator @threedog/terrain-noise (world shape is gameplay, never in a style)
packages/tools/    @threedog/tools: CLI `threedog`, paths.mjs (single source of truth for paths), rules/ (R1...), generators, templates/
games/<game>/      your games, one workspace each (none in this repo; `threedog new-game <name>` creates one, games/ itself is optional)
```

## Commands
`npm run check` after every change (hard rules, rules R1..., types, content, generated docs up to date); `npm test -- name` runs only tests whose name contains it (no match fails); `npm run map` regenerates GAMEMAP / API.md / api/ / CODEMAP; `npm run types`; `npm run dev [-- game]`. The full list is in `packages/engine/docs/COMMANDS.md`.

## Module hooks
`fixed(dt, e)`, `frame(dt, e)`, `afterRender(dt, e)` (details in `.claude/rules/engine-core.md`); `afterLoad(e)`: after a save loaded, gameplay frozen until its Promise resolves; `skip(dt, e, done)`: called per segment by engine.skip, `done` on the last segment; only modules that keep their own time need it.

## Docs (each sentence in one place)
- Layers: `AI.md` is the index (one line per task: API name + recipe) -> `recipes/` teach tasks -> `api/` and the d.ts hold API details, generated from JSDoc only -> `GAMEMAP.md` per game. Recipes link to api pages instead of restating signatures; `CODEMAP.md` and `.claude/rules/` are read when needed.
- Adding a public API: add its AI.md entry-table row and recipe section in the same commit (checked).
- Generated files (GAMEMAP, API.md, api/, CODEMAP, `types/generated/`) are never edited by hand; run `npm run map`. R18 checks names in hand-written docs, R22 their shape (entry table, sizes, repeated sentences).

## Working rules
- The engine does three things only: cross-system coordination, hard repeated engineering, and AI visibility / verification. What three.js already does, the engine does not wrap. One entry per mechanism, the same verbs everywhere (define a kind / add or spawn one / `{ remove() }` handles); customization follows the one ladder in `packages/engine/docs/CONVENTIONS.md` "Customization ladder".
- Before writing, list every place the change must reach: callers, games and examples, tests, types, docs, saves. Then take the first option that fully works: is it needed at all (skip what nobody asked for and say so in one line) -> already in the engine (CODEMAP, `threedog catalog`) -> three.js or the platform -> an installed dependency -> the least new code.
- No abstraction, option or "for later" code nobody asked for. Deleting beats adding: a replaced way, option, test or doc is deleted in the same change, with no compat layer.
- Bug fix: grep every caller, find the root cause, fix it once in the layer that owns it; group findings by root cause instead of patching each report.
- New logic with weight gets one non-bypassable test; a shortcut with a known limit gets `// shortcut: <the limit>, <when to upgrade>`; other comments only say why, in one line. Never cut save-data safety, option validation at public entries, or what the user asked for.
- Before reporting, run in this order and say what you ran: `npm run map` (only if you changed a public API, JSDoc or content) -> `npm run check` -> the related tests. Attach before/after numbers for performance changes.
- Design trade-offs that change gameplay or a recorded decision (DESIGN.md): ask first, then change.
- Reply in the language the user writes in.

<!-- Working rules 2, 3 and 5 adapt principles from the ponytail skill (github.com/DietrichGebert/ponytail, MIT). -->
