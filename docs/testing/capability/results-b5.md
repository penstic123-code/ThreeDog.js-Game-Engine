# Capability batch 5 results: core objects (S01-S15)

Run 2026-11-05, 12:28 to about 13:10, branch `test/capability-b5` from c1863b3d. Rows are from `tasks.md` section 1.1.

**Result: 13 pass, 1 fail, 1 blocked.**

**Renderer: software.** Every row ran on the dev bridge's headless page: WebGPU was requested, there was no adapter, and three's WebGL2 backend drew through SwiftShader (`describe().renderer`: `backend: webgl2`, `requestAdapter() returned no adapter`). No row ran on a real GPU. About nine other agents shared the machine, so wall-clock frame times are not meaningful here (see S11).

## Rows

Minutes are wall clock and approximate: rows were built in groups, so doc reading is shared between them. S01 includes first-time setup.

| Row | Result | Min | Limit | Evidence, or cause of failure |
|---|---|---|---|---|
| S01 | pass | 6 | 8 | Simulated `jump` lifts the box more than 0.3 m, it lands back at the start height, no page errors. |
| S02 | pass | 2 | 8 | After rebind and reload `keysOf('jump')` has KeyK and not Space; a Space key event does nothing, KeyK jumps. |
| S03 | pass | 1 | 6 | Counter is 4 after 4 events; message absent at 2.9 s, present at 3.0 s. |
| S04 | pass | 1 | 8 | Two flags and the score equal after save, reload, `session.load`. |
| S05 | pass | 2 | 10 | 5 items back after export and import; `importFile` of a wrong file returns null, with a visible toast and a warning that explain why. |
| S06 | pass | 9 | 10 | `threedog loading`: 4/4 ok, done; shot shows a checker-textured crate. See finding 3 for what `loading` missed with a KTX2 model. |
| S07 | fail | 7 | 10 | Ducking cannot be read back through anything the docs name, and the only reader (internal) stays at 1 on a headless page when a fade is used. The sound behaviour itself works: see root cause A. |
| S08 | pass | 2 | 6 | Three strings change with the locale; a missing key shows as `hud.oops`, not blank, and logs a warning. |
| S09 | pass | 3 | 8 | `pick` returns `front`, a second call without it returns `back`; a side object and an empty pixel are right too. |
| S10 | pass | 3 | 12 | 32 live of 2000 at start, 57 after a 500 m teleport with a different set; worst step 50 ms (step mode, no frame drawn per step). |
| S11 | blocked | 9 | 8 | All 500 items built, one per frame, longest job step 8.5 ms, but "no frame over 50 ms" cannot be judged: this machine goes over 50 ms with no job running at all (root cause B). |
| S12 | pass | 2 | 8 | `limitOf` gives 20; 60 added crates give `drawCalls 63 > 20`, tagged `crates`, and the game's warning shows. |
| S13 | pass | 8 | 10 | `picture compare` on vs off: saturation -92% (stated line: more than the tool's 10% threshold), brightness -17%. On vs on again after toggling back: no difference. |
| S14 | pass | 4 | 12 | From a closed room vs over the roof, same direction: draw calls 75 to 67, triangles 103849 to 34777, 12 of 72 groups hidden. Needs real-time running: see finding 2. |
| S15 | pass | 2 | 10 | Player y equals ground height at 3 points (difference 0); ball ends at y 0.56, started near 9.8. |

## Root causes, by rows blocked

| Cause | Rows | Owner |
|---|---|---|
| A. Audio state has no public read-back | S07 (fail) | engine, then docs |
| B. Wall-clock frame limits cannot be judged on a shared software renderer | S11 (blocked) | tool / test setup, not the engine |

### A. Audio state has no public read-back (engine; docs follow)
`describe()` has no audio section, `api/audio.md` lists `levels` but nothing for ducks, and the one reader, `engine.audio.info`, is marked internal and appears in no shipped doc (found by reading the source). It also reads the live `gain.value`, while a duck with a fade ramps on the audio clock. On the headless page the AudioContext says `running` but `currentTime` stays 0, so a duck with any fade reads 1 for ever. With `fade: 0` it reads 0.3 during the effect and 1 after, and the slider changes `music` only, so the logic works (by state; nothing was heard). The fix belongs in the engine: report the target level, not the node's current value, and expose it in `describe()`; rows M19 and M27 also judge audio state and may meet the same gap.

### B. Frame limits on a shared software renderer (tool / test setup)
Measured with no job at all: 500 frames, worst 79 ms, 5 over 50 ms. With the job: worst 56 to 144 ms across five runs, and a 4 ms busy loop once measured 84 ms, which is CPU contention. Step mode cannot stand in, because `step` drains the job queue in one go. The row needs a real GPU on a quiet machine, or a pass line on job step time and items per frame instead of frame time.

## Findings that failed no row

Each cost time or could mislead an AI.

| # | Finding | Owner |
|---|---|---|
| 1 | The recipe 26 pattern `settings.define(key, true, { limits: 'post.<name>.enabled' })` throws for bloom and ao, because the settings module already has those rows. The error is clear, but the recipe does not say so: use `settings.set('bloom', false)`. | docs |
| 2 | Occlusion culling never hides anything in step mode (`hidden: 0`, 72 watched), since its answers arrive over real frames. It works after `threedog resume`. Recipe 34 does not say so, and the draw count differs between the modes (150 vs 75), so a step-mode reading of `inspect perf` misleads. | docs |
| 3 | A model whose KTX2 textures failed to decode still reports `loading`: 4/4 ok and `describe().loading.ok: true`, though the docs promise `ok` means no missing references. The model arrived with no textures; the only sign is a page error with an empty reason, `Couldn't load texture`. The trigger here was a 403 on `basis_transcoder`, which sits outside the worktree through the linked `node_modules`, so the 403 is probably specific to worktrees (not checked in a plain install); the false `ok` is not. | engine |
| 4 | Asking for a model or texture before `engine.start()` on the WebGPU route gives `asset-load` with the hint "file not found (404)", while the real reason (`called before the backend is initialized`) sits in the message. | engine |
| 5 | `log()` in `threedog js --file` prints nothing when all checks pass, so values had to go through a second `js` call. | tool |
| 6 | On a page whose script failed at start, `threedog state` took 42 s to report it, with a clear message (the same wait applies to each later command), so a script of bridge commands looks hung. Measured once, under load. | tool |

## How far to trust this

- Fresh games: `new-game` ran once (about 2 minutes, most of it the check); each other row used a copy of that untouched scaffold with the name changed.
- Docs only, with exceptions: games were built from AI.md, recipes and `api/`. Engine source was read to diagnose causes (S06, S07, S13) and to find `engine.audio.info`; a real blind AI would have had no way to that reader.
- Several tests needed a second attempt because of my own mistakes, not the engine's: a line-ending bug in my runner (it produced false S06 errors, then fixed), the scaffold's `marker` prop in the S09 line of fire, and a 300 m teleport in S10 instead of 500 m.
- S06 used a small GLB written for the test, because the fixtures have no plain textured model. S11 and S14 ran in real time with `threedog resume`, the others by `step`.
- S10's stall number is step time, not a drawn frame, so it does not cover draw cost.
