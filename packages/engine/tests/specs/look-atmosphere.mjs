// look.fog / look.sky / look.shadow (modules/sky/lookFog.js, lookSky.js, lookShadow.js): 每个部件一条"不许绕开"——
// 走动词改了以后 describe().look 显示 game:<owner>，删掉那一层后回到 style 的值；look.shadow.set 写的是 owner 'game'。
// Same format as the other files here.
export const specs = [
  {
    name: 'look no bypass (atmosphere): fog / sky / shadow set via verb -> game:<owner>; removing that layer restores the style value',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const L = engine.look, info = () => engine.describe().look, out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        // fog: far / enabled are live; the sky writes scene.fog every frame from the resolved values
        const far0 = L.fog.value('far'), M = () => engine.stacks.get('look.fog.far').holders().filter(h => h.op === 'mul').reduce((a, h) => a * h.value, 1);   // the effects on top (weather)
        const hf = L.fog.set({ far: 100 }, { owner: 'cave' }); engine.step(0.05);
        out.fog = [info().fog.far.writer, engine.scene.fog.far, 100 * M()];
        const hd = L.fog.set({ enabled: false }, { owner: 'cave' }); engine.step(0.05);
        out.fogOff = engine.scene.fog.far > 1e6;
        hd.remove(); hf.remove(); engine.step(0.05);
        out.fogBack = [L.fog.value('far') === far0, info().fog.far.writer, engine.scene.fog.far < 1e6];
        out.fogBad = err(() => L.fog.set({ kind: 'cloudy' }));
        out.fogHook = err(() => L.fog.patch('fog', 'not glsl'));
        out.fogCat = [Object.keys(engine.catalog('look.fog').hooks ?? {}), engine.catalog('look.fog').verbs];
        // a fog of your own is plain three.js: assigning scene.fog is the one route (no look.fog.replace), the engine yields and stops writing it
        const before = engine.scene.fog, own = new before.constructor(0x123456, 5, 50); engine.scene.fog = own; engine.step(0.05);
        out.fogOwn = [engine.scene.fog === own, own.far === 50 && own.color.getHex() === 0x123456, engine.describe().owned?.fog?.writer];
        engine.scene.fog = before; L.fog.manual(false); engine.step(0.05);
        out.fogOwnBack = [engine.scene.fog === before, engine.describe().owned?.fog?.writer];
        out.oneForm = [err(() => L.fog.replace(own)), err(() => L.sky.replace(false))];   // removed verb points to scene.fog; sky: replace(null)
        // sky: live cloud uniform, a named layer (hook), backdrop
        const c0 = L.sky.value('clouds.coverage'), u = engine.sky.uniforms;
        const hs = L.sky.set({ clouds: { coverage: 0.7 } }, { owner: 'cave' });
        out.sky = [info().sky['clouds.coverage'].writer, u.uCloudCover.value];
        hs.remove(); out.skyBack = [u.uCloudCover.value === c0, info().sky['clouds.coverage'].writer];
        const glsl = 'vec4 threedogSkyLayer(vec3 d, float t, vec3 s, float n){ return vec4(0.2, 1.0, 0.5, 0.1); }';
        const hl = L.sky.patch('layer:aurora', glsl, { owner: 'cave' });
        out.layer = [info().sky['hook:layer:aurora'].writer, engine.sky.dome.material.fragmentShader.includes('threedogSkyLayer0')];
        hl.remove(); out.layerBack = !engine.sky.dome.material.fragmentShader.includes('threedogSkyLayer0');
        out.layerBad = err(() => L.sky.patch('layer:x', 'nope'));
        const hb = L.sky.set({ backdrop: 0x335577 }, { owner: 'cave' }); engine.step(0.05);
        out.backdrop = [info().sky.backdrop.writer, engine.sky.dome.visible, engine.scene.background?.getHex?.()];
        hb.remove(); engine.step(0.05); out.backdropBack = engine.sky.dome.visible;
        // shadow: set -> sun.shadow follows; set from the game is owner 'game'
        const r0 = L.shadow.value('radius'), sh = engine.lights.sun.shadow;
        const hh = L.shadow.set({ radius: 3 }, { owner: 'cave' });
        out.shadow = [info().shadow.radius.writer, sh.radius, engine.sky.shadow.radius];
        hh.remove(); out.shadowBack = [sh.radius === r0, info().shadow.radius.writer];
        engine.look.shadow.set({ bias: -0.001 }); out.alias = [info().shadow.bias.writer, sh.bias]; L.shadow._clear('game');
        out.shadowBad = [err(() => L.shadow.set({ cascades: 9 })), err(() => L.shadow.patch('x', 'y')), err(() => L.shadow.replace({}))];
        return out;
      });
      check('fog: set -> game:cave and scene.fog follows (weather scales the distance); enabled false pushes it out of reach; remove restores', r.fog[0] === 'game:cave' && Math.abs(r.fog[1] - r.fog[2]) < 1e-6 && r.fogOff && r.fogBack[0] && r.fogBack[2] && r.fogBack[1] !== 'game:cave', JSON.stringify([r.fog, r.fogOff, r.fogBack]));
      check('fog: bad kind / bad hook throw with the fix; catalog lists the fog hook and the verbs', r.fogBad.includes('look.fog.set()') && r.fogHook.includes('threedogFog') && r.fogCat[0].includes('fog') && r.fogCat[1].join() === 'set,patch,manual', JSON.stringify([r.fogBad, r.fogHook, r.fogCat]));
      check('fog: scene.fog = a THREE.Fog of yours sticks and the engine yields (writer three); manual(false) hands it back', r.fogOwn[0] && r.fogOwn[1] && /three/.test(r.fogOwn[2] ?? '') && r.fogOwnBack[0] && r.fogOwnBack[1] === 'engine', JSON.stringify([r.fogOwn, r.fogOwnBack]));
      check("one form per mechanism: look.fog.replace throws naming scene.fog = and look.fog.manual(); sky.replace(false) throws naming replace(null)", r.oneForm[0].includes('scene.fog = new THREE.Fog') && r.oneForm[0].includes('engine.look.fog.manual()') && r.oneForm[1].includes('engine.look.sky.replace(null)'), JSON.stringify(r.oneForm));
      check('sky: clouds.coverage set -> game:cave on the dome uniform; remove restores the style value', r.sky[0] === 'game:cave' && r.sky[1] === 0.7 && r.skyBack[0] && r.skyBack[1] !== 'game:cave', JSON.stringify([r.sky, r.skyBack]));
      check('sky: patch(layer:<name>) adds a dome layer (game:cave) and the shader text follows; remove takes it out; bad GLSL throws', r.layer[0] === 'game:cave' && r.layer[1] && r.layerBack && r.layerBad.includes('threedogSkyLayer'), JSON.stringify([r.layer, r.layerBack, r.layerBad]));
      check('sky: backdrop set -> game:cave, dome hidden, scene.background is the color; remove brings the dome back', r.backdrop[0] === 'game:cave' && r.backdrop[1] === false && r.backdrop[2] === 0x335577 && r.backdropBack === true, JSON.stringify([r.backdrop, r.backdropBack]));
      check('shadow: set -> game:cave and the sun shadow follows; remove restores; bad cascades / patch / replace throw', r.shadow[0] === 'game:cave' && r.shadow[1] === 3 && r.shadow[2] === 3 && r.shadowBack[0] && r.shadowBack[1] !== 'game:cave'
        && r.alias[0] === 'game' && Math.abs(r.alias[1] + 0.001) < 1e-9 && r.shadowBad[0].includes('1 (one shadow map') && r.shadowBad[1].includes('look-verb') && r.shadowBad[2].includes('look-verb'), JSON.stringify([r.shadow, r.shadowBack, r.alias, r.shadowBad]));
    },
  },
  {
    // 天空 / 大气契约（core/look/state.js + modules/sky/frame.js）的"不许绕开"：函数值只能经同一个上下文求值；自带天空引擎不写；关键帧照旧
    name: 'sky contract: function values follow engine.look.state; an own three.js sky is never written while rain still drives wind; keyframes unchanged',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const { THREE } = threedogTest, L = engine.look, sky = engine.sky, out = {}, step = () => engine.step(0.05);
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const hex = c => c.getHex();
        // (c) baseline from the keyframes, compared again at the end after every layer is gone
        const w0 = engine.weather.name;
        engine.calendar.timeOfDay = 0.45; step();
        const base = [hex(sky.uniforms.uTop.value), hex(engine.scene.fog.color), engine.lights.sun.intensity];
        // (a) function values: fog color, sun intensity, sky top read ({ state }) from the one entry engine.look.state
        const hf = L.fog.set({ color: ({ state }) => (state.boss ? '#440000' : 'horizon') }, { owner: 'boss' });
        const hl = L.lights.set({ sun: { intensity: ({ state, time }) => (state.boss ? 0.25 : 3 + time * 0) } }, { owner: 'boss' });
        const ht = L.sky.set({ top: ({ state }) => (state.boss ? '#110000' : '#3366aa') }, { owner: 'boss' });
        step(); out.calm = [hex(engine.scene.fog.color), engine.lights.sun.intensity, hex(sky.uniforms.uTop.value)];
        L.state({ boss: true }); step(); out.boss = [hex(engine.scene.fog.color), engine.lights.sun.intensity, hex(sky.uniforms.uTop.value), engine.describe().look.fog.color.writer];
        L.state({ boss: null }); step(); out.after = [hex(engine.scene.fog.color) === hex(sky.uniforms.uHorizon.value), engine.lights.sun.intensity, 'boss' in L.state()];
        hf.remove(); hl.remove(); ht.remove();
        // (a2) a function that throws or returns NaN: one dev warning naming key, owner and the bad value; the last good value stays; describe counts it
        const said = [], warn0 = console.warn; console.warn = (...a) => said.push(a.join(' '));
        try {
          L.state({ boss: { dist: 40 } });
          const hb = L.fog.set({ far: ({ state }) => state.boss.dist * 3 }, { owner: 'bossFog' });
          step(); const good = engine.scene.fog.far;
          L.state({ boss: null }); step(); step(); step();
          const d = engine.describe().look.fog.far;
          const hn = L.lights.set({ sun: { intensity: () => NaN } }, { owner: 'nanSun' }); step(); step();
          out.bad = { good, kept: engine.scene.fog.far, errors: d.fnErrors, why: d.fnError, nan: engine.describe().look.lights['sun.intensity']?.fnError,
            warns: said.filter(s => s.includes('[look-fn]')) };
          hb.remove(); hn.remove(); L.state({ boss: null });
        } finally { console.warn = warn0; }
        // fog color is independent at runtime: the dome's fog band follows by uniform, the dome shader is never rebuilt for it
        const band = () => sky.uniforms.uFogBand.value, shader0 = sky.dome.material.fragmentShader;
        step(); out.band = [band()];
        const hc = L.fog.set({ color: '#204060' }, { owner: 'fixed' }); step(); out.band.push(band());
        hc.remove(); step(); out.band.push(band(), sky.dome.material.fragmentShader === shader0);
        out.badState = err(() => L.state('boss'));
        out.notPart = Object.keys(L).includes('state');
        // (b) the game's own sky: a ShaderMaterial dome sharing engine.uniforms; rain still drives wind and particles
        const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
          uniforms: { uSunDir: engine.uniforms.uSunDir, uDaylight: engine.uniforms.uDaylight },
          vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform vec3 uSunDir; uniform float uDaylight; varying vec3 vDir; void main(){ gl_FragColor = vec4(vec3(0.1, 0.2, 0.5) * uDaylight + pow(max(dot(vDir, uSunDir), 0.0), 64.0), 1.0); }' });
        const mine = new THREE.Mesh(new THREE.SphereGeometry(300, 16, 8), mat); mine.name = 'mySky'; mine.position.set(1, 2, 3);
        engine.scene.add(mine);   // already parented: the engine must not re-add or remove it
        const snap = () => [mine.visible, mine.parent === engine.scene, mine.position.toArray().join(), mine.material === mat, mat.version, mine.scale.x];
        const before = snap();
        const hr = L.sky.replace(mine, { owner: 'mySky' });
        engine.weather.set('rain', { seconds: 0.01 });
        engine.calendar.timeOfDay = 0.3; step(); const d1 = engine.uniforms.uSunDir.value.toArray().join();
        engine.calendar.timeOfDay = 0.6; for (let i = 0; i < 5; i++) step(); const d2 = engine.uniforms.uSunDir.value.toArray().join();
        const w = engine.weather.current;
        out.own = { untouched: JSON.stringify(snap()) === JSON.stringify(before), domeHidden: !sky.dome.visible, by: engine.describe().look.sky['@replace'].writer,
          sunMoves: d1 !== d2, shared: mat.uniforms.uSunDir === engine.uniforms.uSunDir, daylight: engine.uniforms.uDaylight.value,
          rain: w.rain, wind: engine.uniforms.uWind.value === w.wind, bg: engine.scene.background == null };
        hr.remove(); step();
        out.back = { dome: sky.dome.visible, stillThere: mine.parent === engine.scene };
        engine.scene.remove(mine); mat.dispose();
        engine.weather.set(w0, { seconds: 0.01 }); for (let i = 0; i < 3; i++) step(); engine.calendar.timeOfDay = 0.45; step();   // same time, one step: the day moves with every step
        out.base = [base, [hex(sky.uniforms.uTop.value), hex(engine.scene.fog.color), engine.lights.sun.intensity]];
        return out;
      });
      check('(a) fog color / sun intensity / sky top as ({ state }) => value follow engine.look.state({ boss }); state({ boss: null }) goes back to the horizon fog',
        r.boss[0] === 0x440000 && r.boss[1] === 0.25 && r.boss[2] === 0x110000 && r.calm[0] !== 0x440000 && r.calm[1] === 3 && r.calm[2] === 0x3366aa && r.after[0] && r.after[1] === 3 && !r.after[2] && r.boss[3] === 'game:boss',
        JSON.stringify([r.calm, r.boss, r.after]));
      const b = r.bad;
      check('(a2) a function value that throws / returns NaN warns once in dev (key, owner, reason), keeps the last good value, describe().look counts fnErrors',
        b.good === 120 && b.kept === 120 && b.errors >= 3 && b.why.startsWith('bossFog: threw') && /returned NaN/.test(b.nan ?? '') && b.warns.length === 2
        && b.warns[0].includes('look.fog.far') && b.warns[0].includes("'bossFog'") && b.warns[0].includes('threw') && b.warns[1].includes('nanSun') && b.warns[1].includes('NaN'),
        JSON.stringify(b));
      check("[守] fog color switches at runtime ('horizon' -> function -> fixed -> 'horizon'): the dome's fog band turns on / off by uniform, no dome recompile",
        r.band[0] === 0 && r.band[1] === 1 && r.band[2] === 0 && r.band[3] === true, JSON.stringify(r.band));
      check('state(non-object) throws; state is not a look part',
        r.badState.includes('engine.look.state({ boss: true })') && !r.notPart, JSON.stringify([r.badState, r.notPart]));
      check('(b) own three.js sky: never written (visible, parent, position, material, version), dome hidden, describe says game:mySky; uSunDir / uDaylight keep flowing; rain drives wind',
        r.own.untouched && r.own.domeHidden && r.own.by === 'game:mySky' && r.own.sunMoves && r.own.shared && r.own.daylight > 0 && r.own.rain > 0.5 && r.own.wind && r.own.bg && r.back.dome && r.back.stillThere,
        JSON.stringify([r.own, r.back]));
      check('(c) keyframes unchanged: after every layer is removed the dome top, fog color and sun intensity at the same time match the start', JSON.stringify(r.base[0]) === JSON.stringify(r.base[1]), JSON.stringify(r.base));
    },
  },
];
