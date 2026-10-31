---
paths:
  - "packages/engine/modules/**"
  - "packages/engine/render/**"
  - "packages/engine/core/**"
---

# Performance limits

- How to measure and the reference numbers are in `packages/engine/docs/PERF.md`; on real devices use the F3 panel. The budget monitor `engine.budget` is off by default; the game sets the limits (`createEngine({ budget: { drawCalls: 250, fps: 55, low1: 30 } })`).
- Workers are created only through `engine.threads.lane({ create, local })`; worker results that affect gameplay apply through `engine.commits`. Heavy far simulation: `world.simulate(kind, { far, worker: true })`, `far` self-contained (only `(rec, dt)` and globals like Math).
- Generation work goes to a Worker / `engine.jobs` / `engine.stream` (chunk upload; jobs default to 3 ms per frame). To find what is slow: `engine.profile(true)`, then `engine.profile()`.
