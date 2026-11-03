# engine.sky — sky(opts?: SkyOptions)

Sky dome, sun / moon light and fog drawn from the calendar's time (sky() module)

- Options `SkyOptions` (also includes the fields of Pick<StyleSky, 'shadow' | 'environment'>):
  - `fog?: boolean | StyleFog` Whether the sky makes scene.fog: true (default; the sky creates it and writes color and distance every frame) / false (scene.fog = null, never touched). An object is style.sky.fog settings (kind, color, density...) and means true. To keep the fog and write it yourself: engine.look.fog.manual() (or scene.fog = your own THREE.Fog), not an option here. Example: `sky({ fog: false })   // no fog at all`
  - `time?: string | number` The fixed time of day drawn while no calendar() is installed: 'HH:MM' or 0–1 (0.5 noon), default 0.33 (a sunset arena: sky({ time: '18:30' })). With calendar() the sky draws engine.calendar.timeOfDay and this option throws (start the day with calendar({ time }))
  - `sun?: boolean` Whether the sky drives engine.lights.sun: true (default; color, intensity, direction and shadow box from the keyframes) / false (hidden, never touched: light the world with your own three.js lights). How the game lights its world, so a sky() option, not a style key. Example: `sky({ sun: false, hemisphere: false })   // a dungeon lit by the game's own lights`
  - `hemisphere?: boolean` Same for engine.lights.hemi (ambient): true (default) / false (hidden); to write it yourself: engine.look.lights.manual('hemi')

## Methods and properties
- `sky.setShadowMapSize(n: number)` — Change shadow resolution (raise temporarily for photo mode)
- Properties:
  - `fixedTime: number` The time of day drawn while no calendar is installed (0-1; sky({ time: '17:30' }) or applyState({ time })); with engine.calendar the sky draws the calendar's time and this is unused
  - `dome: THREE.Object3D` Dome mesh
  - `sunDir: THREE.Vector3` Sun direction (unit vector toward the sun)
  - `orbit: { tilt: number; sway: number; distance: number }` Sun orbit: tilt = north-south tilt, sway = east-west swing, distance = light distance (meters)
  - `shadow: SkyShadowParams` Current shadow params (change via look.shadow.set)
  - `csm: any` three's CSM (addons/csm) while shadow.cascades > 1, else null; its lights[0] is sun (recipes/45)
  - `shadowMapSize: number` Shadow resolution (pixels)
  - `drawnTime: any` Time of day being drawn, 0-1: engine.calendar.timeOfDay, or fixedTime without a calendar. Read-only: the time itself is the calendar's
  - `sunHeight: number` Sun elevation -1 (midnight) ... 0 (horizon) ... 1 (noon) of the drawn sun (the calendar's daylight is the gameplay value)
  - `isDay: boolean` Whether the drawn sun is above the horizon (look functions: ({ sky }) => sky.isDay ? ...; gameplay reads engine.calendar.isDay)
  - `daylight: number` Daylight of the drawn sun 0-1 (0 at night, 1 at noon)
  - `environment: SkyEnvironmentInfo | null` Environment lighting now: { source, intensity, rotation, interval, builds }, null when off
