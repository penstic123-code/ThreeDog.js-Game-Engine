# Soak: one game playing itself (2026-11-05)

Question: does a game that nobody touches grow when it plays for a long time? Nothing had run longer than a few minutes before.

## What runs

`packages/engine/tests/stress-field/soak.js`, called as `window.sf.soak(...)` and driven by `run.mjs soak '<json>'` (the same driver as the city runs: system Chrome, real WebGPU, true VRAM from the Windows GPU counters, a page-side count of GPU buffers and bind groups).

One round plays every action once, in fixed 1/60 s steps:

1. stream: the camera walks 400 m over terrain chunks (with vegetation), hops to a six-by-six city district 3 km away (the city blocks of the earlier city runs, streamed in by `stream.add`) and back
2. spawn: 150 world records added, shown (views built), removed; a particle burst
3. quest start, two steps done by flags, dialogue start and end, a bubble line
4. weather clear and wet, then the time of day jumps (calendar timers cross)
5. save, load, remove the slot
6. `session.newGame()`
7. scene change: `level.load(group)` with a new group

Every Nth round the whole engine is disposed and created again (new canvas, new WebGPU device). After each sampled round the page forces gc and writes one row: JS heap, listeners, fixed/frame hooks, timers, statics, stream entries, jobs, commits, geometries, textures, per-module counts, scene children, tracked GPU bytes and buffers, live bind groups, frame step time (p50, p99, max). `run.mjs` adds true VRAM every 15 s.

Two modes: real time (a rendered frame per step) and simulated (`"simulated":true`: only the first step of each action renders, 3000 steps per action, so one round is about 400 s of game time and the 120 s day cycle crosses many times).

The short version is `tests/specs/soak-guard.mjs` (`npm test -- Soak`, 8 rounds + re-create on the software WebGL backend, 17 s, 6 checks): engine counts equal in every round after the first, a re-created engine starts with the counts of the one before.

## Load on the machine

RTX 5060 Laptop GPU, Windows 11. Other agents were running the whole time: at the start CPU 32%, 33 node processes, no Chrome, 10.1 GB free; later CPU 82%, 8 Chrome processes of other agents, 7.5 GB free. My simulated run ran at the same time as the real-time one (first 20 minutes of it) and both shared the GPU, so frame times below are upper-ish numbers, not a clean benchmark. Frame time here is the CPU time of one step including the render submit, not GPU time.

## Runs

| run | command | result |
| --- | --- | --- |
| real time | `soak '{"minutes":30,"recreateEvery":10,"sampleEvery":4}'` | 30.0 min wall, 1240 rounds, 250 engine create/dispose (250 WebGPU devices made, 250 destroyed), no page error, no GPU validation error |
| simulated | `soak '{"minutes":20,"simulated":true,"stepsPerAction":3000,"recreateEvery":10,"sampleEvery":2,"seed":7}'` | 20.1 min wall, 208 rounds (about 24,000 fixed steps a round, 400 s of game time, so about 23 game hours in all; the time of day wrapped many times; the 120 s day length is short on purpose), 42 engines, no page error |

## Numbers (start / quarter / half / three quarters / end of the run)

Real time, 30 min:

| series | within an engine (sampled rounds) | right after a re-create |
| --- | --- | --- |
| JS heap after gc, MB | 20.5, 26.2, 27.6, 27.4, 28.6 | 20.9, 28.8, 28.4, 28.6, 29.0 |
| listeners | 20 all along | 19 all along |
| geometries / textures (renderer) | 23 / 7 all along | 2 / 2 all along |
| tracked GPU MB | 68 all along | 35 all along |
| true VRAM (GPU counter), MB | 236, 239, 228, 226, 237, 236, 240, 241 (flat after the first minute) | |
| fixed/frame hooks, timers, statics, stream entries, jobs | flat | flat |
| frame step p50 / p99 ms | 1.0-1.6 / 14-23 | |
| tracked GPU buffers | 173, 235, 297, 359, 419 | 10, 72, 134, 196, 256 |

Simulated, 20 min: counts flat as above; heap within an engine 21.8, 35.2, 38.7, 39.8, 41.6 (the long steps hold more transient garbage than the 30-step rounds), at re-create 20.5, 26.9, 28.4, 28.0, 29.5; true VRAM 198-240 MB, flat after the first minute.

## Findings

- No count that the engine owns rises after warm-up: listeners, hooks, timers, statics, stream entries, jobs, commits, geometries, textures, module counts, scene children, tracked GPU bytes. No engine fix came out of this run, so no CHANGELOG line.
- Heap climbs about 8 MB in the first minute (shader and pipeline caches, the first chunks) and then stays within 1.5 MB over 30 minutes. True VRAM flat. Both match "warm-up, then flat".
- Tracked GPU buffers rise by about one per engine re-create (10 to 256 over 250 engines) and so does the within-engine number (it carries the earlier engines' share). Not a leak by the numbers that matter: the 250 WebGPU devices were all destroyed (`device.lost` reason `destroyed`), and the true VRAM counter is flat. The page-side counter only subtracts on `buffer.destroy()`, so a buffer that dies with its device is counted as alive. One buffer per device is probably created by three's WebGPU backend (not found which one in this time box; `"kinds":true` in the soak parameters now prints the live buffers by usage and size for the next look).
- Frame step worst case (max) is 60-95 ms in the real-time run: the first frame after each re-create and each city hop (shader compile and building a block), not a growing tail; p99 stays 6-23 ms.
- Not covered: the physics engine (rapier), audio, net, a real browser tab in the background, mobile. Day cycle was exercised by the simulated run only.

## Release use

`docs/plans/release-checklist.md` lists both commands. A number that rises after warm-up in any column is a bug to fix before release.

## 0.8.0 release run (2026-11-05, branch release/0.8.0)

Simulated only: `soak '{"minutes":20,"simulated":true,"stepsPerAction":3000,"recreateEvery":10,"sampleEvery":2}'`. The 30-minute real-time run was skipped for this release and runs before 1.0.

20.1 min wall, 209 rounds, 42 WebGPU devices, RTX 5060 Laptop GPU. Not a quiet machine: the long fuzz, the packed install and other test runs shared it, and those test runs rebuilt the same `dist` folder this run was served from. The run finished with `aborted: null` and no page error. Its console log has one 404 and one `threads-crash` (a worker fell back to the main thread); the rebuild is the likely cause, not confirmed.

| series | start / quarter / half / three quarters / end |
| --- | --- |
| listeners, hooks, timers, statics, stream entries, jobs, geometries, textures, scene children | flat (20, 0/1, 0, 1, 36, 0, 24, 7, 60) |
| tracked GPU MB | 69 all along (35 after a re-create) |
| true VRAM (GPU counter), MB | 192.8 to 227.2, no trend (193 at the start, 219.5 at the end) |
| JS heap after gc, right after a re-create, MB | 23.3, 29.4, 29.5, 29.9, 29.9 (28.0 to 30.9 after warm-up) |
| JS heap after gc, within an engine, MB | 32.7, 34.5, 40.3, 41.6, 44.2, a sawtooth (34.9 to 44.2 in the second half) |
| tracked GPU buffers after a re-create | 10 to 48, about 1 per engine, as in the first run |

No count the engine owns rises. Heap after a re-create still drifts about 0.14 MB per engine after warm-up (about 2 MB over 15 minutes), the same shape as the first run's 26.9 to 29.5. It is small and inside the noise of this run, so it is not called a leak and not called flat: the 30-minute real-time run before 1.0 should look at it.
