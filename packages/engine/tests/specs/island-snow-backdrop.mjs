// recipes/44 "do not bypass" guards: snow cover rides the season tint uniforms (no second shader pass) and is off unless the game
// asks; weather:change fires once per name change; applyState({ season }); look.sky backdrop replaces the dome with a flat color
// that fog follows, and without it the sky is untouched. Wrong settings throw with the fix.

const HELPERS = `
  const { THREE, createEngine, sky, calendar, weather } = threedogTest;
  const types = { clear: {}, snow: { snow: 1, cloud: 0.6 } };
  // calOpts: a calendar (seasons) under the sky; without it the sky draws its fixed time (skyOpts.time)
  const make = async ({ seasons = null, sky: look } = {}, skyOpts = {}, calOpts = null, wx = {}) => {
    const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'isb', urlState: false });
    if (calOpts) e.use(calendar(calOpts));
    const keys = look ?? {};
    e.use(sky({ ...skyOpts, ...keys }), weather({ types, particles: 200, ...wx }));
    e.sky.seasonTints = seasons;
    await e.start();
    return e;
  };
  const run = (e, n = 4) => { for (let i = 0; i < n; i++) e.step(1 / 30, { render: false, describe: false }); };
  const tint = (e, k) => [...e.uniforms['u' + k + 'Tint'].value.toArray().map(v => +v.toFixed(3)), +e.uniforms['u' + k + 'Mix'].value.toFixed(3)];
  const err = async fn => { try { await fn(); return 'no error'; } catch (x) { return x.message; } };
`;
const page = fn => new Function(`${HELPERS}\nreturn (${fn})();`);

