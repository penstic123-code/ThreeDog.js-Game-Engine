// [guard] The sky gives signals and draws its dome; it writes nothing on the picture (plan 2026-11-04, rule 1).
// Why a guard: a sky that repainted the hemisphere light every frame made a warm wall black at night, in a game that had never written that light.
// A value with two writers is the bug, so the check is on three.js itself, not on any engine table: run a whole day and read the objects.
const PAGE = '/tests/threads/';

export const specs = [
  {
    name: '[guard] sky writes nothing: 10 s across day and night (and into rain), every light, scene.fog, tone mapping and environment stay as they were, while the signals move',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const E = mk(createEngine, 'sky-writes-nothing');
        // dayLength 10: the 10 seconds below are one whole day, noon through midnight and back
        E.use(T.calendar({ time: '12:00', dayLength: 10 }), T.sky(), T.weather({ types: { clear: {}, rain: { rain: 1, cloud: 0.8, sun: 0.4, fog: 0.5 } } }));
        const own = new THREE.DirectionalLight(0xffaa66, 1.5); own.position.set(3, 8, 2); E.scene.add(own, own.target);
        E.scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0x888888 })));
        await E.start();
        const v = new THREE.Vector3(), r5 = x => +x.toFixed(5);
        const dirOf = l => (l.target ? v.subVectors(l.position, l.target.position).normalize().toArray().map(r5) : null);   // the shadow box moves with the focus, the direction must not
        const lights = () => { const out = []; E.scene.traverse(o => { if (o.isLight) out.push([o.type, o.intensity, o.color.getHex(), o.groundColor?.getHex() ?? null, dirOf(o)]); }); return out; };
        const s = E.scene, R = E.renderer;
        const picture = () => JSON.stringify({ lights: lights(), fog: s.fog, exposure: R.toneMappingExposure, tone: R.toneMapping, env: s.environment?.uuid ?? null, envI: s.environmentIntensity });
        const first = picture(), U = E.uniforms, sun0 = U.uSunDir.value.clone();
        let changed = null, dayMin = 1, dayMax = 0, sunMoved = 0, lightMin = 1, fogMin = 1;
        for (let i = 0; i < 40; i++) {
          if (i === 20) E.weather.set('rain', { seconds: 0 });
          E.step(0.25);
          const now = picture();
          if (now !== first && !changed) changed = { at: i, first, now };
          dayMin = Math.min(dayMin, U.uDaylight.value); dayMax = Math.max(dayMax, U.uDaylight.value);
          sunMoved = Math.max(sunMoved, U.uSunDir.value.distanceTo(sun0));
          lightMin = Math.min(lightMin, U.uWeatherLight.value); fogMin = Math.min(fogMin, U.uWeatherFog.value);
        }
        const out = { changed, lightCount: lights().length, first, dayMin, dayMax, sunMoved, lightMin, fogMin };
        E.dispose();
        return out;
      });
      check('the scene has lights to watch (the placeholders and the game\'s own)', r.lightCount === 3, r.first);
      check('no picture value changed in the whole day', r.changed === null, JSON.stringify(r.changed));
      check('with no ask there is no fog, no tone curve, no environment map', /"fog":null/.test(r.first) && /"tone":0/.test(r.first) && /"env":null/.test(r.first), r.first);
      check('uDaylight went from day to night', r.dayMax > 0.9 && r.dayMin === 0, JSON.stringify([r.dayMin, r.dayMax]));
      check('uSunDir moved', r.sunMoved > 1, String(r.sunMoved));
      check('the weather reached the signals instead (uWeatherLight, uWeatherFog)', r.lightMin === 0.4 && r.fogMin === 0.5, JSON.stringify([r.lightMin, r.fogMin]));
    },
  },
  {
    name: '[guard] weather signals come from the state half: a game that replaced the weather drawing still gets uWeatherLight / uWeatherFog',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const E = mk(createEngine, 'weather-signals-own-picture');
        E.use(T.calendar({ time: '12:00' }), T.sky(), T.weather({ types: { clear: {}, rain: { rain: 1, sun: 0.4, fog: 0.5 } } }));
        E.use({ name: 'myRain', type: 'picture', provides: ['weatherDraw'], install() { return {}; } }, { replaces: 'weatherDraw' });
        await E.start();
        E.weather.set('rain', { seconds: 0 });
        E.step(0.25);
        const out = [E.uniforms.uWeatherLight.value, E.uniforms.uWeatherFog.value];
        // the sky stands still, so only the restored context can ask for a new environment map
        E.sky.environment();
        E.step(0.25);
        const built = E.sky._env.builds;
        E.step(0.25);
        const idle = E.sky._env.builds;
        E.events.emit('page:contextrestored');
        E.step(0.25);
        out.push(built, idle, E.sky._env.builds);
        E.dispose();
        return out;
      });
      check('rain reaches the signals with the picture replaced', r[0] === 0.4 && r[1] === 0.5, JSON.stringify(r));
      check('a restored WebGL context rebuilds the environment map of a sky standing still', r[2] === 1 && r[3] === 1 && r[4] === 2, JSON.stringify(r));
    },
  },
  {
    name: '[guard] sky writes nothing: sky({ sun | hemisphere | fog }) throw naming what to write; lights: false leaves the scene without the placeholders',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(() => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const err = o => { try { T.sky(o); return ''; } catch (x) { return x.message; } };
        const E = mk(createEngine, 'sky-no-placeholders', { lights: false });
        E.use(T.sky());
        let lights = 0; E.scene.traverse(o => { if (o.isLight) lights++; });
        E.dispose();
        return { sun: err({ sun: false }), hemi: err({ hemisphere: false }), fog: err({ fog: false }), lights };
      });
      check('sky({ sun: false }) throws and names lights: false and the signals', /sky-option/.test(r.sun) && /createEngine\(\{ lights: false \}\)/.test(r.sun) && /uSunDir/.test(r.sun), r.sun);
      check('sky({ hemisphere: false }) throws and names the signals', /sky-option/.test(r.hemi) && /uDaylight/.test(r.hemi), r.hemi);
      check('sky({ fog: false }) throws and names scene.fog', /sky-option/.test(r.fog) && /scene\.fog = new THREE\.Fog/.test(r.fog), r.fog);
      check('lights: false: no light in the scene, with a sky installed too', r.lights === 0, String(r.lights));
    },
  },
  {
    software: true,   // reads rendered pixels
    name: '[guard] sky writes nothing: a scene with no picture code is neutral gray, not black, and describe().render.defaults names what the engine put there',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const E = mk(createEngine, 'no-code-gray');
        E.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(50, 50).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x808080 })));
        await E.start();
        const R = E.renderer, rt = new THREE.WebGLRenderTarget(8, 8), px = new Uint8Array(8 * 8 * 4);
        const cam = new THREE.PerspectiveCamera(30, 1, 0.5, 100); cam.position.set(0, 10, 0); cam.lookAt(0, 0, 0);
        E.step(1 / 30);
        R.setRenderTarget(rt); R.render(E.scene, cam); R.readRenderTargetPixels(rt, 0, 0, 8, 8, px); R.setRenderTarget(null); rt.dispose();
        const i = (4 * 8 + 4) * 4, rgb = [px[i], px[i + 1], px[i + 2]], d = E.describe().render;
        E.dispose();
        return { rgb, defaults: d.defaults.map(x => x.what), text: d.text };
      });
      const [a, b, c] = r.rgb;
      check('the ground is lit, neither black nor blown out', a > 30 && a < 250, JSON.stringify(r.rgb));
      check('and neutral (no channel leads)', Math.abs(a - b) <= 2 && Math.abs(b - c) <= 2, JSON.stringify(r.rgb));
      check('render.defaults lists background, both lights and the shadow map', ['scene.background', 'lights.sun', 'lights.hemi', 'renderer.shadowMap'].every(k => r.defaults.includes(k)), JSON.stringify(r.defaults));
      check('with no tone curve the background is not swapped for a texture', !r.defaults.includes('background tone'), JSON.stringify(r.defaults));
      check('the text block says it too', /engine defaults on the picture: scene\.background/.test(r.text), r.text);
    },
  },
];
