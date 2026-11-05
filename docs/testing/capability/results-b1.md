# Capability test results: batch 1 (tools, no game needed)

Run 2026-11-05 on engine 0.7.1, start commit eb27ed67, branch `test/capability-b1`. Rows are from `tasks.md` section 4. Total wall time 27 minutes against an estimate of 70.

**Result: 8 pass, 1 fail, 0 blocked.**

Machine: RTX 5060 Laptop GPU, nine other agents running. Commands were `node packages/tools/bin/threedog.mjs ...` with real exit codes. Rows that needed a game used `new-game` games, not one each: C01, C25 and C21 had their own, C02, C26 and C29 shared one, C31 and C32 shared one. All were deleted afterwards. No engine code was changed.

| Row | Result | Minutes (limit) | Renderer | Evidence or cause |
|---|---|---|---|---|
| C28 | pass | 1 (5) | both probed by `doctor` | `doctor` exit 0; `api-count --json` total 1782, 54 CLI commands, equal to the plain output |
| C01 | pass | 6 (12) | none needed | 3 planted mistakes (misspelled property, world record made at startup, wrong model and place names), one fix attempt each; `check --json` and `types` exit 0 |
| C02 | pass | 2 (6) | software (SwiftShader, WebGL2 fallback) | `play`, `status` ready with no page errors, `play --stop`; port closed, no process left |
| C26 | pass | 1 (6) | software (same) | `catalog` lists the game's ops; `how "door that opens"` leads to recipes 13 section 4 and 18 section 4b (which points to 30) |
| C29 | pass | 3 (8) | software (same) | new `plugins/oxygen.js` module and `oxygen:empty` event both appear in GAMEMAP after `map`; `check` exit 0; `engine.oxygen.value` is 80 in the page |
| C31 | pass | 3 (8) | real GPU (`shot --gpu`) | `build` exit 0 and prints sizes (dist 5.1 MB); `preview` page loads, `shot --json` errors `[]` |
| C32 | pass | 3 (10) | real GPU (runner: "on the GPU") | clean run 7 of 7; with 2 planted failures 8 passed, 2 failed, both named, exit 1; `--json` gives the same counts |
| C25 | **fail** | 4 (8) | software (same) | Only a camera change gave the exact field. A moved prop and a set story flag did not; see cause 1 and 2 below |
| C21 | pass | 3 (6) | real GPU, WebGPU backend | `shot --view gate --compare`: pixel diff 0 unchanged, 0.0019 after moving a prop |

## Failures by root cause

Ordered by rows blocked. Both causes block the same row, C25, and each one alone is enough to fail it.

### 1. `describe()` does not contain the state that changes most (owner: engine, 1 row)
- C25: `engine.describe()` has no story flags or counters, and `world` holds only totals, so `snap-describe diff` printed "matches the baseline" after `vars.setFlag`, `vars.bump` and a prop moved with `thing.set`.
- This is the worse of the two: the tool reports no change when the game did change, and a test built on `expectDescribe` would pass wrongly. Confirmed with `--ignore picture`: the moved prop still gave "matches".

### 2. Snapshots keep values that change every frame (owner: tool, 1 row)
- C25: `DEFAULT_IGNORE` in `packages/tools/describe-snapshot.mjs` drops `perf` and time values but not `picture.writers`, so a diff after one op printed 7 lines of frame counters and none of them was the change.
- After `step 30` on an idle title screen, 12 lines differed. Recipe 16 section 7 calls the baseline "the gameplay part", which these lines are not.

## Smaller problems seen in passing rows

None of these failed a row. Grouped by owner.

Engine
- A badly formed `op` argument stops the game: `op thing.set position=3,0,4` raised `bad-position`, and the engine froze gameplay (`time.frozenBy` gained `error`). A wrong argument from a tool should come back as a refused op. Seen in C25.

Tool
- `threedog --help` prints the usage line but exits 1.
- `threedog catalog --find door` with no match prints only the "Details" line, with no "nothing found".
- `shot --keep --out before.png` wrote `before_<timestamp>.png`, while the `--out` help says `.threedog/shots/file.png`. An AI has to list the folder to find its own picture.
- `Pixel diff: 0` also printed for a real GPU picture against a software one, where "detail" read 3.6 and 3.4, so 0 appears to be rounding and "identical" is too strong.
- `check` in a game ends with "engine and shared packages: 104 warnings", which a game author can do nothing about.
- `new-game` and `check` took about 80 seconds each under this load (R18 alone 27 to 40 s), and every fresh project pays it.

Docs
- C31: no page says how to check a preview for errors. `preview` stays in the foreground, the dev bridge is absent there, and `shot <url> --json` was found only through `shot --help`.
- C26: `how "door that opens"` ranks clip animation first; the template and op route (recipe 30), the one for a door with state, is reached only through the second hit.
- `ops` shows `position=any?` with no format. The working form, `position={"x":3,"y":0,"z":4}`, is not in the docs read.

## Limits of this run
- One agent ran all rows in order, so later rows were not blind: it had already read the docs and seen the tools. The minutes are lower than a fresh AI would need.
- The planted mistakes in C01 and C32 were chosen by the same agent that fixed them.
- Source files beyond the shipped docs were read three times: `gamemap/extra.mjs` in C29 (the module was written from recipe 14 alone), `shot.mjs` in C31 (to learn whether errors are printed), and `describe-snapshot.mjs` for the C25 cause. No pass depended on them, apart from the C31 hint that `--json` carries `errors`.
- `play` opens a software page, so C02, C25, C26 and C29 ran on the WebGL2 fallback while the game asks for WebGPU; `shot` and `test` use the real GPU. No result here depends on the renderer.
