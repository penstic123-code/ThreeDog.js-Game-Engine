# CLAUDE.md — rules for developing threedog.js

threedog.js is a web 3D game engine on top of three.js 0.187 (plain three.js, no React) in three layers: **core** (every game needs it) -> **modules** (installed on demand with `engine.use`) -> **style packs** (all art). Details of each area load from `.claude/rules/` when you touch matching files. How to *use* the engine is in `packages/engine/docs/AI.md` (shipped with the package).

## Hard rules (`npm run check` verifies them)
1. **The engine provides mechanisms, never hard-coded art.** Colors, models, sky, particle looks, sounds and UI colors all come from `engine.style`; the engine may only use a neutral gray fallback. Style packs may create three.js materials directly; engine modules and games go through `makeMaterial` (dev-only debug overlays, such as the trigger wireframes, may use a plain line material whose color still comes from the style pack).
2. **Core never depends on modules.** `packages/engine/core` must not import `packages/engine/modules`; module dependencies go in `requires`, optional ones are used as `engine.xxx?.` and listed in `optional`.
3. **Game content never enters the engine.** Dialogue, quests, items and map layout live in `games/<game>/` (data in `content/`; engine examples in `packages/engine/examples/`); no game's name or data appears in the engine.

## Repository layout
```
packages/engine/   threedog: core/ modules/ (one folder per module) render/ ui/ styles/lowpoly/ examples/ docs/ tests/ types/
packages/tools/    @threedog/tools: CLI `threedog`, paths.mjs (single source of truth for paths), rules/ (R1...), generators, templates/
games/<game>/      private/example games, one workspace each (they will move to a private repo)
```

## Commands
`npm run check` after every change (hard rules, rules R1..., types, content, generated docs up to date); `npm test -- name` runs only tests whose name contains it (no match fails); `npm run map` regenerates GAMEMAP / API.md / api/ / CODEMAP; `npm run types`; `npm run dev [-- game]`. The full list is in `packages/engine/docs/COMMANDS.md`.

## Module hooks
`fixed(dt, e)`, `frame(dt, e)`, `afterRender(dt, e)` (details in `.claude/rules/engine-core.md`); `skip(dt, e, done)`: called per segment by engine.skip, `done` on the last segment; only modules that keep their own time need it.

## Docs (each sentence in one place)
- Layers: `AI.md` is the index (one line per task: API name + recipe) -> `recipes/` teach tasks -> `api/` and the d.ts hold API details, generated from JSDoc only -> `GAMEMAP.md` per game. Recipes link to api pages instead of restating signatures; `CODEMAP.md` and `.claude/rules/` are read when needed.
- Adding a public API: add its AI.md entry-table row and recipe section in the same commit (checked).
- Generated files (GAMEMAP, API.md, api/, CODEMAP, `types/generated/`) are never edited by hand; run `npm run map`. R18 checks names in hand-written docs, R22 their shape (entry table, sizes, repeated sentences).

## Working rules
- Before reporting, run in this order and say what you ran: `npm run map` (only if you changed a public API, JSDoc or content) -> `npm run check` -> the related tests. Attach before/after numbers for performance changes.
- Design trade-offs that change gameplay or a recorded decision (DESIGN.md): ask first, then change.
- Reply in the language the user writes in.
