# engine.weather — weather()

Weather state (weather() module): the table, current values, set / setAuto, save, events


## Methods and properties
- `weather.setAuto(on: boolean)` — Automatic weather on/off
- `weather.set(name: WeatherName, opts?: { seconds?: number })` — Switch weather. seconds: transition seconds, default 15; 0 switches at once (current is the new weather before the next step, so a screenshot or test right after shows all of it). Options in an object like every other engine call: set('rain', 20) throws [module-params] in dev (the old positional form). Example: `engine.weather.set('rain', { seconds: 20 })`
- `weather.label(name?: string) → string` — Display name of a weather (string table weather.<name>, falls back to the name itself); defaults to the current weather
- Properties:
  - `types: Record<string, WeatherPreset>` The weather types this game has: name -> numbers (the standard fields plus any of the game's own, all blended on change)
  - `current: WeatherPreset` Current (mid-transition) weather parameters
  - `name: string` Current weather name
  - `auto: boolean` Automatic weather on/off
  - `autoPool: string[]` Candidates for automatic weather (repeat a name to make it likelier)
  - `autoInterval: number[]` Automatic weather interval [min, max] seconds
  - `autoTransition: number` Transition seconds for automatic weather
  - `lightningFirst: number` Seconds to the first bolt (also after a load without a saved timer)
  - `lightningInterval: number[]` [min, max] seconds between bolts while a type with lightning > 0.5 holds
