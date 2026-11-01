// Core hardening: module install is all-or-nothing, stage order is enforced, critical modules stop start(), late modules get a state, step(0) does not advance.
// Each test builds fresh headless engines on the threads test page. Run: npm test -- "Core modules"

const PAGE = '/tests/threads/';

export const specs = [
  {
    name: 'Core modules: engine.use(a, b) is all-or-nothing -- b failing validation or install leaves no trace of a (modules, engine.a, hooks, dispose called)',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const E = threedogThreads.createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cm-batch' });
        const err = fn => { try { fn(); return null; } catch (e) { return e; } };
        const hooks = () => E._hooks.fixed.length;
        const h0 = hooks();
        const e1 = err(() => E.use({ name: 'cmA', fixed() {} }, { name: 'cmB', stage: 'bogus' }));
        const afterValidate = { has: E.has('cmA'), prop: E.cmA, hooks: hooks() - h0 };
        let disposed = 0;
        const e2 = err(() => E.use({ name: 'cmC', fixed() {}, install: () => ({}), dispose() { disposed++; } }, { name: 'cmD', install() { throw new Error('install boom'); } }));
        const afterInstall = { has: E.has('cmC'), prop: E.cmC, hooks: hooks() - h0, disposed, order: E.moduleOrder.filter(n => n.startsWith('cm')) };
        const e3 = err(() => E.use({ name: 'cmE' }, { name: 'cmF', requires: ['cmE'], after: ['cmG'] }, { name: 'cmG', after: ['cmF'] }));
        const afterCycle = E.has('cmE');
        E.use({ name: 'cmH', fixed() {} }, { name: 'cmI', requires: ['cmH'], fixed() {} });   // a later module in the same batch may require an earlier one
        const ok = { h: E.has('cmH'), i: E.has('cmI'), hooks: hooks() - h0 };
        E.dispose();
        return { e1: e1?.message, afterValidate, e2: e2?.message, afterInstall, e3: e3?.message, afterCycle, ok };
      });
      check('b fails validation (bad stage): a is not installed, hooks unchanged', /bogus/.test(r.e1 ?? '') && !r.afterValidate.has && r.afterValidate.prop === undefined && r.afterValidate.hooks === 0, JSON.stringify(r));
      check('b throws in install(): a is rolled back (modules, engine.a, hooks), a.dispose() ran, the error still reaches the caller', /install boom/.test(r.e2 ?? '') && !r.afterInstall.has && r.afterInstall.prop === undefined && r.afterInstall.hooks === 0 && r.afterInstall.disposed === 1 && r.afterInstall.order.length === 0, JSON.stringify(r));
      check('a cycle created inside one batch is caught before anything installs', /cycle/.test(r.e3 ?? '') && !r.afterCycle, JSON.stringify(r));
      check('a later module in the batch can require an earlier one; a good batch installs and its hooks are in', r.ok.h && r.ok.i && r.ok.hooks === 2, JSON.stringify(r));
    },
  },
  {
    name: 'Core modules: before / after that contradict the stage order throw at use() with both modules, both stages and the fix; same stage is fine',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(() => {
        const E = threedogThreads.createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cm-stage' });
        const err = fn => { try { fn(); return null; } catch (e) { return e; } };
        const bad = err(() => E.use({ name: 'cmA', stage: 'control' }, { name: 'cmB', stage: 'audio', before: ['cmA'] }));
        const afterBad = E.has('cmA') || E.has('cmB');
        E.use({ name: 'cmX', stage: 'control' });
        const badAfter = err(() => E.use({ name: 'cmY', stage: 'control', after: ['cmZ'] }, { name: 'cmZ', stage: 'audio' }));
        const badAgainstInstalled = err(() => E.use({ name: 'cmW', stage: 'audio', before: ['cmX'] }));
        E.use({ name: 'cmS1', stage: 'gameplay' }, { name: 'cmS2', stage: 'gameplay', before: ['cmS1'] });   // same stage: before / after decide as before
        const same = E.moduleOrder.filter(n => n.startsWith('cmS'));
        const good = err(() => E.use({ name: 'cmP', stage: 'control', before: ['cmQ'] }, { name: 'cmQ', stage: 'audio' }));   // consistent with the stage order
        E.dispose();
        return { bad: bad?.message, code: bad?.code, afterBad, badAfter: badAfter?.message, badAgainstInstalled: badAgainstInstalled?.message, same, good: good?.message ?? null };
      });
      check('before against the stage order: error names both modules and stages and says what to change', /cmB/.test(r.bad ?? '') && /cmA/.test(r.bad) && /audio/.test(r.bad) && /control/.test(r.bad) && /stage/.test(r.bad) && r.code === 'module-order' && !r.afterBad, JSON.stringify(r));
      check('after against the stage order and against an already installed module also throw', /cmY/.test(r.badAfter ?? '') && /cmW/.test(r.badAgainstInstalled ?? ''), JSON.stringify(r));
      check('inside one stage before / after still decide; a consistent cross-stage before is accepted', r.same.join() === 'cmS2,cmS1' && r.good === null, JSON.stringify(r));
    },
  },
  {
    name: 'Core modules: a critical module whose init fails makes start() reject with the reason; a non-critical one keeps the old behaviour; a module that never gets ready times out with its name',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const quiet = [console.error, console.warn]; console.error = console.warn = () => {};
        const run = async (id, mod, tweak) => {
          const E = threedogThreads.createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: id });
          E.use(mod); tweak?.(E);
          let rejected = null;
          try { await E.start(); } catch (e) { rejected = e; }
          const out = { rejected: rejected?.message ?? null, code: rejected?.code ?? null, ready: E.ready, disabled: [...E.disabledModules], state: E.moduleStates?.[mod.name], err: E.error?.message ?? null };
          E.dispose();
          return out;
        };
        const crit = await run('cm-crit', { name: 'cmCrit', critical: true, init() { throw new Error('crit boom'); } });
        const soft = await run('cm-soft', { name: 'cmSoft', presentation: true, init() { throw new Error('soft boom'); } });
        const dflt = await run('cm-dflt', { name: 'cmDflt', init() { throw new Error('dflt boom'); } });
        const never = await run('cm-never', { name: 'cmNever', isReady: () => false }, E => { E.loading.timeoutMs = 300; });
        [console.error, console.warn] = quiet;
        return { crit, soft, dflt, never };
      });
      check('critical init failure: start() rejects, message has the module name and "crit boom", engine not ready', /cmCrit/.test(r.crit.rejected ?? '') && /crit boom/.test(r.crit.rejected) && !r.crit.ready && r.crit.state === 'failed', JSON.stringify(r.crit));
      check('non-critical presentation module failing init: start() resolves, the module is disabled', r.soft.rejected === null && r.soft.ready && r.soft.disabled.includes('cmSoft'), JSON.stringify(r.soft));
      check('a module is not critical by default: gameplay init failure is reported (engine.error) but start() still resolves', r.dflt.rejected === null && r.dflt.ready && r.dflt.state === 'failed', JSON.stringify(r.dflt));
      check('isReady that never turns true: start() rejects after loading.timeoutMs naming the module', /cmNever/.test(r.never.rejected ?? '') && r.never.code === 'module-not-ready', JSON.stringify(r.never));
    },
  },
  {
    name: 'Core modules: a module installed after start() has a state; no fixed / frame hooks until init succeeded; loading.settled() waits; failed init stays out',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const quiet = [console.error, console.warn]; console.error = console.warn = () => {};
        const E = threedogThreads.createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cm-late' });
        await E.start();
        let release, fixed = 0, frames = 0;
        const gate = new Promise(res => { release = res; });
        const ret = E.use({ name: 'cmLate', async init() { await gate; }, fixed() { fixed++; }, frame() { frames++; } });
        E.step(0.2);
        const during = { ret: ret === E, state: E.moduleStates.cmLate, fixed, frames, describe: E.describe().moduleStates?.cmLate, order: E.moduleOrder.includes('cmLate') };
        release();
        await E.loading.settled();
        E.step(0.2);
        const after = { state: E.moduleStates.cmLate, fixedRan: fixed > 0, framesRan: frames > 0, describe: E.describe().moduleStates?.cmLate ?? null };
        let bad = 0;
        E.use({ name: 'cmBad', init() { throw new Error('late boom'); }, fixed() { bad++; } });
        await E.loading.settled();
        E.error = null; E.unfreeze?.('error');
        E.step(0.2);
        const failed = { state: E.moduleStates.cmBad, ran: bad, described: E.describe().moduleStates?.cmBad };
        [console.error, console.warn] = quiet;
        E.dispose();
        return { during, after, failed };
      });
      check('during init: use() returns the engine, state is "initializing" (also in describe), the module is in moduleOrder, no hook ran', r.during.ret && r.during.state === 'initializing' && r.during.describe === 'initializing' && r.during.fixed === 0 && r.during.frames === 0 && r.during.order, JSON.stringify(r.during));
      check('after init: loading.settled() resolved, state "running", hooks run, describe no longer lists it', r.after.state === 'running' && r.after.fixedRan && r.after.framesRan && r.after.describe === null, JSON.stringify(r.after));
      check('init that throws: state "failed", its hooks never run', r.failed.state === 'failed' && r.failed.ran === 0 && r.failed.described === 'failed', JSON.stringify(r.failed));
    },
  },
  {
    name: 'Core modules: step(0) advances nothing; negative / NaN / Infinity throw with the fix; tiny positive seconds still advance one step',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const E = threedogThreads.createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cm-step' });
        await E.start();
        let n = 0;
        E.use({ name: 'cmCount', fixed() { n++; } });
        const err = v => { try { E.step(v); return null; } catch (e) { return e.message; } };
        const t0 = E.elapsed;
        E.step(0);
        const zero = { n, moved: E.elapsed - t0 };
        const neg = err(-1), nan = err(NaN), inf = err(Infinity), str = err('1');
        const afterBad = n;
        E.step(0.001);
        const tiny = n;
        E.dispose();
        return { zero, neg, nan, inf, str, afterBad, tiny };
      });
      check('step(0): no fixed step, no time', r.zero.n === 0 && r.zero.moved === 0, JSON.stringify(r));
      check('step(-1) / NaN / Infinity / "1" throw and say what to pass; nothing advanced', [r.neg, r.nan, r.inf, r.str].every(m => /seconds/.test(m ?? '')) && r.afterBad === 0, JSON.stringify(r));
      check('step(0.001) still runs one fixed step (a positive request is never dropped)', r.tiny === 1, JSON.stringify(r));
    },
  },
];
