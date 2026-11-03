// The engine's own decisions must not be recorded as the game's (a guard).
// Why: the settings menu (modules/settings) re-applied every current value at start, and ao / bloom went through look.post.set with the default owner 'game',
// so on a low-tier device or a headless page "ao turned off by the engine for the tier" showed in describe().look as "turned off by the game" (the art switcher worked around it).
// Rules guarded:
//   1. At start, before anything is written, no look part has records in its game layer written by engine code (a new engine module writing there fails the first check)
//   2. A costly effect the engine turned off on a low tier: writer is 'engine', with a why saying it was the tier
//   3. The game sets it back on: applied, recorded as game; the settings menu turns it off on the settings layer (it only restricts): the player's off
//      wins over the game's on; the menu's on drops that entry and the game's value shows again
// Same format as the other files here.

/**
 * In the page: every game-layer entry on every look part's shared points. Not filtered by `at` for "written by the engine": the test page is bundled,
 * and `at` in the bundle always points at the engine chunk. styletest writes nothing to look at start, so any entry here is the engine's.
 */
const GAME_RECORDS = () => {
  const out = [];
  for (const [id, p] of Object.entries(engine.look)) for (const [k, s] of p._points ?? []) for (const h of s.holders()) if (h.layer === 'game') out.push(`${id}.${k}:${h.owner}`);
  return out;
};
const row = k => { const x = engine.describe().look.post?.[k]; return x && { value: x.value, writer: x.writer, why: x.why ?? null }; };

export const specs = [
  {
    name: '[守] 引擎写入不记成游戏层：低档 / 无头页上引擎关掉的 ao、bloom 来源是引擎；游戏开回记成 game；设置菜单记成 settings 层',
    url: '/styletest.html?threedog-headless&threedog-tier=low',
    async run({ check, ev }) {
      const r = await ev(`(() => {
        const GAME_RECORDS = ${GAME_RECORDS}, row = ${row};
        const s = engine.settings ?? engine.modules?.get?.('settings') ?? null;
        const out = { tier: engine.tier, hasSettings: !!s, start: GAME_RECORDS(), bloom0: row('bloom.enabled'), hasAo: !!engine.post.get('ao'), ao0: row('ao.enabled'), aoOn0: engine.post.get('ao')?.enabled };
        // the game turns bloom back on: game layer, applied
        engine.look.post.set({ 'bloom.enabled': true });
        out.bloom1 = row('bloom.enabled'); out.bloomOn1 = engine.post.get('bloom').enabled;
        // the player turns it off in the settings menu: the settings layer, above the game; the game's on again does not switch it back on
        if (s) { s.set('bloom', false, { save: false }); out.bloom2 = row('bloom.enabled'); out.bloomOn2 = engine.post.get('bloom').enabled; }
        engine.look.post.set({ 'bloom.enabled': true });
        out.bloom3 = row('bloom.enabled'); out.bloomOn3 = engine.post.get('bloom').enabled;
        // the player allows it again: the settings entry goes, the game's on shows
        if (s) { s.set('bloom', true, { save: false }); out.bloom5 = row('bloom.enabled'); out.bloomOn5 = engine.post.get('bloom').enabled; s.set('bloom', false, { save: false }); }
        // the settings menu re-applies the current values at start (as on a page reload): unchanged values are not written
        // the saved values equal the engine's current state (page reload, the player changed nothing): _applyAll adds no record
        if (s) { const before = GAME_RECORDS().join('|'); Object.assign(s.values, s._currentValues()); s._applyAll(); out.reapplySame = GAME_RECORDS().join('|') === before; out.bloom4 = row('bloom.enabled'); }
        return out;
      })()`);
      const j = JSON.stringify(r);
      check('页面是低档、装了设置菜单（这组检查的前提）', r.tier === 'low' && r.hasSettings, j);
      check('开局：任何 look 部件的 game 层都没有记录（页面代码开局不写 look，有就是引擎写的）', r.start.length === 0, j);
      check('低档下引擎关掉的 bloom：writer 是 engine，why 说明按档位关', r.bloom0?.value === false && r.bloom0.writer === 'engine' && /low-tier|headless/.test(r.bloom0.why ?? ''), j);
      // the page's style may not bring ao at all (the world style has bloom only): then there is nothing to check for it
      if (r.hasAo) check('风格本来就关的 ao 不算档位决定：writer engine，不带 why', r.ao0?.value === false && r.ao0.writer === 'engine' && r.ao0.why === null && r.aoOn0 === false, j);
      check('游戏 set 开回 bloom：生效，记成 game', r.bloom1?.writer === 'game' && r.bloom1.value === true && r.bloomOn1 === true, j);
      check('the settings menu turns it off: the settings layer decides (writer settings), the picture is off', r.bloom2?.writer === 'settings' && r.bloomOn2 === false, j);
      check("the game turns it on again: the player's off still wins (settings only restricts, the game is above nothing here)", r.bloom3?.writer === 'settings' && r.bloomOn3 === false, j);
      check("the menu allows it again: the settings entry goes and the game's on shows", r.bloom5?.writer === 'game' && r.bloomOn5 === true, j);
      check('the menu re-applies the same values: no new record, the writer stays', r.reapplySame === true && r.bloom4?.writer === 'settings', j);
    },
  },
  {
    name: '[守] 引擎写入不记成游戏层：高档页上设置菜单开局不把 bloom / ao 的当前值写进 game 层',
    url: '/styletest.html',
    async run({ check, ev }) {
      const r = await ev(`(() => { const GAME_RECORDS = ${GAME_RECORDS}, row = ${row};
        // every effect the style brings (bloom; ao only when the style has it): its on / off is the engine's default
        const on = Object.keys(engine.describe().look.post ?? {}).filter(k => k.endsWith('.enabled'));
        return { start: GAME_RECORDS(), enabled: Object.fromEntries(on.map(k => [k, row(k)])) }; })()`);
      const j = JSON.stringify(r);
      check('开局：game 层没有引擎写的记录；后期效果（至少有 bloom）的开关 writer 都是 engine', r.start.length === 0 && 'bloom.enabled' in r.enabled && Object.values(r.enabled).every(x => x?.writer === 'engine'), j);
    },
  },
];