export const specs = [
  {
    name: 'snow cover: off by default; weather({ snow: { cover } }) moves foliage / ground tint with the snow and melts back; over a mix season; weather:change; applyState season',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(async () => {
        const out = {};
        let e = await make({});
        const changes = []; e.events.on('weather:change', c => changes.push(c));
        e.weather.set('snow', { seconds: 0.01 }); e.weather.set('snow', { seconds: 0.01 }); run(e);
        out.plain = [...tint(e, 'Foliage'), ...tint(e, 'Ground')]; out.changes = changes;
        e.dispose();

        e = await make({}, {}, null, { snow: { cover: { foliage: 0x808080, ground: 0xffffff, strength: 0.8 } } });
        e.weather.set('snow', { seconds: 0.01 }); run(e);
        out.snowF = tint(e, 'Foliage'); out.snowG = tint(e, 'Ground');
        e.weather.set('clear', { seconds: 0.01 }); run(e);
        out.melt = [...tint(e, 'Foliage'), ...tint(e, 'Ground')];
        e.dispose();

        // a 'mix' season (ground 50% to black) under full snow (80% to white): one mix of 90% to 0.889 gray
        e = await make({ seasons: { mode: 'mix', strength: 0.5, winter: { ground: 0x000000 } } },
          {}, { seasons: ['winter'] }, { snow: { cover: { ground: 0xffffff, strength: 0.8 } } });
        e.weather.set('snow', { seconds: 0.01 }); run(e);
        out.over = tint(e, 'Ground');
        e.dispose();

        e = await make({}, {}, { seasons: ['spring', 'summer', 'autumn', 'winter'], daysPerSeason: 7 });
        await e.applyState({ season: 'winter' });
        out.season = [e.calendar.season, e.calendar.day];
        out.badSeason = await err(() => e.applyState({ season: 'wintr' }));
        e.dispose();
        // since a1948cc7 (readParams) a misspelled key throws in dev with the did-you-mean, instead of warning
        out.badCover = await err(async () => (await make({}, {}, null, { snow: { cover: { ground: 0xffffff, strenght: 1 } } })).dispose());
        out.emptyCover = await err(() => make({}, {}, null, { snow: { cover: { strength: 1 } } }));
        return out;
      }));
      check('without cover snow leaves the season tint alone (white, mix 0)', r.plain.join() === '1,1,1,0,1,1,1,0', JSON.stringify(r.plain));
      check('weather:change fires once with { from, to }; the same weather again does not', r.changes.length === 1 && r.changes[0].from === 'clear' && r.changes[0].to === 'snow', JSON.stringify(r.changes));
      const gray = 0.216;   // 0x808080 in linear
      check('full snow: ground tint white at mix 0.8, foliage its own color', r.snowG.join() === '1,1,1,0.8' && Math.abs(r.snowF[0] - gray) < 0.01 && r.snowF[3] === 0.8, JSON.stringify([r.snowF, r.snowG]));
      check('clear again: the cover melts back to neutral', r.melt.join() === '1,1,1,0,1,1,1,0', JSON.stringify(r.melt));
      check('over a mix season: one combined mix (0.9 toward 0.889)', Math.abs(r.over[3] - 0.9) < 1e-3 && Math.abs(r.over[0] - 0.889) < 2e-3, JSON.stringify(r.over));
      check('applyState({ season }) jumps to that season; a wrong name throws with the list', r.season[0] === 'winter' && r.season[1] === 22 && /spring, summer, autumn, winter/.test(r.badSeason), JSON.stringify([r.season, r.badSeason]));
      check('misspelled cover key throws with did-you-mean; cover without a color throws with the fix', /strenght/.test(r.badCover) && /strength/.test(r.badCover) && /cover: \{ foliage/.test(r.emptyCover), `${r.badCover} | ${r.emptyCover}`);
    },
  },
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: 'backdrop: flat background color, dome hidden, uSkyHorizon reports it; engine.sky.backdrop is live, null gives the dome back; default sky untouched; wrong settings throw',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(page(async () => {
        const out = {};
        const shot = e => {   // one pixel of the drawn background (render target bytes are linear)
          const rt = new THREE.WebGLRenderTarget(4, 4), px = new Uint8Array(64), cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
          cam.lookAt(0, 0.3, -1); e.renderer.setRenderTarget(rt); e.renderer.render(e.scene, cam); e.renderer.readRenderTargetPixels(rt, 0, 0, 4, 4, px);
          e.renderer.setRenderTarget(null); rt.dispose(); return Array.from(px.slice(0, 3));
        };
        let e = await make({});
        run(e);
        out.plain = { dome: e.sky.dome.visible, bg: e.scene.background.getHexString(), fog: e.scene.fog };
        e.dispose();
        e = await make({ sky: { backdrop: 0xefebe4 } });
        run(e);
        out.flat = { dome: e.sky.dome.visible, bg: e.scene.background.getHexString(), horizon: e.uniforms.uSkyHorizon.value.getHexString(), px: shot(e),
          want: new THREE.Color(0xefebe4).toArray().map(v => Math.round(v * 255)) };
        e.dispose();
        e = await make({ sky: { backdrop: 0xefebe4 } }, { time: 0.5 });
        run(e); const day = e.scene.background.getHexString();
        e.sky.backdrop = 0x2c3346; run(e); const night = e.scene.background.getHexString();
        e.sky.backdrop = null; run(e);
        out.fn = [day, night, e.sky.dome.visible, e.sky.backdrop];
        e.dispose();
        out.bad = await err(() => make({ sky: { backdrop: { r: 1 } } }));
        out.fnBad = await err(() => make({ sky: { backdrop: () => 0 } }));
        return out;
      }));
      check('default: dome drawn, background untouched, no fog', r.plain.dome && r.plain.bg === '8c8c8c' && r.plain.fog === null, JSON.stringify(r.plain));
      check('backdrop color: dome hidden, background and uSkyHorizon are that color', !r.flat.dome && r.flat.bg === 'efebe4' && r.flat.horizon === 'efebe4', JSON.stringify(r.flat));
      check('the drawn background is the written color (no tone mapping)', r.flat.px.every((v, i) => Math.abs(v - r.flat.want[i]) <= 2), JSON.stringify([r.flat.px, r.flat.want]));
      check('engine.sky.backdrop writes the color live; null gives the dome back', r.fn.join() === 'efebe4,2c3346,true,', JSON.stringify(r.fn));
      check('a non-color backdrop throws with the fix', /must be a color/.test(r.bad) && /must be a color/.test(r.fnBad), `${r.bad} | ${r.fnBad}`);
    },
  },
];
