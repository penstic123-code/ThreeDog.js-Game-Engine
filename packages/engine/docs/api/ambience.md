# engine.ambience — ambience(opts?: AmbienceOptions)

Ambience (ambience() module)

- Options `AmbienceOptions`:
  - `wind?: string | string[] | false`
  - `rain?: string | string[] | false`
  - `water?: string | string[] | false`
  - `birds?: string | string[] | false` Bird calls by day: 'synth' or recordings; default off (the lowpoly style pack turns them on)
  - `crickets?: string | string[] | false` Insects at night: 'synth' or recordings; default off (the lowpoly style pack turns them on)
  - `day?: string | false`
  - `night?: string | false`
  - `synth?: Record<string, any>`

## Methods and properties
- `ambience.update(dt: number)` — Per-frame update: tunes each sound by weather, time and place (the module calls it every frame)
- Properties:
  - `cfg: Record<string, any>` Sound source config
  - `p: Record<string, any>` Synth parameters
