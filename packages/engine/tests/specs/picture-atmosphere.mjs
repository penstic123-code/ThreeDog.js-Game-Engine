// Sky contract guards: a fog of the game's own stays, an own sky is never written.
// Same format as the other files here.
export const specs = [
  {
    name: '[guard] fog is plain three.js: look.fog is gone, scene.fog = a fog of yours sticks',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const out = {};
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        out.gone = !('look' in engine);
        // a fog of your own is plain three.js: assigning scene.fog is the one route, and nothing writes it again
        const before = engine.scene.fog, own = new before.constructor(0x123456, 5, 50); engine.scene.fog = own; engine.step(0.05);
        out.fogOwn = [engine.scene.fog === own, own.far === 50 && own.color.getHex() === 0x123456];
        engine.scene.fog = before;
        out.oneForm = err(() => engine.sky.replace(false));   // sky: replace(null)
        return out;
      });
      check('fog: scene.fog = a THREE.Fog of yours sticks', r.fogOwn[0] && r.fogOwn[1], JSON.stringify(r.fogOwn));
      check('look.fog is gone', r.gone);
      check('sky.replace(false) throws naming replace(null)', r.oneForm.includes('replace(null)'), r.oneForm);
    },
  },
  {
    // 天空 / 大气契约（core/look/state.js + modules/sky/frame.js）的"不许绕开"：自带天空引擎不写；关键帧照旧
    name: '[guard] engine.sky.replace: an own three.js sky is never written while rain still drives wind, null gives the dome back; keyframes unchanged',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const { THREE } = threedogTest, sky = engine.sky, out = {}, step = () => engine.step(0.05);
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const hex = c => c.getHex();
        // (c) baseline from the keyframes, compared again at the end after every layer is gone
        const w0 = engine.weather.name;
        engine.calendar.timeOfDay = 0.45; step();
        const base = [hex(sky.uniforms.uTop.value)];
        // fog color is independent at runtime: the dome's fog band follows by uniform, the dome shader is never rebuilt for it
        const band = () => sky.uniforms.uFogBand.value, shader0 = sky.dome.material.fragmentShader;
        engine.scene.fog = new THREE.Fog(sky.uniforms.uHorizon.value.getHex(), 20, 200);
        step(); engine.scene.fog.color.copy(sky.uniforms.uHorizon.value); step(); out.band = [band()];
        engine.scene.fog.color.set('#204060'); step(); out.band.push(band());
        engine.scene.fog = null; step(); out.band.push(band(), sky.dome.material.fragmentShader === shader0);
        // (b) the game's own sky: a ShaderMaterial dome sharing engine.uniforms; rain still drives wind and particles
        const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
          uniforms: { uSunDir: engine.uniforms.uSunDir, uDaylight: engine.uniforms.uDaylight },
          vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform vec3 uSunDir; uniform float uDaylight; varying vec3 vDir; void main(){ gl_FragColor = vec4(vec3(0.1, 0.2, 0.5) * uDaylight + pow(max(dot(vDir, uSunDir), 0.0), 64.0), 1.0); }' });
        const mine = new THREE.Mesh(new THREE.SphereGeometry(300, 16, 8), mat); mine.name = 'mySky'; mine.position.set(1, 2, 3);
        engine.scene.add(mine);   // already parented: the engine must not re-add or remove it
        const snap = () => [mine.visible, mine.parent === engine.scene, mine.position.toArray().join(), mine.material === mat, mat.version, mine.scale.x];
        const before = snap();
        sky.replace(mine);
        engine.weather.set('rain', { seconds: 0.01 });
        engine.calendar.timeOfDay = 0.3; step(); const d1 = engine.uniforms.uSunDir.value.toArray().join();
        engine.calendar.timeOfDay = 0.6; for (let i = 0; i < 5; i++) step(); const d2 = engine.uniforms.uSunDir.value.toArray().join();
        const w = engine.weather.current;
        out.own = { untouched: JSON.stringify(snap()) === JSON.stringify(before), domeHidden: !sky.dome.visible,
          sunMoves: d1 !== d2, shared: mat.uniforms.uSunDir === engine.uniforms.uSunDir, daylight: engine.uniforms.uDaylight.value,
          rain: w.rain, wind: engine.uniforms.uWind.value === w.wind, bg: engine.scene.background == null };
        sky.replace(null); step();
        out.back = { dome: sky.dome.visible, stillThere: mine.parent === engine.scene };
        engine.scene.remove(mine); mat.dispose();
        engine.weather.set(w0, { seconds: 0.01 }); for (let i = 0; i < 3; i++) step(); engine.calendar.timeOfDay = 0.45; step();   // same time, one step: the day moves with every step
        out.base = [base, [hex(sky.uniforms.uTop.value)]];
        return out;
      });
      check("[守] a fixed fog color turns the dome's fog band on by uniform, no dome recompile", r.band[1] === 1 && r.band[3] === true, JSON.stringify(r.band));
      check('(b) own three.js sky: never written (visible, parent, position, material, version), dome hidden; uSunDir / uDaylight keep flowing; rain drives wind',
        r.own.untouched && r.own.domeHidden && r.own.sunMoves && r.own.shared && r.own.daylight > 0 && r.own.rain > 0.5 && r.own.wind && r.own.bg && r.back.dome && r.back.stillThere,
        JSON.stringify([r.own, r.back]));
      check('(c) keyframes unchanged: after every layer is removed the dome top at the same time matches the start', JSON.stringify(r.base[0]) === JSON.stringify(r.base[1]), JSON.stringify(r.base));
    },
  },
];
