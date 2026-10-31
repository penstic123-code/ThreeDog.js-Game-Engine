# engine.sky — sky(opts?: SkyOptions)

Sky, day/night, calendar (sky() module)

- Options `SkyOptions` (also includes the fields of StyleSky):
  - `time?: number` Time of day at start: fraction of a day 0–1 (0.5 noon), default 0.33 (afterwards read / write engine.sky.timeOfDay)
  - `dayLength?: number` Game seconds per day, default 360 (one sky hour = dayLength / hoursPerDay game seconds; with timeScale 1 game seconds are fixed-step seconds); Infinity = the time of day never moves
  - `day?: number` Which day to start from, default 1
  - `daysPerSeason?: number` Days of each season given by name only, default 7
  - `seasons?: (string | { name: string, days: number })[]` The calendar's seasons, default none ([]): names (each daysPerSeason days) or { name, days } for seasons of their own length, e.g. ['spring', 'summer', 'autumn', 'winter']

## Methods and properties
- `sky.modify(owner: string, values: SkyLayer | null)` — Write a modifier layer (only the given fields; unwritten fields have no effect); values null removes the layer. Weather uses the 'weather' layer, games use their own layer name. Layers composite every frame: sun / ambient / fog multiply; tint blends weighted by tintAmount; flash takes the max. Example: `engine.sky.modify('cave', { sun: 0.3, ambient: 0.4 });  engine.sky.modify('cave', null);`
- `sky.at(clock: string | number, fn: (day: number) => void, opts?: SkyAtOptions) → Handle` — Call fn every day at a clock time: at('18:00', fn) or at(0.75, fn). Fires only when time moves forward across the clock time: natural flow, step fast-forward and setting timeOfDay later all count; crossing several triggers at once is replayed per catchUp; rewinding time and loading a save do not fire, they only reset the baseline. To hold a state during a time range (lights, shop door) use between
- `sky.between(from: string | number, to: string | number, opts: SkyBetweenOptions) → Handle` — Time-range switch: on() while clock time is in [from, to), otherwise off() (from > to wraps midnight). Aligns once immediately on registration, new game, load, applying a scenario and time rewind; afterwards it calls on/off when crossing a boundary. Example: `engine.sky.between('18:00', '06:00', { on: () => lamp.on(), off: () => lamp.off() })`
- `sky.daily(fn: (day: number) => void, opts?: SkyAtOptions) → Handle` — Call fn(day) at the start of each day (00:00)
- `sky.onSeason(name: string, fn: (season: string) => void) → Handle` — Call fn(seasonName) on entering season name
- `sky.setShadow(opts?: Pick<StyleShadow, "bias" | "normalB…)` — Change shadow params (only the given fields): bias / normalBias prevent banding; updateEvery updates shadows every N frames (1 = every frame); snap snap = shadow center snap grid (meters, or 'texel' to snap to shadow pixels); ahead = meters to shift the shadow center in front of the view
- `sky.setShadowMapSize(n: number)` — Change shadow resolution (raise temporarily for photo mode)
- Properties:
  - `timeOfDay: number` Sky time of day: 0-1 (0 midnight, 0.25 6am, 0.5 noon, 0.75 6pm); one day = dayLength game seconds (the unit of engine.clock.now). Fixed-step seconds (unaffected by timeScale) are engine.elapsed
  - `dayLength: number` Game seconds per day (1 sky hour = dayLength / 24 game seconds; at timeScale 1 game seconds equal fixed-step seconds); Infinity = the time of day never moves
  - `day: number` Day number (1-based)
  - `daysPerSeason: number` Days per season for seasons given by name only
  - `seasons: string[]` Season names, [] when the game has no seasons (the default)
  - `dome: THREE.Object3D` Dome mesh
  - `hemi: any` Hemisphere ambient light (engine.lights.hemi, driven by the sky)
  - `sun: any` Sun directional light (engine.lights.sun driven by the sky; moonlight at night, shadows live on it)
  - `sunDir: THREE.Vector3` Sun direction (unit vector toward the sun)
  - `orbit: { tilt: number; sway: number; distance: number }` Sun orbit: tilt = north-south tilt, sway = east-west swing, distance = light distance (meters)
  - `shadow: { bias, normalBias, updateEvery, snap, ahead }` Current shadow params (change via setShadow)
  - `hoursPerDay: number` Hours per day
  - `modifiers: SkyModifiers` Composite of all modifier layers (read-only; use modify to adjust brightness)
  - `shadowMapSize: number` Shadow resolution (pixels)
  - `clock: string` Clock text, e.g. "18:00"
  - `sunHeight: number` Sun elevation -1 (midnight) ... 0 (horizon) ... 1 (noon). Day/night is computed only here; other modules read isDay / daylight
  - `isDay: boolean` Whether it is daytime (sun above the horizon)
  - `daylight: number` Daylight amount 0-1 (0 at night, 1 at noon); ambience etc. fade by it
  - `seasonIndex: number` Current season index, -1 without seasons
  - `season: string | null` Current season name, e.g. 'spring'; null without seasons
  - `dayOfSeason: number` Day within the season (1-based); 0 without seasons
  - `seasonProgress: number` Fraction of the season elapsed, 0-1 (includes time of day); 0 without seasons
  - `totalDays: number` Total game time in days (fractional), for growth, cooldowns and the like

## Data structures
- **SkyAtOptions** Parameters of sky.at() / daily()
  - `days?: number[] | ((day: number) => boolean)` Only fire on these days: a list of days, or (day) => whether to fire
  - `catchUp?: 'all' | 'once' | 'skip'` When one advance crosses several trigger points: 'all' fire them all / 'once' fire once (default) / 'skip' do not make up
- **SkyBetweenOptions** Callback of sky.between: on is called when entering the period, off when leaving it
  - `on?: () => void` Entering the period (or found inside it when aligned)
  - `off?: () => void` Leaving the period (or found outside it when aligned)
