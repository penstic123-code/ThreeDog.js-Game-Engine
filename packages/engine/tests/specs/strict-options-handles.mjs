// 未知选项一律报错 + 句柄和动词统一（W3 / W7，2026-11-02）：每条删掉的旧路一条"不许绕开"的检查。
// 为什么要守：选项从 checkOptions（只警告）搬到 readParams（开发时抛错）以后，有人新加一个入口又用回只警告的写法，别的测试不会红；
// 交还从 null / false 统一成 handle.remove()、vegetation.add 改名 define、time.after 收成内部，旧写法加回来也没人发现。这里直接试每条旧路。
// Same format as the other files here.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HELPERS = `
  const { createEngine, world, grids, particles, music } = threedogTest;
  const base = { canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'strict-options' };
  const err = f => { try { f(); return ''; } catch (x) { return x.message; } };
`;
const page = fn => new Function(`${HELPERS}\nreturn (${fn})();`);
const PAGE = '/tests/perf/index.html?mode=world';
const dts = rel => readFileSync(fileURLToPath(new URL(`../../types/${rel}`, import.meta.url)), 'utf8');

export const specs = [
  {
    name: '[guard] unknown options throw in dev with did-you-mean: createEngine, audio, grids.add / define, particles.define / emit / attach',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        out.engine = err(() => createEngine({ ...base, antialas: false }).dispose());
        out.audio = err(() => createEngine({ ...base, audio: { levles: { sfx: 1 } } }).dispose());
        out.music = err(() => { const m = createEngine({ ...base, canvas: document.createElement('canvas'), audio: { music: { trakcs: {} } } }); try { m.use(music()); } finally { m.dispose(); } });
        const e = createEngine(base);
        e.use(world()); e.use(grids()); e.use(particles());
        out.gridAdd = err(() => e.grids.add('g1', { cel: 1, size: [4, 4] }));
        out.gridDefine = err(() => e.grids.define('crate', { sizee: [1, 1] }));
        out.fxDefine = err(() => e.particles.define('spark', { lifetme: 1 }));
        e.particles.define('spark', {});
        out.fxEmit = err(() => e.particles.emit('spark', [0, 0, 0], { cout: 3 }));
        out.fxPositional = err(() => e.particles.emit('spark', [0, 0, 0], 5));
        out.fxAttach = err(() => e.particles.attach('spark', e.scene, { rat: 3 }));
        out.duck = err(() => e.audio.duck({ music: 0.5 }, { fdae: 1 }));
        out.catalog = e.catalog('core')?.params?.fov?.default;
        e.dispose();
        return out;
      }));
      const dym = (s, k) => s.includes('did you mean') && s.includes(k);
      check('createEngine({ antialas }) throws: did you mean antialias', dym(r.engine, 'antialias'), r.engine);
      check('createEngine({ audio: { levles } }) / music.trakcs throw with did-you-mean', dym(r.audio, 'levels') && dym(r.music, 'tracks'), JSON.stringify([r.audio, r.music]));
      check('grids.add({ cel }) / grids.define({ sizee }) throw with did-you-mean', dym(r.gridAdd, 'cell') && dym(r.gridDefine, 'size'), JSON.stringify([r.gridAdd, r.gridDefine]));
      check('particles.define / emit / attach typo throws with did-you-mean; a number as options throws', dym(r.fxDefine, 'lifetime') && dym(r.fxEmit, 'count') && dym(r.fxAttach, 'rate') && /options argument must be an object/.test(r.fxPositional),
        JSON.stringify([r.fxDefine, r.fxEmit, r.fxAttach, r.fxPositional]));
      check('audio.duck({ fdae }) throws', dym(r.duck, 'fade'), r.duck);
      check("engine.catalog('core').params is the createEngine schema (fov default 55)", r.catalog === 55, String(r.catalog));
    },
  },
  {
    name: '[guard] handles: audio.addBus / defineState return { remove() }; old give-back forms are gone; vegetation.add and time.after are not public',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(page(() => {
        const out = {};
        const e = createEngine(base);
        const bus = e.audio.addBus('radio', { level: 0.6, owner: 'test' });
        out.bus = [typeof bus.remove, bus.owner, e.audio.levels.radio];
        out.busTwice = err(() => e.audio.addBus('radio'));
        out.busOld = err(() => e.audio.addBus('radio2', 0.5));   // the old positional level is an options error now
        bus.remove(); out.busGone = 'radio' in e.audio.levels;
        out.noManual = typeof e.time.manual;   // channel speeds change only through engine.mod
        const st = e.defineState('corner', { pos: '30,30' });
        out.state = [typeof st?.remove, e._urlState.states.has('corner')];
        st.remove(); out.stateGone = e._urlState.states.has('corner');
        e.dispose();
        return out;
      }));
      check('audio.addBus returns { owner, remove() }; remove deletes the bus; a second add of the same name throws; a positional level throws',
        r.bus[0] === 'function' && r.bus[1] === 'test' && r.bus[2] === 0.6 && !r.busGone && /already a bus/.test(r.busTwice) && /options argument/.test(r.busOld), JSON.stringify(r));
      check("time.manual is gone (a channel's speed changes only through engine.mod('time.<channel>'))", r.noManual === 'undefined', JSON.stringify(r));
      check('defineState returns a handle; remove() forgets the name', r.state[0] === 'function' && r.state[1] && !r.stateGone, JSON.stringify(r));
      const world = dts('world.d.ts'), gameplay = dts('gameplay.d.ts');
      const veg = world.slice(world.indexOf('export interface Vegetation {'), world.indexOf('}', world.indexOf('export interface Vegetation {') + 500) + 1);
      check('[guard] Vegetation types: define(name, …) defines a kind, there is no add()', /\n  define\(name: string, opts: VegetationOptions\)/.test(world) && !/\n  add\(name: string, opts: VegetationOptions\)/.test(world), veg.slice(0, 200));
      const time = gameplay.slice(gameplay.indexOf('export interface Time {'), gameplay.indexOf('\n}', gameplay.indexOf('export interface Time {')));
      check('[guard] Time types: no after() (the one public timer is engine.clock.after(s, fn, { data, channel }))', time.length > 50 && !/\n  after\(/.test(time), time.slice(-200));
    },
  },
];
