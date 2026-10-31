# engine.vars (Vars) — engine.vars: story flags and counters (autosaved)

- `vars.flag(key: string) → any` — Read a flag
- `vars.setFlag(key: string, value?: any)` — Set a flag (default true)
- `vars.counter(key: string) → number` — Read a counter (0 if none)
- `vars.bump(key: string, n?: number) → number` — Counter +n (default 1), returns the new value
- `vars.replace(flags?: Record<string, any>, counters?: Record<string, number>)` — Replace the contents wholesale (for loading; the object itself stays the same). A part passed as undefined is left alone
- Properties:
  - `flags: Record<string, any>` All flags
  - `counters: Record<string, number>` All counters
