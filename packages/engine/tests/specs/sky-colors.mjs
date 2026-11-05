// [guard] The sky colors a game shader reads (engine.uniforms.uSkyTop / uSkyHorizon, modules/sky/frame.js) and weather.set's instant form.
// Why: a fresh AI's sea shader wanted its horizon to follow the sky and had no public read; it copied the style's keyframes by hand
// (usability 2026-11-03 keeper). And weather.set(name, { seconds: 0.1 }) right before a headless shot drew a third of the storm: the shot
// advanced one frame. seconds: 0 is the switch at once, no step needed.
// Same format as the other files here.
export const specs = [
  {
    software: false,   // reads no pixels
    name: '[guard] sky colors: uSkyHorizon / uSkyTop follow the drawn sky (night, storm tint); weather.set seconds 0 is instant',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.haltLoop();
        const U = engine.uniforms, sky = engine.sky, out = {}, hex = c => c.getHexString();
        const read = () => ({ hor: hex(U.uSkyHorizon.value), top: hex(U.uSkyTop.value), dome: hex(sky.uniforms.uHorizon.value), domeTop: hex(sky.uniforms.uTop.value) });
        engine.weather.setAuto(false);
        engine.weather.set('clear', { seconds: 0 });
        out.instant = [engine.weather.t, engine.weather.current.rain];
        engine.calendar.timeOfDay = 0.5; engine.step(1 / 30); out.noon = read();
        engine.calendar.timeOfDay = 0.93; engine.step(1 / 30); out.night = read();
        const names = Object.keys(engine.weather.types), wet = names.find(n => (engine.weather.types[n].grey ?? 0) > 0) ?? names[0];
        engine.weather.set(wet, { seconds: 0 }); out.wet = [wet, engine.weather.t, engine.weather.name];
        engine.step(1 / 30); out.storm = read();
        out.bad = (() => { try { engine.weather.set('clear', { seconds: -1 }); return ''; } catch (e) { return e.message; } })();
        engine.weather.set('clear', { seconds: 0 });
        return out;
      });
      const same = o => o.hor === o.dome && o.top === o.domeTop;
      check('uSkyHorizon / uSkyTop are the dome colors drawn this frame (noon, night, a grey weather)',
        same(r.noon) && same(r.night) && same(r.storm), JSON.stringify([r.noon, r.night, r.storm]));
      check('the colors move with the time of day and the weather tint', r.noon.hor !== r.night.hor && r.storm.hor !== r.night.hor, JSON.stringify([r.noon.hor, r.night.hor, r.storm.hor]));
      check('weather.set(name, { seconds: 0 }) lands at once: progress 1 before any step', r.instant[0] === 1 && r.wet[1] === 1, JSON.stringify([r.instant, r.wet]));
      check('a negative seconds throws naming the option', r.bad.includes('seconds'), r.bad);
    },
  },
];
