# engine.weather — weather(opts?: WeatherOptions)

Weather (weather() module, needs sky)

- Options `WeatherOptions`:
  - `start?: WeatherName | (string & {})` Starting weather, default 'clear'
  - `auto?: boolean` Automatic weather changes
  - `particles?: number` Rain / snow particle count, default 6000
  - `presets?: Record<string, Partial<WeatherPreset>>` Add / override weather presets
  - `autoPool?: string[]` Candidates for automatic changes (repeat an entry for higher probability)
  - `autoInterval?: number[]` Interval between automatic changes [shortest, longest] seconds
  - `transition?: number` Transition seconds of automatic changes, default 25
  - `area?: number` Rain / snow coverage (meters)

## Methods and properties
- `weather.setAuto(on: boolean)` — Automatic weather on/off
- `weather.set(name: WeatherName | (string & {}), seconds?: number)` — Switch weather. seconds: transition seconds, default 15
- `weather.label(name?: string) → string` — Display name of a weather (string table weather.<name>, falls back to the name itself); defaults to the current weather
- `weather.tick(dt: number)` — Advance weather transition, automatic weather and lightning (the module calls this itself every fixed step)
- `weather.apply(camera: any)` — Write weather effects into the sky modifier layer and make rain/snow particles follow the camera (the module calls this itself every frame)
- Properties:
  - `presets: Record<string, WeatherPreset>` All weather presets
  - `current: WeatherPreset` Current (mid-transition) weather parameters
  - `name: string` Current weather name
  - `auto: boolean` Automatic weather on/off
  - `autoPool: string[]` Candidates for automatic weather (repeat a name to make it likelier)
  - `autoInterval: number[]` Automatic weather interval [min, max] seconds
  - `autoTransition: number` Transition seconds for automatic weather
  - `particles: number` Rain/snow particle count
