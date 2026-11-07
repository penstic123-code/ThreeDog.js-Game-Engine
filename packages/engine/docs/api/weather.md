# engine.weather — weather(opts?: WeatherOptions)

Weather state (weather() module): the table, current values, set / auto, save, events

- Options `WeatherOptions`:
  - `start?: WeatherName` Starting weather, default 'clear' (or the first of the game's types when it has no 'clear')
  - `auto?: boolean` Automatic weather changes
  - `particles?: number` Rain / snow particle count, default 6000
  - `rain?: WeatherParticles` Rain particles (default streaks: color 0xc8c8c8, opacity 0.55, length 0.7 m, speed 22 m/s, slant 1); a texture or a sprite shape draws drops
  - `snow?: WeatherParticles & { cover?: SnowCover }` Snow particles (default round sprites: color 0xffffff, opacity 0.9, size 20, maxSize 5 px, speed 1.6 m/s, sway 1.5 m), plus the cover it leaves
  - `lightning?: (flash: number, engine: Engine) => number` Strike picture: flash (1 at the strike, fading in a third of a second) -> sky flash amount; default flickers. Return 0 and draw your own bolt on the weather:lightning event for a whole replacement. Example: `lightning: f => f * f * 0.8`
  - `lightningBrightness?: number` Multiplies the sky flash of every strike, default 1
  - `overcastColor?: ColorLike` Color the sky turns as a weather type raises grey, default 0x8c8c8c
  - `types?: Record<string, Partial<WeatherPreset> & Record<string, numb…` The game's weather table, the whole list (default only a calm 'clear'; seven temperate ones in presets.weather.temperate.types, extend them with { ...presets.weather.temperate.types, dust: {...} }). Left-out fields are calm; extra numeric fields of the game's own blend too and show in weather.current
  - `autoPool?: string[]` Candidates for automatic changes (repeat an entry for higher probability)
  - `autoInterval?: number[]` Interval between automatic changes [shortest, longest] seconds
  - `transition?: number` Transition seconds of automatic changes, default 25
  - `area?: number` Rain / snow coverage (meters)
  - `lightningFirst?: number` Seconds to the first bolt once a type with lightning > 0.5 holds, default 5
  - `lightningInterval?: number[]` Seconds between later bolts [shortest, longest], default [6, 20]

## Methods and properties
- `weather.defineField(field: string, spec: WeatherParticles | null) → WeatherParticleSystem | null` — Draw a field of the weather table with particles: your own (ash, petals, sparks) or rain / snow in place of the built-in ones. The amount each frame is weather.current[field], so they fade with the weather. spec takes the keys of weather({ rain }), or { create(engine, { area, count }) => { object, update?(amount, { camera, time, wind }) } } for a system of your own; null gives rain / snow back to weather({ rain, snow }) and removes any other field. Defining a field again replaces it. A field no type has throws with the table's fields. Example: `engine.weather.defineField('ash', { shape: 'soft', color: 0x555555, size: 14, speed: 0.8, sway: 3 });`
- `weather.set(name: WeatherName, opts?: { seconds?: number })` — Switch weather. seconds: transition seconds, default 15; 0 switches at once (current is the new weather before the next step, so a screenshot or test right after shows all of it). Options in an object like every other engine call: set('rain', 20) throws [module-params] in dev (the old positional form). Example: `engine.weather.set('rain', { seconds: 20 })`
- `weather.label(name?: string) → string` — Display name of a weather (string table weather.<name>, falls back to the name itself); defaults to the current weather
- Properties:
  - `types: Record<string, WeatherPreset>` The weather types this game has: name -> numbers (the standard fields plus any of the game's own, all blended on change)
  - `current: WeatherPreset` Current (mid-transition) weather parameters
  - `name: string` Current weather name
  - `autoPool: string[]` (experimental) Candidates for automatic weather (repeat a name to make it likelier)
  - `autoInterval: number[]` (experimental) Automatic weather interval [min, max] seconds
  - `autoTransition: number` (experimental) Transition seconds for automatic weather
  - `lightningFirst: number` (experimental) Seconds to the first bolt (also after a load without a saved timer)
  - `lightningInterval: number[]` (experimental) [min, max] seconds between bolts while a type with lightning > 0.5 holds
  - `lightning: (flash: number, engine: any) => number` (experimental) Strike picture: flash (1 at the strike, fading in a third of a second) -> sky flash amount. Write it at any time
  - `lightningBrightness: number` Multiplies the sky flash of every strike; write it at any time
  - `overcastColor: THREE.Color` Color the sky turns as a weather type raises grey: a THREE.Color, overcastColor.set(0x667788) changes it live
  - `particles: Record<string, WeatherParticleSystem>` The particle systems drawn now, by field: rain and snow when the table has them, plus what defineField() added. Example: `engine.weather.particles.rain.spec.speed = 30;`
  - `auto: boolean` Automatic weather on/off.
