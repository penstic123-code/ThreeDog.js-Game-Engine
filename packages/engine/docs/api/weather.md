# engine.weather — weather()

Weather state (weather() module): the table, current values, set / setAuto, save, events


## Methods and properties
- `weather.define(field: string, spec: WeatherParticles | null) → WeatherParticleSystem | null` — Draw a field of the weather table with particles: your own (ash, petals, sparks) or rain / snow in place of the built-in ones. The amount each frame is weather.current[field], so they fade with the weather. spec takes the keys of weather({ rain }), or { create(engine, { area, count }) => { object, update?(amount, { camera, time, wind }) } } for a system of your own; null gives rain / snow back to weather({ rain, snow }) and removes any other field. Defining a field again replaces it. A field no type has throws with the table's fields. Example: `engine.weather.define('ash', { shape: 'soft', color: 0x555555, size: 14, speed: 0.8, sway: 3 });`
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
  - `lightning: (flash: number, engine: any) => number` Strike picture: flash (1 at the strike, fading in a third of a second) -> sky flash amount. Write it at any time
  - `lightningBrightness: number` Multiplies the sky flash of every strike; write it at any time
  - `overcastColor: THREE.Color` Color the sky turns as a weather type raises grey: a THREE.Color, overcastColor.set(0x667788) changes it live
  - `particles: Record<string, WeatherParticleSystem>` The particle systems drawn now, by field: rain and snow when the table has them, plus what define() added. Example: `engine.weather.particles.rain.spec.speed = 30;`
