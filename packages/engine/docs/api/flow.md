# engine.flow — flow(opts?: FlowOptions)

Game flow and scene transitions (flow() module)

- Options `FlowOptions`:
  - `start?: string` Starting state, default 'playing'; other states are entered on engine:ready (so you can define after use())

## Methods and properties
- `flow.define(name: string, def: FlowStateDef)` — Define a state (built-in 'playing', 'paused')
- `flow.go(name: string)` — Switch state
- `flow.transition(fn: () => any, opts?: FlowTransitionOptions) → Promise<void>` — Scene transition: lock input -> fade to black -> fade out music -> autosave -> fn() -> wait for modules to be ready -> fade in -> unlock; multiple calls queue up
- Properties:
  - `state: string` Current state name
  - `transitioning: boolean` (experimental) A scene transition is in progress

## Data structures
- **FlowStateDef** A flow state (title, playing, paused, game over...)
  - `enter?: (e: Engine, from: string) => void` Called on entering
  - `exit?: (e: Engine, to: string) => void` Called on leaving
  - `freeze?: boolean` Freeze gameplay (engine.freeze, the picture keeps running), default false
  - `lockInput?: boolean` Lock game input, default false
  - `music?: string | null` Music played on entering (track name, null for silence)
- **FlowTransitionOptions** Parameters of flow.transition()
  - `fade?: number` Fade-to-black / fade-in seconds, default 0.5
  - `lockInput?: boolean` Lock input during the switch, default true
  - `music?: 'fade' | 'keep'` Music: 'fade' fades out (default) / 'keep' leaves it alone
  - `autosave?: 'auto' | false` Save to slot 'auto' before the switch: 'auto' / false (default: a game with its own save points keeps its slots)
