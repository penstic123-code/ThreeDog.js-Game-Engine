// Guards for the engine core: saves and the save format, session, threads, core guards. Each test builds fresh headless engines on the
// threads test page, so no game content gets in the way. Same format as specs.mjs. Run: npm test -- "Core review"

const PAGE = '/tests/threads/';

export const specs = [
  {
    name: 'Core review: saves -- a throwing save() keeps the old save; envelope format, unknown parts kept and adopted; a throwing load() rolls back; load is a Promise',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cr-saves' });
        await E.start();
        const S = E.saves, quiet = [console.error, console.warn]; console.error = console.warn = () => {};
        let a = 1, bad = false;
        S.register('crA', { save: () => ({ a }), load: d => { a = d.a; } });
        S.register('crB', { save: () => { if (bad) throw new Error('crB broke'); return { b: 1 }; }, load: d => { if (d.boom) throw new Error('crB load broke'); } });
        const first = await S.save('cr1');
        a = 2; bad = true;
        const second = await S.save('cr1');
        const kept = JSON.parse(S._json.get('cr1')).parts.crA.a, saveCode = E.error?.code;
        E.error = null; E.unfreeze('error'); bad = false;
        const env = S.collect();
        S._json.set('cr-f2', JSON.stringify({ ...env, format: 2 }));
        const f2 = S.check('cr-f2');
        S._json.set('cr-ghost', JSON.stringify({ ...env, parts: { ...env.parts, ghost: { keep: 7 } }, versions: { ...env.versions, ghost: 3 } }));
        const ghostLoad = await S.load('cr-ghost');
        await S.save('cr-ghost2');
        const g2 = JSON.parse(S._json.get('cr-ghost2'));
        let adopted = null;
        S.register('ghost', { version: 3, save: () => adopted, load: d => { adopted = d; } });   // the module arrives later: it gets its part
        a = 5;
        S._json.set('cr-boom', JSON.stringify({ ...env, parts: { ...env.parts, crA: { a: 99 }, crB: { boom: true } } }));
        const p = S.load('cr-boom'), isPromise = typeof p?.then === 'function', boom = await p, afterBoom = a, boomCode = E.error?.code;
        E.error = null; E.unfreeze('error');
        const missing = S.load('nope'), missingIsPromise = typeof missing?.then === 'function', missingOk = await missing;
        [console.error, console.warn] = quiet;
        E.dispose();
        return { first, second, kept, saveCode, format: env.format, f2, ghostLoad, ghost: g2.parts.ghost, ghostV: g2.versions.ghost, adopted, isPromise, boom, afterBoom, boomCode, missingIsPromise, missingOk };
      });
      check('a part whose save() throws: save returns false, the slot keeps the previous save, code save-part-threw', r.first === true && r.second === false && r.kept === 1 && r.saveCode === 'save-part-threw', JSON.stringify(r));
      check('the envelope has format 1; a save with format 2 is refused as tooNew', r.format === 1 && r.f2 === 'tooNew', JSON.stringify(r));
      check('a part no module owns survives load -> save with its version, and a module registering later receives it', r.ghostLoad === true && r.ghost?.keep === 7 && r.ghostV === 3 && r.adopted?.keep === 7, JSON.stringify(r));
      check('a part whose load() throws: load resolves false, earlier parts go back to their pre-load state, code save-load-threw', r.isPromise && r.boom === false && r.afterBoom === 5 && r.boomCode === 'save-load-threw', JSON.stringify(r));
      check('saves.load always returns a Promise (also for a missing slot)', r.missingIsPromise && r.missingOk === false, JSON.stringify(r));
    },
  },
  {
    name: 'Core review: save import is offline and checked -- a non-data: attachment is refused without fetching; __proto__ keys in a save are dropped',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cr-import' });
        await E.start();
        const S = E.saves, quiet = console.warn; console.warn = () => {};
        const env = S.collect();
        let fetched = 0; const of = window.fetch; window.fetch = (...x) => { fetched++; return of(...x); };
        const file = { threedog: 'save', format: 1, data: env, files: [{ group: 'photo', id: 'x', url: 'https://example.com/a.png', type: 'image/png' }] };
        const remote = await S.importFile(new File([JSON.stringify(file)], 'x.json'));
        const ok = await S.importFile(new File([JSON.stringify({ ...file, files: [{ group: 'photo', id: 'y', type: 'text/plain', url: 'data:text/plain;base64,aGk=' }] })], 'y.json'));
        const blob = (await S.store.blobs('photo')).find(b => b.id === 'y');
        const newer = await S.importFile(new File([JSON.stringify({ ...file, format: 2, files: [] })], 'z.json'));
        window.fetch = of;
        const flags = '{"__proto__": {"evil": true}, "ok": true}';
        S._json.set('cr-proto', JSON.stringify(env).replace('"flags":{}', '"flags":' + flags));
        const loaded = await S.load('cr-proto');
        const text = await S.import(S.export('cr-proto'), 'cr-text');
        console.warn = quiet;
        const out = { remote, ok, blobText: blob ? await blob.blob.text() : null, newer, fetched, loaded, text, evil: E.vars.flags.evil ?? null, flagOk: E.vars.flags.ok, plain: Object.getPrototypeOf(E.vars.flags) === Object.prototype };
        E.dispose();
        return out;
      });
      check('an https attachment refuses the whole file, and nothing is fetched', r.remote === null && r.fetched === 0, JSON.stringify(r));
      check('a data: attachment is decoded offline into the blobs store; the default slot is "imported"', r.ok === 'imported' && r.blobText === 'hi', JSON.stringify(r));
      check('an export file of a newer file format is refused', r.newer === null, JSON.stringify(r));
      check('"__proto__" in save data does not reach the flags object (no prototype swap), other flags load', r.loaded === true && r.evil === null && r.flagOk === true && r.plain, JSON.stringify(r));
      check('import(text) resolves true once stored', r.text === true, JSON.stringify(r));
    },
  },
  {
    name: 'Core review: session -- autosave waits outside play and stops with remove(); session.load resets parts the save lacks; newGame cancels a running skip',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cr-session', ui: { title: { title: 'T' } } });
        let part = 'new';
        E.saves.register('crP', { save: () => ({ v: part }), load: d => { part = d.v; } });
        await E.start();
        const S = E.saves; let saved = 0; E.events.on('save:written', () => saved++);
        const atTitle = E.session.playing;
        const h = S.autosave(0.01);   // 0.6 fixed seconds of play
        E.step(2); await S.flush();
        const duringTitle = saved;
        await E.session.newGame(); E.ui.close('title');
        E.step(2); await S.flush(); await new Promise(res => setTimeout(res, 30));
        const duringPlay = saved;
        h.remove(); E.step(2); await S.flush(); await new Promise(res => setTimeout(res, 30));
        const afterRemove = saved;
        let badMinutes = ''; try { S.autosave(0); } catch (e) { badMinutes = e.code; }
        // a save made without crP (an older version of the game): continuing gives crP its new-game state, not the current run's
        await S.save('cr-old');
        const old = JSON.parse(S._json.get('cr-old')); delete old.parts.crP; delete old.versions.crP; S._json.set('cr-old', JSON.stringify(old));
        part = 'played';
        const loadOk = await E.session.load('cr-old'), afterLoad = part;
        // newGame during a fading skip: the skip resolves null, time does not jump, nothing stays frozen
        const t0 = E.clock.now, sk = E.skip({ seconds: 600, fade: 0.2 }), ng = E.session.newGame();
        for (let i = 0; i < 40; i++) { E.step(0.05); await new Promise(res => setTimeout(res, 0)); }
        const skipped = await sk; await ng;
        const fadeCase = { skipped, jumped: E.clock.now - t0 > 500, frozen: E.frozen };
        // a timer starts a new game in the middle of a skip without fade: the skip stops there
        E.clock.after(10, () => { E.session.newGame(); });
        const quick = await E.skip({ seconds: 600 });
        await new Promise(res => setTimeout(res, 20));
        const timerCase = { quick, now: E.clock.now, frozen: E.frozen };
        E.dispose();
        return { atTitle, duringTitle, duringPlay, afterRemove, badMinutes, loadOk, afterLoad, fadeCase, timerCase };
      });
      check('autosave writes nothing while the title screen is up', r.atTitle === false && r.duringTitle === 0, JSON.stringify(r));
      check('autosave writes during play, and stops after remove(); a bad interval throws save-autosave', r.duringPlay >= 1 && r.afterRemove === r.duringPlay && r.badMinutes === 'save-autosave', JSON.stringify(r));
      check('session.load: a part missing from the save gets its new-game state', r.loadOk === true && r.afterLoad === 'new', JSON.stringify(r));
      check('newGame during a fading skip: the skip resolves null, time does not jump, nothing stays frozen', r.fadeCase.skipped === null && !r.fadeCase.jumped && !r.fadeCase.frozen, JSON.stringify(r));
      check('a timer that starts a new game mid-skip stops the skip there', r.timerCase.quick === null && r.timerCase.now < 600 && !r.timerCase.frozen, JSON.stringify(r));
    },
  },
  {
    name: 'Core review: threads -- a crashed worker rejects tasks that transferred buffers and reruns the others; pure functions refuse main-thread-only globals',
    url: PAGE,
    expectErrors: /boom|worker failed/,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const T = engine.threads;
        const src = "self.onmessage = e => { if (e.data.id) setTimeout(() => { throw new Error('boom'); }, 10); };";
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const L = T.lane({ create: () => new Worker(url), local: () => m => m.x * 2 });
        const buf = new Float32Array(4);
        const moved = L.run({ x: 1, buf }, [buf.buffer]).then(v => ({ value: v }), e => ({ code: e.code }));
        const copied = L.run({ x: 21 }).then(v => ({ value: v }), e => ({ code: e.code }));
        const wait = p => Promise.race([p, new Promise(res => setTimeout(() => res('timeout'), 8000))]);
        const out = { size: T.size, moved: await wait(moved), copied: await wait(copied) };
        const refuse = fn => { try { T.pure(fn, 'cr'); return null; } catch (e) { return e.code; } };
        out.engineName = refuse(rec => { rec.x = engine.tick; });
        out.documentName = refuse(rec => { rec.t = document.title; });
        out.mathOk = refuse(rec => { rec.x = Math.max(rec.a, 1) + Number.parseFloat('2'); });
        L.dispose();
        return out;
      });
      check('the task that transferred its buffer rejects with threads-transfer', r.size === 0 || r.moved.code === 'threads-transfer', JSON.stringify(r));
      check('the task without transfer is answered on the main thread', r.size === 0 || r.copied.value === 42, JSON.stringify(r));
      check('a pure function reading engine or document is refused (pure-function); Math / Number are fine', r.engineName === 'pure-function' && r.documentName === 'pure-function' && r.mathOk === null, JSON.stringify(r));
    },
  },
  {
    name: 'Core review: core guards -- clock.every(0), asset name clash, late use() init, dispose during start, repeated start, animator removal, teleport timeout, pad release, coded errors',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine } = threedogThreads;
        const make = key => createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: key });
        const code = fn => { try { fn(); return null; } catch (e) { return e.code ?? e.message; } };
        const out = {};
        const D = make('cr-dispose'), started = D.start(); D.dispose();
        out.disposed = await started.then(() => 'resolved', e => e.code);
        const E = make('cr-core');
        out.sameStart = E.start() === E.start();
        await E.start();
        out.every0 = code(() => E.clock.every(0, () => {}));
        out.everyNaN = code(() => E.clock.every(NaN, () => {}));
        out.afterNaN = code(() => E.clock.after(NaN, 'x:y'));
        out.clash = code(() => E.assets.manifest({ models: { grass: '/m/grass.glb' }, textures: { grass: '/t/grass.png' } }));
        let inited = 0;
        E.use({ name: 'crLate', label: 'late', init: () => { inited++; } });
        await new Promise(res => setTimeout(res, 0));
        out.lateInit = inited;
        const THREE = E.THREE, g = new THREE.Group();
        g.userData.animations = [new THREE.AnimationClip('idle', 1, [])];   // a model with a clip (one without clips gets no per-frame hook)
        E.add(g);
        const f0 = E.counts().frame;
        E.assets.animate(g, {});
        const f1 = E.counts().frame;
        E.remove(g);
        out.animator = { f0, f1, f2: E.counts().frame };
        E.stream.readyCheck('cr-never', s => s.name !== 'teleport');
        const tp = E.stream.teleport([30, 0, 30], { timeout: 0.5 }).then(() => 'moved', e => ({ code: e.code, names: /cr-never/.test(e.message) }));
        for (let i = 0; i < 20; i++) E.step(0.1);
        out.teleport = await tp;
        const src = E.stream.source([0, 0, 0]), gone = src.whenReady.then(() => 'ready', e => e.code); src.remove();
        out.removed = await gone;
        E.input._keyDown('PadRT', 'pad'); E.input._padOn = true; E.input.poll(1 / 60);
        out.padHeld = E.input.keys.has('PadRT');
        const quiet = console.error; console.error = () => {};
        E.clock.after(0.01, () => { E.clock.every(0, () => {}); });
        E.step(0.1);
        console.error = quiet;
        out.error = E.error && { code: E.error.code, fix: !!E.error.fix, docs: E.error.docs.length, where: E.error.where };
        E.error = null; E.unfreeze('error');
        const text = E.describeText().split('\n');
        out.text = { lines: text.length, last: text.at(-1), path: E.describeText({ path: 'time' }).split('\n')[0], full: E.describeText({ full: true }).includes('More:') };
        E.i18n.setLocale('auto'); out.locale = E.i18n.locale;
        E.dispose();
        return out;
      });
      check('dispose during start: start() rejects with engine-disposed; a second start() returns the first Promise', r.disposed === 'engine-disposed' && r.sameStart === true, JSON.stringify(r));
      check('clock.every(0 / NaN) and after(NaN) throw clock-interval', r.every0 === 'clock-interval' && r.everyNaN === 'clock-interval' && r.afterNaN === 'clock-interval', JSON.stringify(r));
      check('one name as a model and a texture throws asset-name-clash', r.clash === 'asset-name-clash', JSON.stringify(r));
      check('a module installed after start() has its init run', r.lateInit === 1, JSON.stringify(r));
      check('engine.remove of an animated model stops its animator (counts().frame back)', r.animator.f1 === r.animator.f0 + 1 && r.animator.f2 === r.animator.f0, JSON.stringify(r.animator));
      check('teleport timeout rejects with stream-timeout naming the waiting loader; a removed source rejects whenReady', r.teleport?.code === 'stream-timeout' && r.teleport.names && r.removed === 'stream-removed', JSON.stringify(r));
      check('a gamepad that disconnects releases its buttons', r.padHeld === false, JSON.stringify(r));
      check('a clock timer error goes through the error tiers with a code, fix and docs', r.error?.code === 'clock-interval' && r.error.fix && r.error.docs > 0 && /clock timer/.test(r.error.where), JSON.stringify(r.error));
      check('describeText: a summary within 30 lines ending with how to expand; path and full modes', r.text.lines <= 30 && /^More:/.test(r.text.last) && /^time: /.test(r.text.path) && !r.text.full, JSON.stringify(r.text));
      check("i18n.setLocale('auto') resolves to a real locale", r.locale === 'en' || r.locale === 'zh-CN', r.locale);
    },
  },
  {
    name: 'Core review: save format -- quest progress by stable step ids with a migration from positions; world owes time only for far kinds and keys records by id',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, quests, world } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'cr-format' });
        E.use(world({ farEvery: 0.05 }), quests({ keys: [], notify: false }));
        let doneA = false;
        const step = (id, done = () => false) => ({ id, text: id, done });
        E.quests.define('q', { title: 'Q', steps: [step('a', () => doneA), step('b'), step('c')] });
        await E.start();
        const W = E.world, quiet = console.warn; console.warn = () => {};
        E.ops.allow(() => {
          E.quests.start('q');
          W.simulate('crop', { far: (rec, dt) => { rec.g = (rec.g ?? 0) + dt; } });
          for (let i = 0; i < 30; i++) W.add({ id: 'prop' + i, kind: 'crprop', position: [i, 0, 0] });
          for (let i = 0; i < 3; i++) W.add({ id: 'crop' + i, kind: 'crop', position: [500 + i, 0, 500] });
        });
        W.anchor = { x: -900, z: -900 };
        doneA = true; E.step(1.5);
        const saved = E.saves.collect(), qs = saved.parts.quests.state.q, w = saved.parts.world;
        // content inserts a step before b: progress stays on b
        E.quests.define('q', { title: 'Q', steps: [step('a', () => true), step('new'), step('b'), step('c')] });
        await E.saves.apply(saved);
        const afterInsert = E.quests.state.q.step;
        // an old (version 1) save stored the position 2: migrated through the current definition
        const v1 = { ...saved, versions: { ...saved.versions, quests: 1 }, parts: { ...saved.parts, quests: { state: { q: { step: 2, done: false } } } } };
        const v1ok = await E.saves.apply(v1);
        const migratedStep = E.quests.state.q.step, migratedId = E.saves.collect().parts.quests.state.q.step;
        // a step id the definition lost: restarts the quest
        const lost = { ...saved, parts: { ...saved.parts, quests: { state: { q: { step: 'gone', done: false } } } } };
        await E.saves.apply(lost);
        const lostStep = E.quests.state.q.step;
        // old world format (records as an array) still loads
        const oldWorld = { ...saved, versions: { ...saved.versions, world: 1 }, parts: { ...saved.parts, world: { ...w, records: Object.entries(w.records).map(([id, rec]) => ({ id, ...rec })) } } };
        const oldOk = await E.saves.apply(oldWorld);
        console.warn = quiet;
        const out = { qs, qVersion: saved.versions.quests, wVersion: saved.versions.world, owed: Object.keys(w.owed), recordsIsObject: !Array.isArray(w.records),
          afterInsert, v1ok, migratedStep, migratedId, lostStep, oldOk, propsBack: W.query({ kind: 'crprop' }).length };
        E.dispose();
        return out;
      });
      check('quest progress is saved by step id (version 2)', r.qs?.step === 'b' && r.qVersion === 2, JSON.stringify(r));
      check('a step inserted before the saved one: progress stays on the same step', r.afterInsert === 2, JSON.stringify(r));
      check('a version-1 save (positions) migrates to ids through the definition', r.v1ok === true && r.migratedStep === 2 && r.migratedId === 'b', JSON.stringify(r));
      check('a saved step id the quest no longer has restarts the quest', r.lostStep === 0, JSON.stringify(r));
      check('world: owed is written only for kinds simulated with far; records are keyed by id (version 3)', r.owed.length > 0 && r.owed.every(id => id.startsWith('crop')) && r.recordsIsObject && r.wVersion === 3, JSON.stringify(r));
      check('a version-1 world save (records as an array) still loads', r.oldOk === true && r.propsBack === 30, JSON.stringify(r));
    },
  },
];
