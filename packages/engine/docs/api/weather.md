# engine.weather — weather(opts?: WeatherOptions)

Weather (weather() module, needs sky)

- Options `WeatherOptions`:
  - `start?: WeatherName` Starting weather, default 'clear' (or the first of the game's types when it has no 'clear')
  - `auto?: boolean` Automatic weather changes
  - `particles?: number` Rain / snow particle count, default 6000
  - `types?: Record<string, Partial<WeatherPreset> & Record<string, numb…` The game's weather table, the whole list (default only a calm 'clear'; seven temperate ones in presets.weather.temperate.types, extend them with { ...presets.weather.temperate.types, dust: {...} }). Left-out fields are calm; extra numeric fields of the game's own blend too and show in weather.current
  - `autoPool?: string[]` Candidates for automatic changes (repeat an entry for higher probability)
  - `autoInterval?: number[]` Interval between automatic changes [shortest, longest] seconds
  - `transition?: number` Transition seconds of automatic changes, default 25
  - `area?: number` Rain / snow coverage (meters)

## Methods and properties
- `weather.define(_field: string, _spec?: import("../../../style").StyleWeath…) → never` — Renamed in 0.2: throws and names the new call, engine.look.weather.replace({ [field]: spec }) (recipes/44-water-weather-look-hooks.md)
- `weather.setAuto(on: boolean)` — Automatic weather on/off
- `weather.set(name: WeatherName, seconds?: number)` — Switch weather. seconds: transition seconds, default 15
- `weather.label(name?: string) → string` — Display name of a weather (string table weather.<name>, falls back to the name itself); defaults to the current weather
- Properties:
  - `types: Record<string, WeatherPreset>` The weather types this game has: name -> numbers (the standard fields plus any of the game's own, all blended on change)
  - `current: WeatherPreset` Current (mid-transition) weather parameters
  - `name: string` Current weather name
  - `auto: boolean` Automatic weather on/off
  - `autoPool: string[]` Candidates for automatic weather (repeat a name to make it likelier)
  - `autoInterval: number[]` Automatic weather interval [min, max] seconds
  - `autoTransition: number` Transition seconds for automatic weather
  - `particles: number` Default particle count per system (halved on low-tier devices)
  - `systems: Map<string, any>` Particle systems drawn now: field -> { field, object, uniforms } (rain / snow when the table has them, plus define())
