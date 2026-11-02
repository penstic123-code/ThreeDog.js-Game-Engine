# engine.hud — hud(opts?: HudOptions)

Objective markers, counters, progress bars (hud() module)

- Options `HudOptions`:
  - `questMarkers?: boolean` Show a marker automatically when the current quest step has a target, default true

## Methods and properties
- `hud.marker(target: HudTarget, opts?: HudMarkerOptions) → HudMarker` — Add an objective marker: target is an object, position or place name
- `hud.counter(id: string, opts: { label?, icon?, value?, max?, anchor? })` — Counter or text status (calling again with the same id = update; calling every frame is fine): counter('fish', { label: '鱼', value: 2, max: 5 }), counter('clock', { value: '08:30' }); no value = the label alone
- `hud.bar(id: string, opts: { value, max?, label?, anchor? })` — Progress bar (calling again with the same id = update; calling every frame is fine, the DOM is untouched when the value is unchanged), value/max 0–max
- `hud.remove(id: string)` — Delete a counter or progress bar
- Properties:
  - `markers: HudMarker[]` All markers

## Data structures
- **HudMarkerOptions** Objective marker parameters
  - `label?: string | (() => string)` Text
  - `icon?: string` Icon (text or image URL)
  - `offscreen?: 'arrow' | 'hide'` When the target is off screen: 'arrow' an arrow at the screen edge (default) / 'hide' not shown
  - `distance?: boolean` Show the distance, default true
  - `height?: number` How high the marker floats above the target (meters)
- **HudMarker** Marker returned by hud.marker()
  - `target: HudTarget`
  - `dist: number | null` Distance in meters from the player (from the focus when there is no player)
  - `visible: boolean` Shown this frame (false when the target is missing, off screen with offscreen 'hide', or before the first frame)
  - `part: import('./core').UIPart | null` The UI part drawing it (null when hud.marker is turned off); the default part has .el
  - `onScreen: boolean` On screen (otherwise an edge arrow is shown or it is hidden)
  - `set(opts: HudMarkerOptions)` — Change parameters
  - `setTarget(target: HudTarget)` — Change the target (the marker itself is not rebuilt)
  - `remove()` — Delete
