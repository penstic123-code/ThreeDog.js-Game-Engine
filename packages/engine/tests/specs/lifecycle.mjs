// Lifecycle guards ("do not bypass", review 0.4 section 2.A): one owner for a game session's lifecycle and per-session state.
//   - engine.phase: no fixed step (no game time, no module hook before its init) while start() loads, also on the real-time loop path
//   - session newGame / load that fails keeps the old playthrough (tracked handles, timers, no session:start)
//   - ctx.track: every built-in module's listeners leave with it when a use() batch rolls back
//   - per-session state lives in save parts: triggers, weather transition, music override, quest timer, content markers, containers, path requests
// Same format as the other files here. Run: npm test -- Lifecycle
const PAGE = '/tests/threads/';

export const specs = [
  {
    name: 'Lifecycle: no fixed step while loading (real-time loop path simulated), no hook before init, phase order',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine } = threedogThreads, out = {};
        const E = mk(createEngine, 'lc-phase');
        const seen = { fixedSlow: 0, fixedLate: 0, frameLate: 0, onFixed: 0 };
        let release;
        const gate = new Promise(res => { release = res; });
        E.use({ name: 'lcSlow', type: 'rules', async init() { await gate; }, fixed() { seen.fixedSlow++; } },
          { name: 'lcLate', type: 'rules', init() {}, fixed() { seen.fixedLate++; }, frame() { seen.frameLate++; } });
        E.onFixed(() => { seen.onFixed++; });
        out.constructed = E.phase;
        const p = E.start();
        for (let i = 0; i < 200 && E.moduleStates.lcSlow !== 'initializing'; i++) await new Promise(res => setTimeout(res, 5));
        out.loading = E.phase;
        // what the real-time loop does each frame on a real browser (headless never runs it): turn real time into fixed steps
        for (let i = 0; i < 30; i++) E._catchUp(0.1);
        E.step(0.5, { render: false });   // headless scenario settling steps during loading too
        out.during = { tick: E.tick, clock: E.clock.now, elapsed: E.time.now('real'), ...seen };
        release(); await p;
        out.after = E.phase;
        out.atReady = { tick: E.tick, elapsed: E.time.now('real') };
        E.step(0.1, { render: false });
        out.played = { ...seen, tick: E.tick };
        E.dispose();
        out.disposed = E.phase;
        return out;
      });
      check('phase goes constructed -> loading -> running -> disposed', r.constructed === 'constructed' && r.loading === 'loading' && r.after === 'running' && r.disposed === 'disposed', JSON.stringify(r));
      check('while loading: no tick, clock, elapsed or onFixed / module fixed hook, on the real-time path and in step()',
        r.during.tick === 0 && r.during.clock === 0 && r.during.elapsed === 0 && r.during.onFixed === 0 && r.during.fixedSlow === 0 && r.during.fixedLate === 0, JSON.stringify(r));
      check('a module whose init has not run gets no frame hook either', r.during.frameLate === 0, JSON.stringify(r));
      check('the game opens at tick 0 and fixed steps run once ready', r.atReady.tick === 0 && r.atReady.elapsed === 0 && r.played.fixedSlow > 0 && r.played.onFixed > 0, JSON.stringify(r));
    },
  },
  {
    name: 'Lifecycle: a newGame / session.load whose part load() throws keeps the old playthrough (tracked handles, timers, clocks; session:failed, no session:start)',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine } = threedogThreads, out = {};
        const quiet = [console.error, console.warn]; console.error = console.warn = () => {};
        const E = mk(createEngine, 'lc-fail');
        let bad = false;
        E.saves.register('lcBad', { save: () => ({ v: 1 }), load: () => { if (bad) throw new Error('lc boom'); } });
        await E.start();
        E.step(0.5, { render: false });
        const hits = { tracked: 0 }, events = [];
        E.session.track(E.events.on('lc:ping', () => hits.tracked++));
        E.clock.after(50, () => {});   // a function timer added during play
        for (const n of ['session:start', 'session:failed']) E.events.on(n, () => events.push(n));
        const before = { tracked: E.session.describe().tracked, timers: E.counts().timers, elapsed: E.time.now('real') };
        bad = true;
        out.ok = await E.session.newGame();
        E.events.emit('lc:ping');
        out.after = { tracked: E.session.describe().tracked, timers: E.counts().timers, elapsed: E.time.now('real'), hits: hits.tracked };
        out.before = before; out.events = [...events];
        E.error = null; E.stacks.get('freeze').release('error');
        bad = false;
        out.ok2 = await E.session.newGame();
        out.after2 = { tracked: E.session.describe().tracked, events: [...events] };
        E.dispose();
        [console.error, console.warn] = quiet;
        return out;
      });
      check('newGame returns false', r.ok === false, JSON.stringify(r));
      check('tracked handles and function timers of the old playthrough stay, the clocks are back', r.after.tracked === r.before.tracked && r.after.timers === r.before.timers && r.after.hits === 1 && r.after.elapsed === r.before.elapsed, JSON.stringify(r));
      check('session:failed fires, session:start does not', JSON.stringify(r.events) === '["session:failed"]', JSON.stringify(r));
      check('a later newGame that works ends the old playthrough as usual', r.ok2 === true && r.after2.tracked === 0 && r.after2.events.at(-1) === 'session:start', JSON.stringify(r));
    },
  },
  {
    name: 'Lifecycle: every built-in module leaves no listener, timer, hook or audio rule behind when its use() batch rolls back (ctx.track); a failed init drops its handles',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine } = threedogThreads, T = threedogThreads.all, out = {};
        const quiet = [console.error, console.warn]; console.error = console.warn = () => {};
        const E = mk(createEngine, 'lc-own');
        const snap = () => {
          const ev = {};
          for (const [n, s] of E.events.map) if (s.size) ev[n] = s.size;
          const a = E.audio;
          return { ...ev, '(fixed)': E._fixed.length + E._fixedLate.length, '(frame)': E._frame.length, '(render)': E._onRender.before.length + E._onRender.after.length,
            '(timers)': E.clock.size, '(conditions)': a.conditions.size, '(measures)': a.measures.size, '(packWatch)': a._packWatch.size };
        };
        T.uiFocus(E);   // the engine's one focus stack (its own onFrame), made by whoever asks first: not a module's registration
        const s0 = snap();
        const mods = [...T.openWorld({ seed: 1, camera: 'follow' }), T.interactions({ ...T.presets.interactions.nearest }), T.dialogue(), T.inventory(), T.pickups(), T.quests(), T.photo(), T.level(),
          T.triggers(), T.particles(), T.music(), T.timeline(), T.nav(), T.hlod(), T.lightPool(), T.content(), T.flow(), T.hud(), T.grids()];
        out.names = mods.map(m => m.name);
        // diagnosis only: which module's install made each registration, so a leak names its module
        let cur = null;
        const made = [], on0 = E.events.on, fr0 = E.onFrame, fx0 = E.onFixed;
        E.events.on = function (n, f) { made.push([cur, n, f]); return on0.call(this, n, f); };
        E.onFrame = function (f, o) { made.push([cur, '(frame)', f]); return fr0.call(this, f, o); };
        E.onFixed = function (f, o) { made.push([cur, '(fixed)', f]); return fx0.call(this, f, o); };
        for (const m of mods) { const inst = m.install; m.install = function (e, ctx) { cur = m.name; try { return inst?.call(this, e, ctx); } finally { cur = null; } }; }
        let err = null;
        try { E.use(...mods, { name: 'lcBoom', type: 'rules', install() { throw new Error('lc boom'); } }); } catch (e) { err = e.message; }
        out.err = err;
        const s1 = snap();
        out.left = Object.keys({ ...s0, ...s1 }).filter(k => (s0[k] ?? 0) !== (s1[k] ?? 0)).map(k => `${k}: ${s0[k] ?? 0} -> ${s1[k] ?? 0}`);
        out.who = made.filter(([, n, f]) => n === '(frame)' ? E._frame.includes(f) : n === '(fixed)' ? E._fixed.includes(f) || E._fixedLate.includes(f) : E.events.map.get(n)?.has(f))
          .map(([m, n]) => `${m}: ${n}`);
        out.modules = E.modules.size; out.tracked = E._modTracked.size; out.setCamera = Object.hasOwn(E, 'setCamera');
        // a failed init removes what its install tracked
        const F = mk(createEngine, 'lc-own-init');
        let heard = 0;
        F.use({ name: 'lcInitFail', type: 'rules', install(e, ctx) { ctx.track(e.events.on('lc:hear', () => heard++)); }, init() { throw new Error('lc init boom'); } });
        await F.start();
        F.events.emit('lc:hear');
        out.initFail = { heard, state: F.moduleStates.lcInitFail };
        F.dispose();
        E.dispose();
        [console.error, console.warn] = quiet;
        return out;
      });
      check('the batch threw the install error and nothing stayed installed', /lc boom/.test(r.err ?? '') && r.modules === 0 && r.tracked === 0 && !r.setCamera, JSON.stringify(r));
      check('no listener / hook / timer / audio rule of any module is left (each line is one leak: module code registering without ctx.track)', r.left.length === 0, r.left.join('\n') + '\nregistered by: ' + r.who.join(', '));
      check('a module whose init threw keeps no listener its install tracked', r.initFail.heard === 0 && r.initFail.state === 'failed', JSON.stringify(r));
    },
  },
  {
    name: 'Lifecycle: a fixed camera that is not the active camera never listens to camera zones',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine } = threedogThreads, T = threedogThreads.all, out = {};
        const E = mk(createEngine, 'lc-fixed');
        E.use(T.fixedCamera({ shots: { a: { position: [0, 5, 10], lookAt: [0, 0, 0] }, b: { position: [20, 5, 0], lookAt: [0, 0, 0], fov: 20 } } }));
        await E.start();
        const zone = () => E.events.map.get('trigger:enter')?.size ?? 0;
        out.active = zone();
        E.setCamera('follow');
        out.away = zone();
        const shots = [];
        E.events.on('camera:shot', s => shots.push(s));
        const fov = E.camera.fov;
        E.events.emit('trigger:enter', { tag: 'camera:b', trigger: null, who: null, id: null });
        out.fovKept = E.camera.fov === fov; out.shots = shots.length;
        E.setCamera('fixed');
        out.back = zone();
        E.dispose();
        return out;
      });
      check('listening while active, not after switching away, again when switched back', r.active === 1 && r.away === 0 && r.back === 1, JSON.stringify(r));
      check('a camera zone entered while another camera is active changes nothing', r.fovKept && r.shots === 0, JSON.stringify(r));
    },
  },
  {
    name: 'Lifecycle: per-session state round-trips through saves and resets on new game (triggers once / cooldown, weather transition, music override, quest timer, content markers, containers, queued paths)',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine } = threedogThreads, T = threedogThreads.all, out = {};
        const E = mk(createEngine, 'lc-state');
        E.use(T.world(), T.collision(), T.characters({ npcs: false }), T.calendar(), T.sky(), T.weather({ types: { clear: {}, rain: { rain: 1 } } }), T.triggers(), T.music(), T.inventory(), T.quests(), T.hud(), T.content());
        await E.start();
        const W = fn => E.ops.allow(fn);
        // triggers: a once zone used and a cooldown zone cooling are saved; a new game re-arms them
        const trap = E.triggers.add({ tag: 'trap', position: { x: 0, y: 0, z: 0 }, radius: 2, once: true });
        const gate = E.triggers.add({ tag: 'gate', position: { x: 50, y: 0, z: 0 }, radius: 2, cooldown: 30 });
        await E.session.newGame();   // the zones are part of the new-game state from here on (added by code after start, before play)
        W(() => { trap.used = true; gate._cool = 12; });
        const full = E.saves.collect();
        out.trigSaved = full.parts.triggers;
        W(() => { trap.used = false; gate._cool = 0; });
        await E.saves.apply(full, 'lc');
        out.trigLoaded = { used: trap.used, cool: gate._cool };
        // weather 30% into a transition: saved and loaded as is, no weather:change on load
        const names = Object.keys(E.weather.types), to = names.find(n => n !== E.weather.name);
        W(() => E.weather.set(to, { seconds: 10 }));
        E.step(3, { render: false });
        const wt = E.weather.t, wd = E.saves.collect();
        let changes = 0; const offW = E.events.on('weather:change', () => changes++);
        W(() => E.weather.set(names.find(n => n !== to) ?? to, { seconds: 0.01 }));
        E.step(0.1, { render: false });
        changes = 0;
        await E.saves.apply(wd, 'lc-w');
        out.weather = { t: E.weather.t, wt, name: E.weather.name, to, changes };
        offW.remove();
        // music override, quest check timer, a content marker: saved, and gone after a new game
        E.music.override('boss');
        E.quests._t = 17;
        E.content._mark('lc', { x: 3, z: 4 }, 'here');
        const md = E.saves.collect().parts;
        out.saved = { music: md.music, checkIn: md.quests?.checkIn, marks: md.content?.marks };
        await E.session.newGame();
        out.fresh = { override: E.music.state.override, checkIn: E.quests._t, marks: E.content.markers.size, trap: trap.used, cool: gate._cool };
        // containers: an authored container absent from a save gets its starting goods, whatever loads came before
        const box = E.inventory.container('lcBox', { items: { apple: 2 } });
        const noBox = E.saves.collect(); delete noBox.parts.containers?.lcBox;
        W(() => box.remove('apple', 2));
        await E.saves.apply(E.saves.collect(), 'lc-c1');
        await E.saves.apply(noBox, 'lc-c2');
        out.box = box.count('apple');
        // a path request still queued when a new game starts never answers in the new one
        let answered = 0;
        E.characters.findPathAsync({ x: 0, z: 0 }, { x: 5, z: 5 }, () => answered++);
        await E.session.newGame();
        E.step(1, { render: false });
        out.answered = answered;
        E.dispose();
        return out;
      });
      check('triggers: used / cooldown are in the save and come back on load', r.trigSaved?.trap?.used === true && r.trigSaved?.gate?.cool === 12 && r.trigLoaded.used === true && r.trigLoaded.cool === 12, JSON.stringify(r));
      check('weather: a save mid-transition loads mid-transition, without a weather:change', Math.abs(r.weather.t - r.weather.wt) < 1e-9 && r.weather.wt < 1 && r.weather.name === r.weather.to && r.weather.changes === 0, JSON.stringify(r.weather));
      check('music override, quest timer and content markers are saved', r.saved.music?.override === 'boss' && r.saved.checkIn === 17 && r.saved.marks?.length === 1, JSON.stringify(r.saved));
      check('a new game clears them (and re-arms the zones)', r.fresh.override === null && r.fresh.checkIn !== 17 && r.fresh.marks === 0 && r.fresh.trap === false && r.fresh.cool === 0, JSON.stringify(r.fresh));
      check('an authored container missing from a save gets its starting goods, even after other loads', r.box === 2, JSON.stringify(r));
      check('a queued path request does not answer in the next playthrough', r.answered === 0, JSON.stringify(r));
    },
  },
];
