// The engine's own decisions must not be recorded as the game's (a guard).
// Why: the settings menu (modules/settings) re-applied every current value at start, and ao / bloom were written with the default owner 'game',
// so "the engine's default" showed in describe as "turned off by the game" (the art switcher worked around it).
// Rules guarded:
//   1. At start, before anything is written, no shared point has records in its game layer written by engine code (a new engine module writing there fails the first check)
//   2. The engine never switches an effect by tier (the game reads engine.tier): on a low tier nobody has written its switch
//   3. The game sets it back on: applied, recorded as game; the settings menu turns it off on the settings layer (it only restricts): the player's off
//      wins over the game's on; the menu's on drops that entry and the game's value shows again
//   4. Lights, fog, exposure, tone curve and environment are the game's: with the sky, the calendar, the weather and the settings running, through a day and a storm,
//      the engine writes none of them. Why by value and not by reading the code: a writer added anywhere shows up here, including a module this file never heard of
// Same format as the other files here.

/**
 * In the page: every game-layer entry on every shared point. Not filtered by `at` for "written by the engine": the test page is bundled,
 * and `at` in the bundle always points at the engine chunk. The placeables test page adds its bloom and writes no switch at start, so any entry here is the engine's.
 */
const GAME_RECORDS = () => {
  const out = [];
  for (const n of engine.stacks.list()) for (const h of engine.stacks.get(n).holders()) if (h.layer === 'game') out.push(`${n}:${h.owner}`);
  return out;
};
const row = n => { const x = engine.describe().render.post.find(p => p.name === n); return x && { value: x.on, writer: x.writer }; };

