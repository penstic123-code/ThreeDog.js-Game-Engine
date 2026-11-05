# Capability batch 8 results (X01-X04, add-on packages)

Run 2026-11-05 on branch `test/capability-b8` (from fca81a96), one agent, about 25 minutes of the 50-minute limit. Each row used a fresh game from `threedog new-game`. The games were deleted afterwards.

Renderer: the pass lines were judged on the real GPU, real WebGPU (`backend: webgpu`, NVIDIA Blackwell, RTX 5060 Laptop), through `threedog test --gpu` and `threedog shot --gpu`. X01 and X02 were also run on software (three's WebGL2 backend on SwiftShader). `threedog play` always gave the software page, so bridge work (`eval`, `snap`) was on software.

## Rows

| Row | Result | Minutes (limit) | Note |
|---|---|---|---|
| X01 | pass | 8 (15) | Time changed the surface region by a mean of 48 levels out of 255, the slider by 78 (software: 59 and 78). |
| X02 | pass | 6 (15) | 2768 dark pixels with the outline on, 160 with it off. 99% of 4x4 blocks were flat with pixel snap on, 11% with it off. |
| X03 | pass | 4 (12) | Each of the three numbers moved heights at fixed points, by 38, 10 and 157 m at most. The screenshot shows an island. |
| X04 | pass | 5 (8) | All five calls gave expected values, in dev and in the production build. A bad option threw `module-params`. A clean `check` came at 8.5 minutes. |

4 of 4 passed; no row failed or was blocked.

## Not fully blind

No row was truly blind, and the results above should be read with that in mind.

- All rows: the runner had already read `tasks.md` (pass lines and the table tying each row to a package) and the engine repo's own `CLAUDE.md`, and judged its own work.
- X02: the runner grepped the source of `packages/post-effects` (`tsl.js`, `outline.js`) to see how `ctx.display` is used. The docs name `ctx.display.texture(input)` but do not show `.sample(uv)`, so this row may have needed the source.
- X04: the runner grepped `packages/engine/index.js` in the same step that read `API.md`. `API.md` lists the same names, so the source probably changed nothing.
- X03: `packages/terrain-noise/index.js` was read after the row passed, only to explain a number.
- X01, X02: the pass lines give no number, so the thresholds are the runner's own (X01: difference above 1 and 5 levels; X02: above 100 dark pixels and 3 times the count with the outline off).

## Problems found, by root cause

None of these failed a row. Ordered by how many rows they slowed; they block 0 rows.

### Tool
1. **`threedog how` misses helpers and wrongly says the docs lack the word (X01, X02, X04).** `how "easing"`, `"ease"`, `"EASINGS"`, `"checkOptions"`, `"pixelate"` and `"pixelation"` all answer no match, and the ones with a word in the docs say "The docs never use" it, although `api/tools.md` documents `ease` and `checkOptions` and recipe 52 uses "pixelation". `how.mjs` has no reference to `api/`, which fits, but this was not traced further. In a TSL game, `how` for a shader also ranked GLSL recipes first, and `how "slider"` found only the audio settings.

### Docs
2. **Two prompts ask for something that is not where they say (X02, X04).** `@threedog/post-effects` has no pixel effect, so the pixel snap was written as an own `engine.post.add` node. The main package has no colour palette helper, so X04 used `engine.assets.palette`, which is plain data. This is the wording of `tasks.md`, or a real gap if such helpers are wanted.
3. **A pixel look is not told about adaptive resolution (X02, software only).** Slow frames lowered the pixel ratio to 0.6, so the blocks no longer lined up with 4 screen pixels and the flat share fell from 99% to about 20%. Recipe 15 covers `adaptiveResolution: false`, but nothing on the post or pixel side points to it.
4. **`readParams` is described as throwing "in dev" (X04).** It also threw in the production build.
5. **`heightScale` is described as "overall relief multiplier" (X03).** Raising it from 1 to 1.6 lowered the island's centre from 93 to 83 m, because it scales signed noise and the mountain part does not use it.

### Owner unknown
6. **Pale rectangular patches around the island's shore (X03).** They were visible on real WebGPU with `water()` and the terrain together. Cause not investigated; it may be terrain chunks, the water, or the runner's setup.
