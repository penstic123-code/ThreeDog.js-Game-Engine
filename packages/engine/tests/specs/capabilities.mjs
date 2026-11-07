// Capabilities and readiness (design.md 7.2): before / after follow a capability, a bound provider is checked against its contract, usable is not has.
// The checks run in the test bundle because the shape warning is a dev check, and plain Node has no dev mode and no engine (no document).
const PAGE = '/tests/threads/';

export const specs = [
  {
    name: "[guard] Capabilities: the engine's own modules in an open world have no gap against their contracts",
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => ({ names: [...engine.modules.keys()].length, gaps: engine._contractGaps() }));
      check('every bound built-in provider matches its contract on a real engine', r.names > 5 && !r.gaps.length, JSON.stringify(r.gaps));
    },
  },
  {
    name: '[guard] Capabilities: before / after name a capability and follow a replaces; a contradiction through provides is refused like one by module name',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const E = threedogThreads.createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cap-order' });
        const out = {}, at = n => E.moduleOrder.indexOf(n);
        const giver = (name, stage = 'gameplay') => ({ name, type: 'rules', stage, provides: ['capGround'] });
        // the reader is installed first, so without the capability edge install order would put it ahead
        E.use({ name: 'capReader', type: 'rules', stage: 'gameplay', after: ['capGround'] }, { name: 'capEarly', type: 'rules', stage: 'gameplay', before: ['capGround'] }, giver('capOld'));
        out.first = at('capOld') < at('capReader') && at('capEarly') < at('capOld');
        E.use(giver('capNew'), { replaces: 'capGround' });
        out.swapped = !E.has('capOld') && at('capNew') < at('capReader') && at('capEarly') < at('capNew');
        // a replaces into a stage the kept order contradicts: refused before anything moves, the same as the order written by module name
        const err = fn => { try { fn(); return null; } catch (e) { return e.message; } };
        out.lateErr = err(() => E.use(giver('capLate', 'late'), { replaces: 'capGround' }));
        out.lateOrder = E.moduleOrder.join();
        out.stageKept = E.has('capNew') && !E.has('capLate');
        // the provider's own line about its capability is no cycle
        E.use({ name: 'capSelf', type: 'rules', provides: ['capOwn'], after: ['capOwn'] });
        out.self = E.has('capSelf');
        // a name still throws as it did, written the way the module wrote it; so does a cycle through a capability, naming the modules
        out.named = err(() => E.use({ name: 'capBad', type: 'rules', stage: 'control', after: ['capReader'] }));
        out.cycle = err(() => E.use({ name: 'capLoop', type: 'rules', stage: 'gameplay', before: ['capNew'], after: ['capNew'] }));
        E.dispose();
        return out;
      });
      check('after / before a capability order against its provider, whatever the install order', r.first);
      check('the same lines follow the provider a replaces put in', r.swapped);
      check('a provider in a stage the order contradicts: module-order naming the capability and both modules', /module-order/.test(r.lateErr ?? '') && /capReader/.test(r.lateErr ?? '') && /capLate/.test(r.lateErr ?? '') && /capGround/.test(r.lateErr ?? ''), r.lateErr);
      check('the holder stays where it was', r.stageKept, r.lateOrder);
      check("a module's order against its own capability orders nothing", r.self);
      check('a contradiction by module name still throws module-order', /module-order/.test(r.named ?? '') && /capReader/.test(r.named ?? ''), r.named);
      check('a cycle through a capability throws and names the modules', /capLoop/.test(r.cycle ?? '') && /capNew/.test(r.cycle ?? ''), r.cycle);
    },
  },
  {
    name: '[guard] Capabilities: a provider is checked against the contract where it binds, in dev, on module changes and never per frame',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const E = threedogThreads.createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cap-shape' });
        const out = {};
        // a partial bag: it says what is missing and it still runs
        const part = await __t.warns(() => E.use({ name: 'capBag', type: 'rules', provides: ['inventory'], install: () => ({ add() {}, count: () => 0 }) }));
        out.partWarn = part.warns.join(' ');
        out.partRuns = E.moduleStates.capBag === 'running' && E.usable('inventory');
        out.problems = E.catalog('capBag').problems.join(' ');
        // same name as an engine capability, nobody bound to it: a game's own thing, left alone until something requires it
        const own = await __t.warns(() => E.use({ name: 'level', type: 'rules', install: () => ({ mine() {} }) }));
        out.ownWarns = own.warns.filter(w => /module-contract/.test(w)).length;
        const bound = await __t.warns(() => E.use({ name: 'capUser', type: 'rules', requires: ['level'] }));
        out.boundWarn = bound.warns.join(' ');
        // a full provider whose API fills in init: judged when it runs, not at install, and then nothing to say.
        // The API is a Proxy, so every read is counted: a frame must not read it
        let reads = 0;
        const filled = {}, api = new Proxy(filled, { get(t, k) { reads++; return t[k]; }, has(t, k) { reads++; return k in t; } });
        const full = await __t.warns(async () => {
          E.use({ name: 'capSolid', type: 'rules', provides: ['collider3d'], install: () => api, async init() { await 0; Object.assign(filled, { addSolid() {}, overlap() {}, sweep() {} }); } });
          out.lazyEarly = E.catalog('capSolid').problems.join(' ');
          await E.start();
        });
        out.fullWarns = full.warns.filter(w => /capSolid/.test(w)).length;
        const before = reads;
        E.step(0.5);
        out.frameReads = reads - before;
        E.dispose();
        return out;
      });
      check('a partial provider gets a module-contract warning naming the missing methods', /module-contract|lacks/.test(r.partWarn) && /capBag/.test(r.partWarn) && /define/.test(r.partWarn), r.partWarn);
      check('the partial provider still installs and runs', r.partRuns);
      check('engine.catalog(name).problems says the same', /capability inventory/.test(r.problems) && /define/.test(r.problems), r.problems);
      check('a full provider draws no warning, and one still in init is not judged yet', r.fullWarns === 0 && r.lazyEarly === '', `${r.fullWarns} ${r.lazyEarly}`);
      check("a game's module that only shares a capability's name is not checked", r.ownWarns === 0, String(r.ownWarns));
      check('the check comes when a consumer binds to that name', /'level'/.test(r.boundWarn) && /module-contract|lacks/.test(r.boundWarn), r.boundWarn);
      check('frames read no provider API (no per-frame reflection)', r.frameReads === 0, String(r.frameReads));
    },
  },
  {
    name: '[guard] Readiness: has is not usable; a module in init or failed is installed, and explain says which',
    url: PAGE,
    expectErrors: /cap test failure/,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const E = threedogThreads.createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cap-ready' });
        const out = {};
        const gate = () => { let open; const p = new Promise(r => { open = r; }); return { p, open }; };
        const slow = gate();
        E.use({ name: 'capSlow', type: 'rules', provides: ['capThing'], init: () => slow.p });
        out.preStart = { has: E.has('capSlow'), hasCap: E.has('capThing'), usable: E.usable('capSlow') };
        const started = E.start();
        await 0;
        out.midway = { has: E.has('capSlow'), usable: E.usable('capSlow') };
        slow.open();
        await started;
        out.slowUsable = E.usable('capThing');
        const never = gate();
        E.use({ name: 'capFails', type: 'picture', provides: ['capBroken'], init: () => never.p });
        E.use({ name: 'capNeeds', type: 'rules', requires: ['capBroken'], init() {} });
        never.open(Promise.reject(new Error('cap test failure')));
        await E.loading.settled();
        out.failedUsable = E.usable('capFails');
        out.failed = E.explain({ module: 'capFails' });
        out.needs = E.explain({ module: 'capNeeds' });
        E.dispose();
        return out;
      });
      check('before start a module with init is installed, by name and by capability, and not usable', r.preStart.has && r.preStart.hasCap && !r.preStart.usable, JSON.stringify(r.preStart));
      check('while its init runs it is installed and not usable', r.midway.has && !r.midway.usable, JSON.stringify(r.midway));
      check('a capability is usable once its provider runs', r.slowUsable);
      check('settled ends on a failed init, and explain says failed', !r.failedUsable && !r.failed.ok && /failed/.test(r.failed.text), r.failed.text);
      check('explain names what blocks the module that required it', !r.needs.ok && /capFails/.test(r.needs.text), r.needs.text);
    },
  },
];
