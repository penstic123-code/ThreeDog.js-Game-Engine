# engine.timeline — timeline(opts?: TimelineOptions)

Cutscenes, tweens (timeline() module)

- Options `TimelineOptions`:
  - `skipKeys?: string[]` Keys that skip a cutscene, default ['Escape', 'Backspace'] (Esc is the back key, which the UI focus stack hands to the topmost cutscene; cutscenes do not advance while frozen)

## Methods and properties
- `timeline.tween(target: any, to: TweenTo, duration?: number, ease?: Ease) → TweenPromise` — General tween (the only entry point for tweens in the engine): await engine.timeline.tween(mesh, { 'position.y': 2 }, 1, 'outCubic'); duration in seconds. Returns a Promise (with finish()/cancel())
- `timeline.play(steps: TimelineStep | TimelineStep[], opts?: TimelinePlayOptions) → Promise<{ skipped: boolean }>` — Play a timeline; resolves with { skipped } when it ends
- `timeline.skip(run?: any)` — Skip all (or one) playing timelines
- Properties:
  - `skipAll: boolean` Skip every cutscene immediately (set by scenario param cutscene=skip)
  - `playing: boolean` Whether a cutscene is playing

## Timeline steps (engine.timeline.play([...]))
- **TimelineStep** Timeline steps (run in order), which can be any of the following:
  - `TimelineStep[]`
  - `((engine: Engine, run: any) => any)`
  - `{ parallel: TimelineStep[] }`
  - `{ sequence: TimelineStep[] }`
  - `{ wait: number }` — Wait some seconds
  - `{ waitFor: string, timeout? }` — Wait for an event; timeout is the maximum seconds to wait
  - `{ do: (engine: Engine, run: any) => any }` — Run a piece of code (may be async)
  - `{ tween: { target: any; to: TweenTo; duration?: number; ease?: Ease } }` — Tween: target is the object, to the target values, duration in seconds
  - `{ camera: { from?, to?, duration?, ease?, fov?, release? } | { release: true } }` — Camera: from/to end points, duration in seconds, fov target field of view; or { release: true } to hand the camera back
  - `{ path: { object, points, duration?, ease?, lookAhead?, ground?, … } }` — Move an object (or character, or camera) along a path: points are the path points, duration in seconds, lookAhead how far ahead to look (0–1), ground snaps to the ground (a number = height above ground)
  - `{ fade: number, to? }` — Full-screen fade: fade is the seconds, to is the target cover (0 transparent ... 1 full black, default 1)
  - `{ say: { speaker?, text?, nodes?, node? } }` — Say a line of dialogue (needs the dialogue module) and wait for the dialogue to end

## Data structures
- **TimelinePlayOptions**
  - `skippable?: boolean` Can be skipped, default true
  - `letterbox?: boolean` Letterbox bars, default false
  - `lockInput?: boolean` Lock player input while playing, default true
- **CameraPose** One end point of a camera move
  - `position?: Vec3Like` Camera position
  - `lookAt?: Vec3Like | Object3D` The point to look at, or a moving object
  - `fov?: number` Field of view (degrees)
