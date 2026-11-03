# engine.weatherLook — weatherLook()

Weather look (installed by weather(), needs sky): rain / snow particle systems, lightning flash, the weather's effect on sun, fog and sky


## Methods and properties
- Properties:
  - `flash: number` Sky flash now, 1 at a strike (the weather:lightning event) fading to 0
  - `particles: number` Default particle count per system (halved on low-tier devices)
  - `systems: Map<string, any>` Particle systems drawn now: field -> { field, object, uniforms } (rain / snow when the table has them, plus fields look.weather.replace adds)
