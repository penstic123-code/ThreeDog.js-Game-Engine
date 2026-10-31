# Add weather or change the sky

Modules: `sky()` (day/night, sun and moon, fog, calendar), `weather()` (needs sky; the game's weather types, smooth transitions, rain and snow, lightning). All look data lives in the style pack; the engine has only a neutral fallback.

## 1. Switching weather / automatic weather (main.js)
```js
engine.weather.set('rain', 20);          // transition to rain over 20 seconds (a type of the game's table, see 2)
engine.weather.setAuto(true);            // change weather at random (openWorld({ camera: 'follow', autoWeather: true }) also works)
engine.events.on('weather:lightning', () => { /* thunder */ });
```

## 2. The game's own weather table (example: a desert)
`weather({ types })` is the whole list of the game's weather; without it there is only a calm `clear` (the engine assumes no climate). Seven temperate ones (clear cloudy overcast rain storm snow fog) are an opt-in preset: `weather(presets.weather.temperate)`; extend with `types: { ...presets.weather.temperate.types, dust: {...} }`.
Left-out fields are calm (no cloud, rain, snow, grey, lightning; sun, fog, wind 1). The style pack's `style.weather.types` only retunes types the game has.
```js
import { createEngine, presets, sky, weather } from 'threedog';
engine.use(sky(), weather({
  types: { clear: { cloud: 0.1 }, dust: { cloud: 0.5, sun: 0.6, fog: 0.35, wind: 2.2, grey: 0.4, heat: 1 } },   // heat: a field of the game's own, blends too
  autoPool: ['clear', 'clear', 'dust'],     // candidates for automatic weather (repeats = higher probability; default: each type once)
}));
engine.weather.set('dust', 15);  engine.weather.current.heat;   // 0..1 during the change
```
Fields: `cloud` cloud cover 0-1, `sun` sunlight multiplier, `fog` fog distance multiplier (smaller = denser fog), `wind` wind strength, `rain`/`snow` 0-1, `grey` how gray the sky turns, `lightning` lightning. A table where nothing rains or snows builds no particles.
With openWorld the weather module is already installed; pass its options through the preset: `openWorld({ camera: 'follow', weather: { types, autoPool } })`.

## 3. Changing sky colors, sun, stars (style pack)
`sky.keyframes` in the style pack (lowpoly: its `index.js`): `[time 0-1, zenith color, horizon color (= fog color), sunlight color, sunlight intensity, ambient intensity]`, interpolated by time;
also `sunSize sunGlow moonSize starDensity clouds skybox shadow` (see the comments in lowpoly for what they mean; `hoursPerDay` is timing, so it is a `sky()` option, not a style key). The look of rain and snow is in `style.weather.rain / snow`.

## 4. Time and brightness (game code)
```js
engine.sky.timeOfDay = parseClock('19:30');    // jump to a time (0-1)
engine.clock.timeScale = 0;                 // sky and game seconds stop together (2 = double speed); game seconds per day: sky({ dayLength: 600 }); the three kinds of time are in recipe 06
engine.setFogFar(300);                    // base fog distance (meters); weather scales it
```
The calendar is the game's: `sky()` alone keeps one time of day (dungeon, arena, space); a day-night cycle is `sky({ dayLength: 360 })` or `sky(presets.calendar.cycle)` (`presets.calendar.fourSeasons` includes it); `hoursPerDay` changes the clock face. An audio rule's `time` condition takes `'day'`, `'night'` or a range `['18:00', '06:00']`; anything else warns once.
Seasons are off by default (`engine.sky.season` is `null`, no `season:change`); name them to turn them on:
```js
sky({ seasons: ['spring', 'summer', 'autumn', 'winter'], daysPerSeason: 28 });     // or the preset: openWorld({ camera: 'follow', sky: presets.calendar.fourSeasons })
sky({ seasons: [{ name: 'wet', days: 10 }, { name: 'dry', days: 20 }] });          // seasons of their own length
```
**Don't modify directly** `sky.sun.intensity / color`, `sky.hemi`, `scene.fog`: the sky recomputes them every frame and overwrites your change (the console warns about it during development).
To darken or tint everything (a cave, a horror segment), write a modifier layer of your own; it stacks with the weather's 'weather' layer without overwriting it:
```js
engine.sky.modify('cave', { sun: 0.3, ambient: 0.4, fog: 0.5 });     // enter the cave: layers multiply
engine.sky.modify('cave', { tint: 0x402030, tintAmount: 0.5 });       // changes only the given fields (this layer's sun/ambient stay)
engine.sky.modify('cave', null);                                      // leave the cave: remove this layer
```
`sun / ambient / fog` multiply across layers, `tint` is blended weighted by `tintAmount` (zenith) / `horizonTintAmount` (horizon), and `flash` takes the maximum.
Write once and it stays in effect; no need to write every frame. For a gradual change, write a new value every frame. `engine.sky.modifiers` is the combined result and is read-only (changing it directly triggers a warning during development).

## 5. Verify
- Text: `npm run shot -- / --time 19:30 --weather dust --wait 2 --describe-only`, then look for "Time: 19:30..." and "Weather: dust (rain 0, snow 0, fog 0.35)".
  `describe().weather` has `name progress rain snow fog wind cloud`; `describe().time` has `clock day season isDay dayLength timeScale`.
- Take a screenshot only after the look changed: `npm run shot -- / --time 19:30 --weather dust`. Related test: `npm test -- 现场参数`.

## 6. Day and night in game logic
Day and night come only from the sky: test `engine.sky.isDay`, and fade with `engine.sky.daylight` (0-1). Don't decide it from the clock time yourself, so a game with different day lengths or seasons stays right. Lights and shop doors that follow the time of day use `engine.sky.between(...)` (its page: `api/sky.md`).
