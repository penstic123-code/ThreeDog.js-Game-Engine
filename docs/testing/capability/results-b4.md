# Capability batch 4 results: picture tools

Run 2026-11-05 on branch `test/capability-b4`, from commit eb27ed67 (threedog 0.7.1). Rows C11 C12 C20 C22 C23 C30 from `tasks.md`. Each row used a fresh game from `threedog new-game` (the default: WebGPU, TSL), read only the docs a game ships with except where noted, and was judged by its pass line. No engine code was changed; the test games are deleted.

Result: 5 of 6 rows pass the pass line, 1 fails, 0 blocked. C12 passes only on the letter of its line, see below.

Minutes are wall-clock for the row. They leave out `new-game` (about 70 s per game) and the first read of AI.md and COMMANDS.md (about 2 minutes, once). The same agent planted the faults and then looked for them, so C11 and C12 are not blind tests of the diagnosis; they test what the tools print.

## Rows

| Row | Result | Minutes (limit) | Renderer | Note |
|---|---|---|---|---|
| C11 | pass | 2 (10) | software (SwiftShader, WebGL2 fallback) | `scene` named both planted causes (layer mask 8 against camera mask 1; world scale 0). After the fix `scene --hidden` shows 0 undrawn and the screenshot shows both meshes. |
| C12 | pass, weak | 5 (15) | software for `inspect perf` and `capture` | Draw calls 4295 to 14 with `userData.batch` and shared geometry and material. `capture` was used, but on a WebGPU game it reported 0 draws, so it never named what costs most. The planted scene was known, so the fix did not depend on it. |
| C20 | pass | 2 (12) | real GPU (RTX 5060, WebGPU) for `shot` | Against a generated reference: brightness +76% to -17%, saturation -100% to -40%, contrast -55% to +21%. Fine detail got worse in the other direction (x0.35 to x1.85). |
| C22 | pass | 4 (10) | software (dev page) | `tune write main.js --apply` changed the source; after reload fog, exposure and material values matched. A model size (`params.height` 3.51) went into `assets.js` and survived reload. Several defects on the way, see cause 4. |
| C23 | fail | 5 (15) | real GPU (RTX 5060, WebGPU, system Chrome) for bake and shots | Lightmap file written and all lights at 0, but the picture has no believable soft shadow: the floor is black, every wall base and corner glows, and the pillar casts no shadow. Cause: probes in or behind the walls see the sky and spread it along every edge. |
| C30 | pass | 2 (12) | real GPU (RTX 5060, WebGL through ANGLE D3D11) | Below 30 fps at about 8522 separate meshes (draw calls axis) and about 426 skinned characters. The numbers describe the neutral test page, not this game, see cause 3. |

## Root causes

### Blocks a row

1. **The light bake lets outside light into a room (tool; blocks C23).** `packages/tools/light-bake-page.js` lines 63-66 lay a plain probe grid over the bounding box of the static meshes, and nothing checks whether a probe sits inside a wall or outside the room. The bright rim got narrower when probe spacing went from 1.5 m to 0.75 m, which ties it to the grid; walls 1 m thick did not remove it. The file header already marks the bounce as a shortcut. No bake option sets the grid bounds.

### Does not fail a row, but hides a problem

2. **Tools print success over an empty or wrong result (tool; touches C12, C23).**
   - `threedog inspect perf` before any frame is drawn prints 0 draw calls and all budgets ✓, while the status line says the picture keeps rendering. A headless page on the start screen shows this on both WebGPU and WebGL games, until `snap --play` or a step draws a frame.
   - `threedog capture` on a WebGPU game prints 0 draws and exits 0 (cause 3).
   - `threedog bake light` with the game's lights at 0 writes an all-black lightmap, prints ✓ and exits 0, and the next run of the game is black.

3. **Picture tools still assume WebGL while new games default to WebGPU (tool; touches C12, C30).**
   - `capture` hooks `renderBufferDirect`, which WebGPURenderer does not have. On a WebGPU game the report is empty while its Spector line counts 3323 GL draws. The same scene on a `--webgl` game gives the full report, with the 320000-triangle statue on top, so this is the cause.
   - `inspect perf` then points to `capture` for "the largest draws", so on the default route that hint leads nowhere.
   - `stress` runs only the engine's neutral WebGL page. It ignores the game it is run from, so it cannot answer "at what load does the game drop". `tests/` is also outside the `files` list of `packages/engine/package.json` and `stress` opens `/tests/stress/index.html`, so it probably cannot run from an npm install (read from the code, not run).

4. **`threedog tune` has rough edges (tool; touches C22).**
   - The second `tune write --apply` replaced the earlier block and wiped the fog, exposure and material values, because a reloaded panel only holds what changed since. The diff shows it, but nothing warns about it.
   - The block it writes fails `threedog types` (`o.material` on Object3D at the generated line), so a tuned game no longer passes `check`, and hand-fixing the line is lost at the next write.
   - `tune` refuses `-w`, unlike nearly every other command: it has to run from inside the game folder.
   - `tune write` without a file prints only the usage line, though the usage shows the file as optional and three.js values need one.

5. **Docs do not cover two steps an AI meets (docs; touches C22, C23).**
   - Nothing says how an AI moves the panel without a mouse. `engine.devPanel` appears only in the 0.6 migration notes. For this run the way to set values came from the engine test `tests/specs/panel.mjs`, which a game does not ship with; that is outside the row's rules. Typing into the panel's text fields and clicking "write back" through `eval` worked with DOM calls alone, numbers used a tweakpane internal.
   - Recipe 34 says to set `hemi.intensity = 0` after loading the lightmap. In the template that line has no effect, because `picture/lights.js` rewrites the intensity every frame (read from the code), and the palette change that does work leaves the next bake with no sky. It takes a URL flag (`bake light --page "/?bake=1"`) to bake with the lights on and play with them off; the recipe does not mention this.

## Renderer notes

- The dev bridge page (`scene`, `snap`, `inspect perf`) runs on SwiftShader through the WebGL2 fallback, even though `doctor` finds the RTX 5060. `describe().renderer` says so. `shot` uses the real GPU and real WebGPU. So the ms figures from `inspect perf` are software numbers.
- `capture` used the default headless launch: software, on the WebGL2 fallback for a WebGPU game.
- Nine other agents were running: `stress` numbers carry noise, and `capture` took 2 minutes.