export const specs = [
  {
    name: '[guard] the engine writes no picture value: lights, fog, exposure, tone curve and environment stay as the game wrote them through a day and a storm',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all, E = mk(T.createEngine, 'no-writes');
        E.use(T.calendar({ time: '05:00' }), T.sky(), T.weather({ ...T.presets.weather.temperate, start: 'clear' }), T.settings());
        await E.start();
        const { sun, hemi } = E.lights, S = E.scene, R = E.renderer;
        const own = new THREE.PointLight(0x336699, 7, 40), env = new THREE.Texture();
        S.add(own);
        sun.intensity = 1.234; sun.color.setHex(0x123456); hemi.intensity = 0.456; hemi.color.setHex(0x654321); hemi.groundColor.setHex(0x112233);
        S.fog = new THREE.Fog(0x445566, 7, 77); R.toneMappingExposure = 0.77; S.environment = env; S.environmentIntensity = 0.33; S.environmentRotation.y = 0.5;
        const fog = S.fog, read = () => JSON.stringify({ sun: [sun.intensity, sun.color.getHex()], hemi: [hemi.intensity, hemi.color.getHex(), hemi.groundColor.getHex()],
          own: [own.intensity, own.color.getHex(), own.distance], fog: [S.fog === fog, fog.color.getHex(), fog.near, fog.far], exposure: R.toneMappingExposure, tone: R.toneMapping,
          env: [S.environment === env, S.environmentIntensity, S.environmentRotation.y] });
        const before = read(), top = E.uniforms.uSkyTop.value.getHex(), day0 = E.uniforms.uDaylight.value;
        for (const [time, weather] of [[0.375, 'clear'], [0.5, 'rain'], [0.77, 'storm'], [0.96, 'clear']]) {
          E.calendar.timeOfDay = time;
          E.modules.get('weather').applyState(E, { weather });
          for (let i = 0; i < 8; i++) E.step(0.05);
        }
        E.calendar.timeOfDay = 0.5; E.step(0.05);
        const out = { before, after: read(), moved: E.uniforms.uDaylight.value !== day0 || E.uniforms.uSkyTop.value.getHex() !== top };
        S.environment = null; E.dispose();
        return out;
      });
      check('the signals did move, so the sky and the weather really ran', r.moved, JSON.stringify(r));
      check('every picture value is what the game wrote', r.after === r.before, JSON.stringify(r));
    },
  },
  {
    name: '[守] 引擎写入不记成游戏层：低档页上引擎不按档位关 bloom；游戏写记成 game；设置菜单记成 settings 层',
    url: '/tests/placeables/index.html?threedog-headless&threedog-tier=low',
    async run({ check, ev }) {
      const r = await ev(`(() => {
        const GAME_RECORDS = ${GAME_RECORDS}, row = ${row};
        const s = engine.settings ?? engine.modules?.get?.('settings') ?? null;
        const out = { tier: engine.tier, hasSettings: !!s, start: GAME_RECORDS(), bloom0: row('bloom') };
        // the game switches bloom: game layer, applied
        const fx = engine.post.get('bloom');
        fx.enabled = true;
        out.bloom1 = row('bloom'); out.bloomOn1 = engine.post.get('bloom').enabled;
        // the player turns it off in the settings menu: the settings layer, above the game; the game's on again does not switch it back on
        if (s) { s.set('bloom', false, { save: false }); out.bloom2 = row('bloom'); out.bloomOn2 = engine.post.get('bloom').enabled; }
        fx.enabled = true;
        out.bloom3 = row('bloom'); out.bloomOn3 = engine.post.get('bloom').enabled;
        // the player allows it again: the settings entry goes, the game's on shows
        if (s) { s.set('bloom', true, { save: false }); out.bloom5 = row('bloom'); out.bloomOn5 = engine.post.get('bloom').enabled; s.set('bloom', false, { save: false }); }
        // the settings menu re-applies the current values at start (as on a page reload): unchanged values are not written
        // the saved values equal the engine's current state (page reload, the player changed nothing): applying them adds no record
        if (s) { const before = GAME_RECORDS().join('|'); for (const [k, v] of Object.entries(s._currentValues())) s._apply(k, v); out.reapplySame = GAME_RECORDS().join('|') === before; out.bloom4 = row('bloom'); }
        return out;
      })()`);
      const j = JSON.stringify(r);
      check('页面是低档、装了设置菜单（这组检查的前提）', r.tier === 'low' && r.hasSettings, j);
      check('开局：所有共享点的 game 层都没有记录（页面开局只加 bloom、不写开关，有就是引擎写的）', r.start.length === 0, j);
      check('低档下引擎不动游戏加的 bloom：开着，没人写过它的开关', r.bloom0?.value === true && r.bloom0.writer === 'default', j);
      check('游戏写 bloom 的开关：生效，记成 game', r.bloom1?.writer === 'game' && r.bloom1.value === true && r.bloomOn1 === true, j);
      check('the settings menu turns it off: the settings layer decides (writer settings), the picture is off', r.bloom2?.writer === 'settings' && r.bloomOn2 === false, j);
      check("the game turns it on again: the player's off still wins (settings only restricts, the game is above nothing here)", r.bloom3?.writer === 'settings' && r.bloomOn3 === false, j);
      check("the menu allows it again: the settings entry goes and the game's on shows", r.bloom5?.writer === 'game' && r.bloomOn5 === true, j);
      check('the menu re-applies the same values: no new record, the writer stays', r.reapplySame === true && r.bloom4?.writer === 'settings', j);
    },
  },
  {
    name: '[守] 引擎写入不记成游戏层：高档页上设置菜单开局不把 bloom / ao 的当前值写进 game 层',
    url: '/tests/placeables/index.html',
    async run({ check, ev }) {
      const r = await ev(`(() => { const GAME_RECORDS = ${GAME_RECORDS}, row = ${row};
        // every effect the game added (the page's bloom): its on / off is the default until someone writes it
        return { start: GAME_RECORDS(), enabled: Object.fromEntries(engine.post.list().map(x => [x.name, row(x.name)])) }; })()`);
      const j = JSON.stringify(r);
      check('开局：game 层没有引擎写的记录；后期效果（至少有 bloom）的开关没人写过', r.start.length === 0 && 'bloom' in r.enabled && Object.values(r.enabled).every(x => x?.writer === 'default'), j);
    },
  },
];
