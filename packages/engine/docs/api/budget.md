# engine.budget (Budget) — engine.budget: performance budget (turned on by createEngine({ budget }) or enable(); off by default, costs nothing)

- `budget.enable(limits?: BudgetLimits)` — Turn on and set limits (only categories given are checked). Example: `engine.budget.enable({ drawCalls: 250, fps: 55 });`
- `budget.disable()` — Turn off
- `budget.metric(name: string, read: () => number, opts?: { limit?: number }) → Handle` — Module-defined category: read() returns the current value, opts.limit is the limit (the game's enable() takes precedence). Returns a handle { remove() }
- `budget.limitOf(name: string) → number | undefined` — Limit of a category; undefined if none was given (not checked)
- `budget.report() → BudgetReport | null` — Budget report; null when off. In the real-time loop it returns the last second's result; in step() mode it is computed on demand
- `budget.checkStartup(s: { totalMs, modules }) → { category, value, limit, top }[]` — Called by the engine when startup finishes: warns if startupMs / moduleMs is exceeded and returns the offenders (empty array if none)
- `budget.values() → Record<string, number>` — Current value per category (fps/low1/cpuMs exist only once there are frame times)
- `budget.byTag() → BudgetTagStat[]` — Estimate draw calls and triangles by userData.budgetTag (visible meshes inside the frustum; shadow casters count a second shadow draw). Returns [{ tag, drawCalls, triangles }], largest first. Called only on overrun (at most once a second) or when debugging
- Properties:
  - `enabled: boolean` Is it on?
  - `limits: BudgetLimits` Current limits
  - `cost: ApplyCost` Cost of applying background results, split in stages (see ApplyCost)

## Data structures
- **BudgetLimits** Budget limits: only the given categories are checked. fps/low1 are lower bounds (frame rate must not drop below), the rest are upper bounds
  - `drawCalls?: number` Draw calls
  - `fps?: number` Average frame rate (lower bound)
  - `low1?: number` Worst 1% frame rate (lower bound)
  - `cpuMs?: number` CPU milliseconds per frame
  - `triangles?: number` Triangle count
  - `textures?: number` Texture count
  - `chunkApplyMs?: number` Terrain chunk upload milliseconds per frame
  - `rigidBodies?: number` Rigid body count
  - `applyTransitMs?: number` Per-frame cost of applying background results, by stage (engine.budget.cost): worker transit (approximate), creating three.js objects, colliders, GPU upload (approximate), stream build()
  - `applyBuildMs?: number`
  - `applyColliderMs?: number`
  - `applyUploadMs?: number`
  - `applyStreamMs?: number`
  - `startupMs?: number` Time from opening to playable (milliseconds); when exceeded, the slowest module is named
  - `moduleMs?: number` Single module startup (init + wait for ready, milliseconds); when exceeded, that module is named
- **BudgetReport** Budget report: ok means everything is within budget
  - `ok: boolean`
  - `over: BudgetOver[]`
- **BudgetOver** One overrun: top is the biggest draw-call contributors grouped by userData.budgetTag
  - `category: string`
  - `value: number`
  - `limit: number`
  - `top: BudgetTagStat[]`
