# Capability batch 3 results: content and art tools

Run 2026-11-05 on start commit eb27ed67, rows from `tasks.md` section 4. Each row used its own fresh game from `threedog new-game`, and only the docs a game ships with. The test games are deleted.

**7 pass, 1 fail, 1 blocked.** All rows finished inside their time limit.

Renderer
- `threedog play` pages (C09, C10, C13, C16, C17, C18): software, SwiftShader. The game asked for WebGPU, got no adapter, and ran on the WebGL2 backend. C16 ended on plain WebGL, still SwiftShader.
- `threedog shot --play` (C18): real GPU, "drawn by WebGPU". The machine has an RTX 5060 Laptop GPU.
- `gallery --shots` (C19): the output does not say which renderer drew it.
- C14 and C15 use no renderer.

Minutes are clock time for the row, from the timestamps of the run. They leave out creating the game and the first reading of AI.md and COMMANDS.md (about 2 minutes, shared by all rows).

## Rows

| Row | Result | Min | Limit | Note |
|---|---|---|---|---|
| C09 | pass | 3 | 12 | All four edits made by `content set/add/remove/stamp`, `--dry` wrote nothing, `describe` total 9 and record positions match the files |
| C10 | pass | 3 | 10 | `content capture` wrote the file; stamped at the old spot the record positions equal the moved group, and a rotated stamp is correct too |
| C16 | pass | 6 | 10 | The pass line is met, but only after moving the whole game off WebGPU (see "C16 caveat") |
| C17 | fail | 2 | 8 | `lib add` worked, but `catalog --find` does not search the library, so the entry is never found there |
| C18 | pass | 2 | 10 | `modular-building` pulled and wired in; no page errors; four buildings visible in a real GPU shot |
| C19 | pass | 2 | 8 | Board and gallery opened headless with 0 page errors; all 6 registered models listed; 6 and 18 images, none broken |
| C14 | blocked | 2 | 10 | `assets check --strict` failed before as it should, but `assets optimize` stops because this machine has no `ktx` command |
| C15 | pass | 1 | 6 | `--against` named the missing spawn point, clip and material, exit 1; it did not name a lost plain mesh (see defect 11) |
| C13 | pass | 3 | 12 | `inspect materials` total went from 107.0 MB to 11.0 MB; 2 of the 3 minutes went to the texture error in defect 3 |

**C16 caveat.** The pass line checks `lib status`, `lib check`, the copied file and duplicate writes, and all four were fine. It does not check that the game runs. On the default WebGPU game the pulled sky stopped the game at start, while `lib check` said 0 problems. The game ran only after I removed `renderer: 'webgpu'` from `main.js`. If the row should mean "works in a default game", this is a fail, and the pass count is 6.

**Fixtures.** A blank game has no prop, bench, stall, group, model file or large texture, so I planted them before each row: models in `assets.js`, a `stall` arrangement, a `market` group, generated GLBs, generated PNGs. The prompts for these rows assume content the rows do not provide.

**Library safety.** C17 wrote to a scratch library through `THREEDOG_LIBRARY`. `~/.threedog/library` was only read, by the pull in C16.

## Failures and blocks by root cause

| # | Root cause | Owner | Rows | Cause in one sentence |
|---|---|---|---|---|
| 1 | `catalog --find` covers modules and ops, not the library | tool, or the row | C17 fail | The pass line expects a library entry from `catalog --find`, which printed no match and no "nothing found" line, while `lib list` and `how` both found the entry, so either catalog gains library hits or the pass line moves to `lib list`. |
| 2 | `assets optimize` has no route without `ktx` | tool (machine lacks it) | C14 blocked | Any model with a texture fails on the missing `ktx` command even after the texture is downscaled, so the "passes after optimise" half could not be run; I did not install software on this machine. |

For C14: downscaling with the installed `gltf-transform resize` made `assets check --strict` pass on that copy, so a route to a clean file exists outside `assets optimize`. Whether real `assets optimize` output passes `--strict` for a 4096 source is not tested. The one optimised fixture I checked (`tests/fixtures/optimized-crate.glb`) passes `--strict`.

## Defects in rows that passed

Grouped by the layer that owns the fix. None blocked a row.

**Engine**
3. `await engine.assets.texture()` before `engine.start()` throws on the WebGPU route ("initTexture() called before the backend is initialized"). The message tells a game author to call `renderer.init()`, which is not what they should do; loading after `start()` fixed it. (C13)

**Tool**
4. `lib check` does not compare an entry's backends with the game's. All 7 library entries are WebGL only and new games default to WebGPU, so every pull into a default game passes `lib check` and then stops the game at start. (C16)
5. `lib pull` prints a wrong import path: `./look/sky-bright.js` for a file it copied to `picture/sky-bright.js`. Following it fails the page load. `lib add` stores the path from the source game, which is where this comes from. (C16, C17)
6. `threedog how` says the docs never use "capture" or "arrangement", yet COMMANDS.md and recipe 30 use both. Searches for copying a prop or editing content without code never surface `content set` or `stamp`; the commands were found by reading COMMANDS.md. (C09, C10)
7. Bridge commands are very slow on a page that died at start: `errors latest` took over 100 seconds in C16, and `inspect materials` was still running after about 100 seconds in C13, when I stopped it. (C13, C16)
8. `status` after `reload` still reports errors from before the reload: the same id E3 was shown, and a fresh start was clean. (C16)
9. `js --file` cuts a long return value with no marker, so the output looks like complete but broken JSON. (C10)
10. `inspect perf` reported 0 draw calls and 0 triangles at the title screen with meshes in the scene. I did not look for the cause; the frozen title state or the WebGL2 fallback may explain it. (C13)
11. `assets check --against` does not report a lost plain mesh or node. This is the documented limit (it compares names a game depends on), but "what is missing" reads wider than that. (C15)

**Docs**
12. COMMANDS.md says a code entry pulled from the library goes to `plugins/<name>/` with a wiring file. The real pull copied to `picture/` and wrote no wiring file. (C16)
13. The `modular-building` README says to open `/modular-building.html` and describes `main.js` and `picture/`, none of which `examples pull` copies. (C18)
14. Nothing tells an AI how to shrink a loose texture. `assets check` says "downscale" and `assets optimize` calls size an art decision, so I used the `sharp` and `gltf-transform` packages found in `node_modules`. (C13, C14)
15. `inspect materials` gives sizes but no verdict on "too big"; the only threshold is the 2048 warning in `assets check`, which covers model files only. (C13)
