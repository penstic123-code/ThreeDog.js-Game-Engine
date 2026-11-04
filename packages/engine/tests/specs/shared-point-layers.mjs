// [guard] Shared points in a running game: what several owners change lands on the point, and describe().shared says the same thing the point reads.
// Why a guard: a game's set once covered another system's multiplier, the settings menu and the shadow switch fought over one flag, and two game owners on one
// value silently took turns. "The engine yields to a direct three.js write" is not here: that is owned.mjs, and engine-writes.mjs guards what the engine must not write.
// One page (perf city: sky, weather, settings), four rules:
//   1. a game's own point: its value 3 with an effect shows 3 x the effect, and describe says how; rain adds no entry, it reaches uWeatherLight
//   2. the settings menu turned shadows off: a game's enabled true does not switch them on; describe names settings and lists the game's wish;
//      the other way round (settings allow, a scene turned them off) shows the scene's owner and the menu still says allowed
//   3. two game owners set one value: a dev error naming both with copyable fixes, and nothing changed
//   4. recipe 62's shape: two owners change one picture value, one onRender reads it and writes three.js once, and they end in any order
// Same format as the other files here.

export const specs = [
  {
    name: '[guard] shared points in a running game: game set x effect mul, settings restrict shadows, same-layer conflict, weather adds no entry, one reader writes three.js',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const out = {}, sh = n => engine.describe().shared[n], near = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        // 1. game base x an effect; rain is on and adds nothing: weather writes signals, not picture values
        const W = engine.modules.get('weather');
        W.applyState(engine, { weather: 'rain' }); engine.step(0.05);
        const N = 'test.light', P = engine.stacks.define(N, { base: 1, min: 0, save: false });
        const sun = engine.mod(N, { owner: 'arena', set: 3 });
        const fx = engine.mod(N, { owner: 'cave', mul: 0.5 }); engine.step(0.05);
        const row = sh(N);
        out.sun = { point: P.value(), row: row.value, writer: row.writer, how: row.how, weather: P.holders().some(h => h.owner === 'weatherDraw'), signal: engine.uniforms.uWeatherLight.value };
        out.sunOk = near(P.value(), 1.5) && near(row.value, 1.5) && !out.sun.weather && out.sun.signal < 1;
        fx.remove();
        // 2. settings restrict, never force on
        const S = engine.settings;
        S.set('shadows', false, { save: false });
        const g = engine.mod('shadows.enabled', { owner: 'arena', set: true }); engine.step(0.05);
        const r2 = sh('shadows.enabled');
        out.restricted = { on: engine.renderer.shadowMap.enabled, writer: r2.writer, also: r2.also.map(h => `${h.owner}:${h.value}:${!!h.hidden}`), menu: S.values.shadows };
        S.set('shadows', true, { save: false }); engine.step(0.05);
        out.allowed = { on: engine.renderer.shadowMap.enabled, writer: sh('shadows.enabled').writer };
        g.remove();
        const cut = engine.mod('shadows.enabled', { owner: 'cutscene', set: false }); engine.step(0.05);
        out.sceneOff = { on: engine.renderer.shadowMap.enabled, writer: sh('shadows.enabled').writer, menu: S.values.shadows, settingsEntry: engine.stacks.get('shadows.enabled').has('settings') };
        cut.remove(); engine.step(0.05);
        out.back = engine.renderer.shadowMap.enabled;
        // 3. two game owners set one value: dev error, nothing changed
        const Q = 'test.clash', Pc = engine.stacks.define(Q, { kind: 'value', base: 'plain', save: false });
        const cave = engine.mod(Q, { owner: 'cave', set: 'mine' });
        out.clash = err(() => engine.mod(Q, { owner: 'boss', set: 'other' }));
        out.clashKept = [Pc.value(), sh(Q).writer];
        cave.remove(); out.clashBack = Pc.value() === 'plain';
        sun.remove();
        // 4. recipe 62: the example there, on a stand-in light
        const lamp = { intensity: 0 }, level = engine.stacks.define('test.level', { base: 1, min: 0, save: false });
        const off = engine.onRender(() => { lamp.intensity = 2 * level.value(); });
        const dusk = engine.mod('test.level', { owner: 'sunset', mul: 0.5 }), hold = engine.mod('test.level', { owner: 'cutscene', mul: 0.5 });
        engine.step(0.05); out.level = [lamp.intensity];
        dusk.remove(); engine.step(0.05); out.level.push(lamp.intensity);
        hold.remove(); engine.step(0.05); out.level.push(lamp.intensity);
        off.remove();
        engine._resume();
        return out;
      });
      const j = JSON.stringify(r);
      check('a game base 3 with an effect 0.5: the point and describe().shared agree on 1.5; rain added no entry and went to uWeatherLight', r.sunOk && r.sun.writer === 'arena' && /arena 3/.test(r.sun.how) && /× cave/.test(r.sun.how), JSON.stringify(r.sun));
      check("settings turned shadows off: the game's enabled true does not switch them on; describe names settings and lists the game's wish hidden", r.restricted.on === false && r.restricted.writer === 'settings' && r.restricted.also.includes('arena:true:true') && r.restricted.menu === false, JSON.stringify(r.restricted));
      check("the menu allows them again: the game's true shows", r.allowed.on === true && r.allowed.writer === 'arena', JSON.stringify(r.allowed));
      check('settings allow, a scene turned them off: off, writer is the scene, the menu still says allowed, no settings entry', r.sceneOff.on === false && r.sceneOff.writer === 'cutscene' && r.sceneOff.menu === true && !r.sceneOff.settingsEntry && r.back === true, JSON.stringify([r.sceneOff, r.back]));
      check('two game owners set one value: shared-conflict names both and offers another layer / taking it over, the first value stays', r.clash.includes('shared-conflict') && r.clash.includes("'cave'") && r.clash.includes("'boss'") && r.clash.includes("layer: 'effect'") && r.clashKept[0] === 'mine' && r.clashKept[1] === 'cave' && r.clashBack, JSON.stringify([r.clash, r.clashKept]));
      check('a value point is not offered a multiplier as the fix', !/test\.clash', \{ owner: 'boss', mul/.test(r.clash), r.clash);
      check('recipe 62: two owners dim one value, the one reader writes the product, and the first to end leaves the other on', r.level.join() === '0.5,1,2', JSON.stringify(r.level));
    },
  },
];
