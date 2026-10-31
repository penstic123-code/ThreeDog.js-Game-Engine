# Add weather or change the sky

Modules: `sky()` (day/night, sun and moon, fog, calendar), `weather()` (needs sky; weather presets, smooth transitions, rain and snow, lightning). All look data lives in the style pack; the engine has only a neutral fallback.

## 1. Switching weather / automatic weather (main.js)
```js
engine.weather.set('rain', 20);          // transition to rain over 20 seconds. Built in: clear cloudy overcast rain storm snow fog
engine.weather.setAuto(true);            // change weather at random (openWorld({ autoWeather: true }) also works)
engine.events.on('weather:lightning', () => { /* thunder */ });
```

## 2. Adding a kind of weather (example: dust)
Game-specific presets go in `weather({ presets })`; ones every game wants that belong to the "art style" go in the style pack's `style.weather.presets`. Omitted fields use the values of clear.
```js
import { createEngine, sky, weather } from 'threedog';
engine.use(sky(), weather({
  presets: { dust: { cloud: 0.5, sun: 0.6, fog: 0.35, wind: 2.2, rain: 0, snow: 0, grey: 0.4, lightning: 0 } },
  autoPool: ['clear', 'clear', 'cloudy', 'dust'],     // candidates for automatic weather (repeats = higher probability)
}));
engine.weather.set('dust', 15);
```
Fields: `cloud` cloud cover 0-1, `sun` sunlight multiplier, `fog` fog distance multiplier (smaller = denser fog), `wind` wind strength, `rain`/`snow` 0-1, `grey` how gray the sky turns, `lightning` lightning.
With openWorld the weather module is already installed; pass its options through the preset: `openWorld({ weather: { presets, autoPool } })`.

## 3. Changing sky colors, sun, stars (style pack)
`sky.keyframes` in `styles/<style pack>/index.js`: `[time 0-1, zenith color, horizon color (= fog color), sunlight color, sunlight intensity, ambient intensity]`, interpolated by time;
also `sunSize sunGlow moonSize starDensity hoursPerDay clouds skybox shadow` (see the comments in lowpoly for what they mean). The look of rain and snow is in `style.weather.rain / snow`.

## 4. Time and brightness (game code)
```js
engine.sky.timeOfDay = parseClock('19:30');    // jump to a time (0-1)
engine.clock.timeScale = 0;                 // sky and game seconds stop together (2 = double speed); game seconds per day: sky({ dayLength: 600 }); the three kinds of time are in recipe 06
engine.setFogFar(300);                    // base fog distance (meters); weather scales it
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
