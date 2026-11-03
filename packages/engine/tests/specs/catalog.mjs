// engine.catalog() (core/catalog.js), params schemas (core/params.js) and the bridge `threedog catalog` (tools/threedog/catalog.mjs).
// Same format as the other files here.
export const specs = [
  {
    name: 'catalog: modules, ownership of ops / saves / describe, params, time model, op detail, find',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const PARAMS = { power: { type: 'number', default: 2, min: 0, desc: 'push strength' }, mode: { type: 'string', default: 'soft', values: ['soft', 'hard'] } };
        let seen = null;
        const mod = {
          name: 'catTest', type: 'rules', label: 'Catalog test', stage: 'gameplay', optional: { sky: 'no dusk bonus' }, params: PARAMS, options: { power: 3 },
          install(e) {
            e.ops.define('catTest.poke', { desc: 'poke it', args: { n: { type: 'int', default: 1, min: 1, max: 5 }, who: 'string?' },
              can: (e2, a) => a.n < 5 ? true : 'tooMany', run: (e2, a) => { seen = a.n; return a.n; }, reasons: { tooMany: 'At most 4' } });
            e.saves.register('catTestState', { version: 2, migrate: { 1: d => d }, save: () => ({}), load: () => {} });
            return { push() {}, _hidden: 1 };
          },
          init(e) { e.describe.add('catTestInfo', () => ({ ok: true })); },
          fixed() {},
        };
        engine.use(mod);
        await engine.loading.settled();
        const list = engine.catalog(), entry = engine.catalog('catTest');
        const ran = engine.ops.run('catTest.poke', {}, { source: 'test' });
        const fail = engine.ops.run('catTest.poke', { n: 5 }, { source: 'test' });
        let range = null;
        try { engine.ops.run('catTest.poke', { n: 9 }, { source: 'test' }); } catch (err) { range = err.message; }
        const op = engine.catalog('catTest.poke');
        // live, not a copy: an op removed from engine.ops is gone from the catalog at once
        const h = engine.ops.define('catTest.temp', { run: () => 1 });
        const withTemp = engine.catalog('catTest').ops.map(o => o.name);
        h.remove();
        const without = engine.catalog('catTest').ops.map(o => o.name);
        // nothing registered escapes the catalog: every op and save part sits in exactly one entry
        const all = engine.catalog(), opsIn = all.flatMap(s => s.ops), savesIn = all.flatMap(s => s.saves);
        const opsOk = opsIn.length === engine.ops.defs.size && [...engine.ops.defs.keys()].every(k => opsIn.includes(k));
        const savesOk = savesIn.length === engine.saves.providers.size && [...engine.saves.providers.keys()].every(k => savesIn.includes(k));
        const found = engine.catalog({ find: 'poke' }).map(s => s.id);
        const core = engine.catalog('core');
        return { ids: list.map(s => s.id), order: engine.moduleOrder, entry, seen, ran, fail, range, op, withTemp, without, opsOk, savesOk, found,
          coreOps: core.ops.map(o => o.name), coreSaves: core.saves.map(p => p.key), unknown: engine.catalog('noSuchThing'), json: JSON.stringify(all).length > 0 };
      });
      const e = r.entry;
      check('catalog() lists every installed module (+ core)', r.order.every(n => r.ids.includes(n)) && r.ids.includes('core'), JSON.stringify(r.ids));
      check('Module entry: stage, state, optional with what is lost, label', e.stage === 'gameplay' && e.state === 'running' && e.label === 'Catalog test'
        && e.optional[0]?.name === 'sky' && e.optional[0].lost === 'no dusk bonus', JSON.stringify(e));
      check('Ops / save parts / describe names registered in install and init belong to the module', e.ops.map(o => o.name).join() === 'catTest.poke'
        && e.saves[0]?.key === 'catTestState' && e.saves[0].version === 2 && e.queries.extra.join() === 'describe().catTestInfo', JSON.stringify(e));
      check('Op args schema with default and range, failure codes from reasons', e.ops[0].args.n.default === 1 && e.ops[0].args.n.max === 5
        && e.ops[0].args.who.optional && e.ops[0].failures.join() === 'tooMany', JSON.stringify(e.ops[0]));
      check('Params: schema, default and the value in use', e.params.power.default === 2 && e.params.power.value === 3 && e.params.mode.values.length === 2, JSON.stringify(e.params));
      check('Time model and problems: fixed hook without skip is flagged', e.time.step === 'fixed' && !e.time.skip && e.problems.some(p => p.includes('no skip hook')), JSON.stringify(e.time));
      check('api names skip _private', e.queries.api.includes('push') && !e.queries.api.includes('_hidden'), JSON.stringify(e.queries.api));
      check('Default is filled in before can / run', r.ran.ok && r.seen === 1 && !r.fail.ok && r.fail.code === 'tooMany', JSON.stringify([r.ran, r.fail, r.seen]));
      check('Out-of-range arg throws in dev naming the limit', /n must be <= 5/.test(r.range ?? ''), r.range);
      check('Op detail: owner, reasons, last attempt', r.op.kind === 'op' && r.op.owner === 'catTest' && r.op.reasons.tooMany === 'At most 4' && r.op.last?.ok === false, JSON.stringify(r.op));
      check('Live view: a removed op leaves the catalog', r.withTemp.includes('catTest.temp') && !r.without.includes('catTest.temp'), JSON.stringify([r.withTemp, r.without]));
      check('No bypass: every op and save part is in exactly one catalog entry', r.opsOk && r.savesOk);
      check('Core entry has engine-owned ops and saves; find filters; unknown id is null', r.coreOps.includes('time.skip') && r.coreSaves.includes('time')
        && r.found.join() === 'catTest' && r.unknown === null, JSON.stringify([r.coreOps, r.coreSaves, r.found]));
    },
  },
  {
    name: 'catalog: readParams checks and fills options (the bridge text is tested in packages/tools/tests/catalog.mjs)',
    url: '/tests/city/index.html',   // the checks run in the test process; the page is only what the runner needs
    async run({ check }) {
      const { readParams } = await import('../../index.js');
      const S = { radius: { type: 'number', default: 2, min: 0 }, sound: 'string?' };
      const o = readParams('magnet', S, { sound: 'ding' });
      const err = fn => { try { fn(); return null; } catch (x) { return x.message; } };
      check('Defaults filled, given values kept', o.radius === 2 && o.sound === 'ding', JSON.stringify(o));
      // this test runs in Node, where DEV is off (a release build): an unknown option warns once and is ignored; in dev (browser pages) it throws the same text
      const warns = []; const w0 = console.warn; console.warn = m => warns.push(String(m));
      let got; try { got = readParams('magnet', S, { radios: 3 }); } finally { console.warn = w0; }
      check('Unknown option (release): warns once with did-you-mean and the code, no throw', got.radius === 2 && warns.length === 1 && /radios.*did you mean `radius`.*\[module-params\]/.test(warns[0]), JSON.stringify(warns));
      check('Below min throws naming the limit', /radius must be >= 0/.test(err(() => readParams('magnet', S, { radius: -1 })) ?? ''));
      check('Bad schema field is caught when read', /did you mean default/.test(err(() => readParams('magnet', { a: { type: 'int', defualt: 1 } }, {})) ?? ''));
    },
  },
];
