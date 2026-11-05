// [guard] Tools tell the truth: a request that did nothing is reported, bad input is refused without freezing the game, and describe() carries the state that
// changes most, so a snapshot cannot say "same" after a flag was set or a prop moved.
// Why: `state weather=rain` printed Set while the weather stayed clear, "fresh": 1 was ignored, `op thing.set position=3,0,4` froze gameplay, and
// `snap-describe diff` said "matches the baseline" after a flag and a prop changed.
import { compareSnapshot, saveSnapshot } from '@threedog/tools/describe-snapshot';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL = '/?cutscene=skip&time=12:00&weather=clear';

export const specs = [
  {
    name: '[guard] applyState: reports what it could not apply, refuses a bad value, and takes fresh: 1 as yes',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const out = {}, say = async p => { try { return await engine.applyState(p); } catch (e) { return { threw: e.message }; } };
        out.bad = await say({ weather: 'no-such-weather', time: '09:00' });
        out.name = engine.describe().weather.name;
        out.clock = engine.describe().time.clock;
        out.good = await say({ weather: 'rain' });
        out.name2 = engine.describe().weather.name;
        out.view = await say({ view: 'nowhere' });
        out.fresh = await say({ fresh: 'yes' });
        out.wait = await say({ wait: 'soon' });
        out.pos = await say({ pos: 'a,b' });
        await engine.saves.save('honest');
        out.saved = engine.saves.list().length;
        out.freshNumber = await say({ fresh: 1 });
        out.left = engine.saves.list().length;
        return out;
      });
      check('an unknown weather name is refused by key, with the names the game has', r.bad.ok === false && r.bad.refused[0]?.key === 'weather' && /rain/.test(r.bad.refused[0].reason), JSON.stringify(r.bad));
      check('the weather did not change and the good key next to it still applied', r.name === 'clear' && r.clock === '09:00', r.name + ' ' + r.clock);
      check('a known name is ok and took effect', r.good.ok === true && r.name2 === 'rain', JSON.stringify(r.good) + r.name2);
      check('a view with no engine.views is not refused: the page may handle its own ?view=', r.view.ok === true && !r.view.refused?.length, JSON.stringify(r.view));
      check('fresh with an unclear value throws, naming the accepted forms', /state-value/.test(r.fresh.threw ?? ''), JSON.stringify(r.fresh));
      check('wait and pos that are not numbers throw', /state-value/.test(r.wait.threw ?? '') && /finite/.test(r.pos.threw ?? ''), JSON.stringify([r.wait, r.pos]));
      check('fresh: 1 deletes the saves, like ?fresh=1', r.saved > 0 && r.left === 0, `${r.saved} -> ${r.left}`);
    },
  },
  {
    name: '[guard] applyState: a key no installed module handles is refused, a game hook without stateKeys still counts',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const hooks = [...engine.modules.values()].filter(m => m.applyState), weather = engine.modules.get('weather');
        const keep = weather.stateKeys;
        weather.stateKeys = [];   // as if no module took weather
        const none = await engine.applyState({ weather: 'clear' });
        weather.stateKeys = keep;
        return { none, unkeyed: hooks.filter(m => !m.stateKeys).map(m => m.name) };
      });
      check('refused with the reason', r.none.ok === false && /no installed module/.test(r.none.refused[0]?.reason), JSON.stringify(r.none));
      check('every engine hook names its keys (one without would claim all keys and hide this refusal)', !r.unkeyed.length, r.unkeyed.join(', '));
    },
  },
  {
    name: '[guard] ops: a bad position is refused and gameplay keeps running',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        engine.ops.allow(() => engine.world.add({ id: 'honest-prop', kind: 'marker', position: [1, 0, 1] }, { initial: true }));
        const before = engine.time.tick, direct = engine.ops.run('thing.set', { id: 'honest-prop', position: '3,0,4' });
        engine.ops.define('honest.move', { args: { to: 'any' }, run: (e, a) => e.world.move('honest-prop', a.to) });
        const inside = engine.ops.run('honest.move', { to: [1, 2] });
        engine.step(0.1);
        return { direct, inside, error: engine.error?.message ?? null, frozen: engine.frozen, moved: engine.time.tick > before };
      });
      check('thing.set refuses it in can', r.direct.ok === false && r.direct.code === 'badPosition', JSON.stringify(r.direct));
      check('any op whose run hits a bad position refuses too', r.inside.ok === false && r.inside.code === 'badPosition', JSON.stringify(r.inside));
      check('no engine error, not frozen, time still moves', r.error === null && !r.frozen && r.moved, JSON.stringify(r));
    },
  },
  {
    name: '[guard] ops: a NaN an op worked out itself is a bug, reported where it happened',
    url: URL,
    expectErrors: /honest\.bug|not a valid number/,   // the bug provoked on purpose
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        engine.ops.allow(() => engine.world.add({ id: 'honest-bug', kind: 'marker', position: [1, 0, 1] }, { initial: true }));
        engine.ops.define('honest.bug', { args: { by: 'number' }, run: (e, a) => e.world.move('honest-bug', { x: 1 / a.by * 0, z: 1 }) });
        const out = engine.ops.run('honest.bug', { by: 0 });
        return { out, error: engine.error?.message ?? null };
      });
      check('it is an error, not a quiet refusal', r.out.ok === false && r.out.code === 'error' && /position/.test(r.error ?? ''), JSON.stringify(r));
    },
  },
  {
    name: '[guard] URL state: a refused value in the address can be read, and the last answer stands',
    url: '/?cutscene=skip&time=12:00&weather=typo-weather',
    async run({ check, ev }) {
      const r = await ev(async () => { const first = engine.stateRefused; await engine.applyState({}); return { first, after: engine.stateRefused }; });
      check('engine.stateRefused names the value and why', r.first.some(x => x.key === 'weather' && x.value === 'typo-weather' && x.reason), JSON.stringify(r.first));
      check('a later applyState starts clean', !r.after.length, JSON.stringify(r.after));
    },
  },
  {
    name: '[guard] describe snapshot: a flag, a counter and a moved record all differ; idle frames do not',
    url: URL,
    async run({ check, ev }) {
      const dir = mkdtempSync(join(tmpdir(), 'threedog-honest-'));
      const raw = () => ev(() => engine.describe());
      try {
        await ev(() => { engine.haltLoop(); engine.ops.allow(() => engine.world.add({ id: 'honest-prop', kind: 'marker', position: [1, 0, 1] }, { initial: true })); engine.step(0.1); });
        const ignore = ['time', 'picture.lights', 'camera', 'nearby'];   // this page's day moves on; the point here is what is left
        saveSnapshot(dir, 'b', await raw(), { ignore });
        await ev(() => engine.step(1 / 60));
        const idle = compareSnapshot(dir, 'b', await raw(), { ignore });
        check('one idle step: no frame counter shows as a change', idle.ok, idle.text);
        await ev(() => { engine.ops.allow(() => engine.vars.setFlag('honest')); });
        const flag = compareSnapshot(dir, 'b', await raw(), { ignore });
        check('a set flag differs', !flag.ok && /vars\.flags\.honest/.test(flag.text), flag.text);
        await ev(() => { engine.ops.allow(() => { engine.vars.replace({}, undefined); engine.vars.bump('honest'); }); });
        const counter = compareSnapshot(dir, 'b', await raw(), { ignore });
        check('a bumped counter differs', !counter.ok && /vars\.counters\.honest/.test(counter.text), counter.text);
        await ev(() => { engine.ops.allow(() => engine.vars.replace({}, {})); engine.ops.run('thing.set', { id: 'honest-prop', position: [5, 0, 5] }); });
        const moved = compareSnapshot(dir, 'b', await raw(), { ignore });
        check('a moved record differs, by id', !moved.ok && /world\.changed/.test(moved.text) && /honest-prop/.test(moved.text), moved.text);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  },
];
