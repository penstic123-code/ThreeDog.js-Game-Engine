# engine.ambience — ambience(opts?: AmbienceOptions)

Ambience (ambience() module)

- Options `AmbienceOptions`:
  - `rules?: import('./core').AmbienceRule[]`
  - `interval?: number`

## Methods and properties
- `ambience.add(rule: AmbienceRule) → { remove(): void }` — Add one rule; returns a handle whose remove() fades the sound out and drops the rule. Example: `const h = engine.ambience.add({ sound: 'storm-wind', when: { weather: 'storm' }, volume: 0.5 });`
- `ambience.rules(list: AmbienceRule[] | null)` — Replace the whole rule table (null or [] = silence)
- `ambience.nearWater(radius?: number) → number` — How much of the ground within `radius` meters of the listener is water (0-1), sampled at 6 points: for a water rule's volume. Example: `{ sound: 'river', volume: (e, a) => a.nearWater(20) * 0.12 }   // in data: volume: { add: { nearWater: 0.12 } } (12 m)`
- Properties:
  - `position: THREE.Vector3` Where the sounds are heard from: whoever the player controls (engine.actor), else the camera focus
  - `info: { sound: string; on: boolean; volume: number }[]` What each rule is doing (debug, tests): sound name, whether its condition holds, its current target volume
