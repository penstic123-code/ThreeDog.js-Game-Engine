---
paths:
  - "packages/styles/**"
  - "packages/engine/render/**"
  - "packages/engine/ui/**"
  - "packages/engine/core/I18n.js"
---

# Styles, rendering, UI and i18n

- Hard rule 1 in practice: the engine only provides mechanisms. Anything about "what it looks like" (colors, models, sky, lighting, particles, UI colors) is read from `engine.style`; the engine itself may only fall back to neutral gray.
- The engine ships no art: no default style, character model, terrain look or generator. A game's look lives in its own `style/` folder (visuals only; there are no published style packages); sounds are the game's (`createEngine({ audio })`). A new look parameter falls back to neutral gray in the engine; examples that need a value set it in their own style folder (e.g. `packages/engine/examples/world/style/`).
- Never hard-code player-facing text in the engine: it goes through i18n (`e.t('key')`, strings added with `e.i18n.add`). Developer-facing text (console warnings, errors, `describe` output) is English. R12 checks that strings from `STRINGS` tables are not shown to players directly; don't touch its `SINK_*` patterns.
- Never rename an I18n key. Only developer text may be edited; both the zh-CN and en player-facing tables stay. `check.mjs` finds keys by the `'module.n':` form appearing once in each table; keep that format.
- The default locale follows the player's browser (Chinese browser -> Chinese, otherwise English); a game may set it explicitly with `createEngine({ locale })`.
- Shader code goes in as named patches via `applyEffects` (`render/patches.js`); never assign `onBeforeCompile` directly. A patch declares needs / conflicts / shadow / cacheKey (see the header of render/patches.js); post effects are named entries in engine.post slots, never a direct EffectComposer (R26 checks both: an error in engine code and styles, a warning with the reason in game code; it also warns on `material.clone()` without `copyPatches`).
