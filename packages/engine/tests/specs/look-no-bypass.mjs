// [guard] Look values cannot be bypassed: every way of changing a shared look value lands on its shared point, and the picture equals what
// describe().shared says. Why a guard: before the look values moved onto shared points (core/look/points.js) a game's look.lights.set covered the
// weather's multiplier, the settings menu and look.shadow.set fought over one flag, and two game owners on one fog value silently took turns.
// One page (perf city: sky, weather, settings), five rules:
//   1. the game's sun 3 under rain shows 3 x the weather's multiplier (effects apply on top of what the game set), and describe says how
//   2. the settings menu turned shadows off: a game's enabled true does not switch them on; describe names settings and lists the game's wish;
//      the other way round (settings allow, a scene turned them off) shows the scene's owner and the menu still says allowed
//   3. two game owners set fog density: a dev error naming both with copyable fixes, and nothing changed
//   4. a direct three.js write: the engine yields, describe says three (engine yielded); manual(false) hands it back
//   5. removing the weather module gives the game's values back unscaled
// Same format as the other files here.

export const specs = [
  {
    name: '[guard] look values cannot be bypassed: game set x weather mul, settings restrict, same-layer conflict, three.js yields, weather removal restores',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const out = {}, sh = n => engine.describe().shared[n], near = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        engine.calendar.timeOfDay = 0.5;   // noon: the sunset fade is 1, so only the weather multiplies
        // 1. game base x weather effect
        const W = engine.modules.get('weather');
        W.applyState(engine, { weather: 'rain' }); engine.step(0.05);
        const sun = engine.look.lights.set({ sun: { intensity: 3 } }, { owner: 'arena' }); engine.step(0.05);
        const P = engine.stacks.get('look.lights.sun.intensity'), wmul = P.holders().find(h => h.owner === 'weatherLook')?.value;
        const row = sh('look.lights.sun.intensity');
        out.sun = { light: engine.lights.sun.intensity, point: P.value(), row: row.value, wmul, writer: row.writer, how: row.how };
        out.sunOk = wmul < 1 && near(engine.lights.sun.intensity, P.value()) && near(P.value(), 3 * wmul * (P.holders().filter(h => h.op === 'mul' && h.owner !== 'weatherLook').reduce((a, h) => a * h.value, 1))) && near(row.value, P.value());
        // 2. settings restrict, never force on
        const S = engine.settings;
        S.set('shadows', false, { save: false });
        const g = engine.look.shadow.set({ enabled: true }, { owner: 'arena' }); engine.step(0.05);
        const r2 = sh('look.shadow.enabled');
        out.restricted = { on: engine.renderer.shadowMap.enabled, writer: r2.writer, also: r2.also.map(h => `${h.owner}:${h.value}:${!!h.hidden}`), menu: S.values.shadows };
        S.set('shadows', true, { save: false }); engine.step(0.05);
        out.allowed = { on: engine.renderer.shadowMap.enabled, writer: sh('look.shadow.enabled').writer };
        g.remove();
        const cut = engine.look.shadow.set({ enabled: false }, { owner: 'cutscene' }); engine.step(0.05);
        out.sceneOff = { on: engine.renderer.shadowMap.enabled, writer: sh('look.shadow.enabled').writer, menu: S.values.shadows, settingsEntry: engine.stacks.get('look.shadow.enabled').has('settings') };
        cut.remove(); engine.step(0.05);
        out.back = engine.renderer.shadowMap.enabled;
        // 3. two game owners set one value: dev error, nothing changed
        const L = engine.look.fog, d0 = L.value('density');
        const cave = L.set({ density: 0.01 }, { owner: 'cave' });
        out.clash = err(() => L.set({ density: 0.02 }, { owner: 'boss' }));
        out.clashKept = [L.value('density'), sh('look.fog.density').writer];
        cave.remove(); out.clashBack = L.value('density') === d0;
        // 4. direct three.js write yields
        engine.lights.hemi.intensity = 0.123; engine.step(0.05); engine.step(0.05);
        out.three = { v: engine.lights.hemi.intensity, writer: sh('look.lights.hemi.intensity').writer };
        engine.look.lights.manual('hemi', false); engine.step(0.05);
        out.reclaimed = { v: engine.lights.hemi.intensity, writer: sh('look.lights.hemi.intensity').writer };
        // 5. removing the weather gives the values back unscaled
        engine._unuse('weatherLook'); engine.step(0.05);
        out.noWeather = { light: engine.lights.sun.intensity, weatherEntry: P.has('weather'), fogEntry: engine.stacks.get('look.fog.far').has('weather') };
        sun.remove();
        engine._resume();
        return out;
      });
      const j = JSON.stringify(r);
      check('game sun 3 in rain: the light shows 3 x the weather multiplier, the point and describe().shared agree', r.sunOk && r.sun.writer === 'arena' && /arena 3/.test(r.sun.how) && /× weather/.test(r.sun.how), JSON.stringify(r.sun));
      check("settings turned shadows off: the game's enabled true does not switch them on; describe names settings and lists the game's wish hidden", r.restricted.on === false && r.restricted.writer === 'settings' && r.restricted.also.includes('arena:true:true') && r.restricted.menu === false, JSON.stringify(r.restricted));
      check("the menu allows them again: the game's true shows", r.allowed.on === true && r.allowed.writer === 'arena', JSON.stringify(r.allowed));
      check('settings allow, a scene turned them off: off, writer is the scene, the menu still says allowed, no settings entry', r.sceneOff.on === false && r.sceneOff.writer === 'cutscene' && r.sceneOff.menu === true && !r.sceneOff.settingsEntry && r.back === true, JSON.stringify([r.sceneOff, r.back]));
      check('two game owners set fog density: shared-conflict names both and offers another layer / taking it over, the first value stays', r.clash.includes('shared-conflict') && r.clash.includes("'cave'") && r.clash.includes("'boss'") && r.clash.includes("layer: 'effect'") && r.clashKept[0] === 0.01 && r.clashKept[1] === 'cave' && r.clashBack, JSON.stringify([r.clash, r.clashKept]));
      check('a value point (fog density) is not offered a multiplier as the fix', !/density', \{ owner: 'boss', mul/.test(r.clash), r.clash);
      check('a direct three.js write: the engine yields (value kept, writer three (engine yielded)); manual(false) gives it back', r.three.v === 0.123 && r.three.writer === 'three (engine yielded)' && r.reclaimed.v !== 0.123 && r.reclaimed.writer !== 'three (engine yielded)', JSON.stringify([r.three, r.reclaimed]));
      check("removing the weather module drops its entries: the game's sun is unscaled again", !r.noWeather.weatherEntry && !r.noWeather.fogEntry && Math.abs(r.noWeather.light - 3) < 1e-6, JSON.stringify(r.noWeather));
    },
  },
];
