# engine.jobs (Jobs) — engine.jobs queues build work in a binary heap (higher priority first, FIFO within a priority)

- `jobs.add(work: (() => T) | (() => Generator<any, T, a…) | Generator<any, T, any> | …, opts?: { priority?, apply?, lag?, valid? }) → Promise<T>` — Add a job: a plain function runs in one go, a generator may pause at each yield until the next frame; higher priority runs first; returns the job's result. A job that changes gameplay state passes apply: the result takes effect on a fixed tick via engine.commits (lag fixed steps later, default 30), and is finished on the spot if not done by then, so machine speed does not affect gameplay. Such a job must be a plain function or generator (it cannot return a Promise). With apply, the returned Promise resolves when the work finishes, before apply may have run; put logic that needs "state already changed" inside apply. A step over slowStepMs warns in dev to slice it with yield. Example: `await engine.jobs.add(function* () { for (const p of props) { place(p); yield; } }, { priority: 10 });`
- `jobs.run(opts?: { deterministic?: boolean })` — Run the queue (the engine calls this each frame): by millisecond budget by default; deterministic: true ignores real time and drains it (used by step)
- Properties:
  - `budgetMs: number` Milliseconds allowed per frame, default 3
  - `loadingMs: number` Milliseconds allowed per frame while the loading screen is up, default 12
  - `maxSteps: number` Max steps per deterministic run (stops jobs that keep adding jobs from hanging), default 100000
  - `slowStepMs: number` A step slower than this many ms warns in dev (default 8)
  - `pending: number` Number of jobs not yet finished
