// Property tests (fast-check): random operation sequences against the engine's pure-logic rules; on failure the shrunk minimal sequence + seed are printed.
// The whole sequence runs inside the page in ONE ev() call (no round trip per step). fast-check is a devDependency: when missing, the specs skip with the reason.
// Run: npm test -- "Properties"      Replay: FC_SEED=<seed> npm test -- "Properties"      More cases: FC_RUNS=300 (default 25)
let fc = null, missing = '';
try { fc = await import('fast-check'); } catch (e) { missing = e.message.split('\n')[0]; }

const PAGE = '/tests/threads/';
const RUNS = Number(process.env.FC_RUNS) || 25;
const SEED = process.env.FC_SEED != null ? Number(process.env.FC_SEED) : undefined;
const replay = name => `FC_SEED=<seed> npm test -- "${name}"`;

/** Run one property; a failure is reported as one check with seed, the shrunk sequence and the replay command */
async function prop(check, label, name, arb, runOnce) {
  if (!fc) { console.log(`  SKIP ${label}: fast-check not installed (${missing}). Install: npm install -D fast-check`); check(`${label} (skipped: fast-check missing)`, true); return; }
  const r = await fc.check(fc.asyncProperty(arb, async seq => { const bad = await runOnce(seq); if (bad) throw new Error(bad); }),
    { numRuns: RUNS, seed: SEED, verbose: 0 });
  if (!r.failed) { check(`${label} (${r.numRuns} sequences)`, true); return; }
  const cmd = replay(name).replace('<seed>', r.seed);
  check(label, false, `${r.error?.message ?? r.errorInstance}\n  minimal sequence: ${JSON.stringify(r.counterexample[0])}\n  seed: ${r.seed}   replay: ${cmd}`);
}

// ---- state-rule properties (one shared started engine; every sequence begins with session.newGame()) ----
const C = ['bag', 'chest'], ITEMS = ['apple', 'plum', 'rock'];
const stepArb = () => fc.oneof(
  { arbitrary: fc.record({ t: fc.constant('transfer'), pick: fc.nat(5), from: fc.constantFrom(...C), to: fc.constantFrom(...C), item: fc.constantFrom(...ITEMS), n: fc.integer({ min: 1, max: 3 }) }), weight: 5 },   // small n: most moves are valid
  { arbitrary: fc.record({ t: fc.constant('add'), c: fc.constantFrom(...C), item: fc.constantFrom(...ITEMS), n: fc.integer({ min: 1, max: 4 }) }), weight: 4 },
  { arbitrary: fc.constant({ t: 'save' }), weight: 2 }, { arbitrary: fc.constant({ t: 'load' }), weight: 2 }, { arbitrary: fc.constant({ t: 'newGame' }), weight: 1 },
  fc.record({ t: fc.constant('badTransfer'), kind: fc.constantFrom('noBox', 'zero', 'tooMany'), item: fc.constantFrom(...ITEMS) }),
  fc.record({ t: fc.constant('trade'), take: fc.constantFrom(...ITEMS), give: fc.constantFrom(...ITEMS) }),
  fc.record({ t: fc.constant('flag'), k: fc.constantFrom('f1', 'f2'), v: fc.boolean() }),
  fc.record({ t: fc.constant('bump'), k: fc.constantFrom('c1', 'c2'), n: fc.integer({ min: -3, max: 5 }) }),
  fc.record({ t: fc.constant('worldAdd'), i: fc.integer({ min: 0, max: 3 }), x: fc.integer({ min: -9, max: 9 }) }),
  fc.record({ t: fc.constant('worldMove'), i: fc.integer({ min: 0, max: 3 }), x: fc.integer({ min: -9, max: 9 }) }),
  fc.record({ t: fc.constant('worldRemove'), i: fc.integer({ min: 0, max: 3 }) }),
  fc.record({ t: fc.constant('bigTransfer'), pick: fc.nat(5), from: fc.constantFrom(...C), to: fc.constantFrom(...C), item: fc.constantFrom(...ITEMS), n: fc.integer({ min: 4, max: 12 }) }),
);

/** Runs inside the page: returns null or a message naming the first broken rule and the step index */
function pageRun(seq) {
  const E = window.engine, inv = E.inventory, W = E.world;
  const ops = E.ops, box = id => (id === 'bag' ? inv.container('player') : inv.container('chest'));
  const cid = id => (id === 'bag' ? 'player' : 'chest');
  const total = () => ['bag', 'chest'].reduce((s, c) => s + box(c).list().reduce((a, x) => a + x.count, 0), 0);
  const snap = () => JSON.stringify({
    bag: box('bag').list().map(x => [x.id, x.count]).sort(), chest: box('chest').list().map(x => [x.id, x.count]).sort(),
    flags: E.vars.flags, counters: E.vars.counters,
    world: [...W.records.values()].filter(r => r.kind === 'pbt').map(r => [r.id, r.position.x]).sort(),
  });
  return (async () => {
    // independent sequences (shrinking needs that): drop what the previous one left, then start a fresh playthrough
    ops.allow(() => { inv.removeContainer('chest'); for (const r of [...W.records.values()]) if (r.kind === 'pbt') W.remove(r.id); });
    await E.session.newGame();
    inv.container('chest', { capacity: 3 });   // made after start(): not in the new-game data, like a container a game creates at run time
    box('bag').capacity = 3;   // tight rooms so 'full' paths are hit
    const base = snap();
    if (base !== '{"bag":[],"chest":[],"flags":{},"counters":{},"world":[]}') return 'start of sequence is not empty: ' + base;
    let saved = null, snapAtSave = null;
    for (let i = 0; i < seq.length; i++) {
      const s = { ...seq[i] };   // pick: the item the source box really holds (random ids would almost never match), else the random id
      if (s.pick != null) { const have = box(s.from).list(); if (have.length) s.item = have[s.pick % have.length].id; }
      const before = snap(), tBefore = total(), fail = m => `step ${i} ${JSON.stringify(s)}: ${m}`;
      ops.allow(() => {
        if (s.t === 'add') box(s.c).add(s.item, s.n, { silent: true });
        else if (s.t === 'flag') E.vars.setFlag(s.k, s.v);
        else if (s.t === 'bump') E.vars.bump(s.k, s.n);
        else if (s.t === 'worldAdd') { if (!W.get('pbt' + s.i)) W.add({ kind: 'pbt', id: 'pbt' + s.i, position: { x: s.x, y: 0, z: 0 } }); }
        else if (s.t === 'worldMove') { if (W.get('pbt' + s.i)) W.move('pbt' + s.i, { x: s.x, y: 0, z: 0 }); }
        else if (s.t === 'worldRemove') { if (W.get('pbt' + s.i)) W.remove('pbt' + s.i); }
      });
      if (s.t === 'add' || s.t === 'trade' && false) { /* add may be partial (room): only the total never exceeds before + n */
        if (total() - tBefore > s.n || total() < tBefore) return fail(`add changed total by ${total() - tBefore}, asked ${s.n}`);
      }
      if (s.t === 'transfer' || s.t === 'bigTransfer') {
        const can = ops.can('inventory.transfer', { from: cid(s.from), to: cid(s.to), item: s.item, n: s.n });
        const r = ops.run('inventory.transfer', { from: cid(s.from), to: cid(s.to), item: s.item, n: s.n }, { source: 'test' });
        if (total() !== tBefore) return fail(`rule 1: total ${tBefore} -> ${total()}`);
        if (!r.ok && snap() !== before) return fail(`rule 2: op refused (${r.code}) but state changed`);
        if ((can === true || can?.ok) !== r.ok) return fail(`can() said ${JSON.stringify(can)} but run gave ok=${r.ok}`);
      } else if (s.t === 'badTransfer') {
        const args = s.kind === 'noBox' ? { from: 'nowhere', to: 'bag', item: s.item } : s.kind === 'zero' ? { from: 'chest', to: 'bag', item: s.item, n: 0 } : { from: 'chest', to: 'bag', item: s.item, n: 999 };
        let r; try { r = ops.run('inventory.transfer', { to: 'player', ...args, from: args.from === 'bag' ? 'player' : args.from }, { source: 'test' }); } catch { r = { ok: false }; }
        if (r.ok) return fail('rule 2: an invalid transfer succeeded');
        if (snap() !== before) return fail('rule 2: an invalid transfer changed state');
      } else if (s.t === 'trade') {
        const r = ops.run('inventory.trade', { take: s.take, give: s.give }, { source: 'test' });
        if (!r.ok && snap() !== before) return fail(`rule 2: trade refused (${r.code}) but state changed`);
        if (r.ok && s.take === s.give && total() !== tBefore) return fail('trade of an item for itself changed the total');
      } else if (s.t === 'save') {
        await E.saves.save('pbt'); await E.saves.flush(); saved = true; snapAtSave = snap();
      } else if (s.t === 'load') {
        if (saved) { const ok = await E.saves.load('pbt'); await E.saves.flush(); if (!ok) return fail('load returned false'); if (snap() !== snapAtSave) return fail(`rule 3: after load\n   saved ${snapAtSave}\n   now   ${snap()}`); }
      } else if (s.t === 'newGame') {
        await E.session.newGame();
        if (snap() !== base) return fail(`rule 4: after newGame state is not the new-game state\n   base ${base}\n   now  ${snap()}`);
      }
    }
    return null;
  })();
}

export const specs = [
  {
    name: 'Properties: random op sequences keep item totals, refuse invalid ops without side effects, and survive save/load and newGame',
    url: PAGE,
    async run({ check, ev }) {
      await ev(() => {
        const A = threedogThreads.all;
        if (!engine.has('inventory')) engine.use(A.inventory());
        if (!engine.has('world')) engine.use(A.world());
        engine.inventory.define('apple', { name: 'Apple', stack: 4 }); engine.inventory.define('plum', { name: 'Plum', stack: 2 }); engine.inventory.define('rock', { name: 'Rock', stack: 9 });
      });
      const pre = await ev(() => ({ inv: !!engine.inventory, world: !!engine.world, vars: !!engine.vars }));
      check('test engine has inventory, world and vars', pre.inv && pre.world && pre.vars, JSON.stringify(pre));
      await prop(check, 'rules 1-4: totals conserved, invalid ops free, save/load round trip, newGame leaves nothing', 'Properties: random op', fc && fc.array(stepArb(), { maxLength: 40, size: 'max' }),
        seq => ev(pageRun, seq));
    },
  },
  {
    name: 'Properties regression: a container created at run time, saved then loaded once, is emptied by the next newGame',
    url: PAGE,
    async run({ check, ev }) {   // minimal sequence found by the rules 1-4 property: add -> save -> load -> newGame left the chest's goods in place
      const r = await ev(async () => {
        const A = threedogThreads.all;
        if (!engine.has('inventory')) engine.use(A.inventory());
        engine.inventory.define('apple', { name: 'Apple', stack: 4 });
        await engine.session.newGame();
        const chest = engine.inventory.container('chest2', { capacity: 3 });
        engine.ops.allow(() => chest.add('apple', 2, { silent: true }));
        await engine.saves.save('reg'); await engine.saves.flush(); await engine.saves.load('reg');
        const afterLoad = chest.list().length;
        await engine.session.newGame();
        return { afterLoad, afterNew: chest.list().length };
      });
      check('the load restores the chest, newGame empties it', r.afterLoad === 1 && r.afterNew === 0, JSON.stringify(r));
    },
  },
  {
    name: 'Properties: batch engine.use that fails leaves the module table and hooks exactly as before',
    url: PAGE,
    async run({ check, ev }) {
      const modArb = fc && fc.record({
        n: fc.integer({ min: 0, max: 3 }), fixed: fc.boolean(), fail: fc.constantFrom('none', 'none', 'install', 'stage'),
        req: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }), ret: fc.boolean(),
      });
      const seqArb = fc && fc.array(fc.array(modArb, { minLength: 1, maxLength: 3 }), { maxLength: 8 });
      await prop(check, 'rule 5: a failed use() batch changes nothing; a good batch installs all of it', 'Properties: batch engine.use', seqArb, batches => ev(batches => {
        const E = threedogThreads.createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'pbt-use' });
        const own = () => E.moduleOrder.filter(n => n.startsWith('pb')), h0 = E._hooks.fixed.length;
        const hooks = () => E._hooks.fixed.length - h0;
        try {
          for (let b = 0; b < batches.length; b++) {
            const list = batches[b].map(m => ({ name: 'pb' + m.n, ...(m.fixed && { fixed() {} }), ...(m.req != null && { requires: ['pb' + m.req] }),
              ...(m.fail === 'stage' && { stage: 'bogus' }), install() { if (m.fail === 'install') throw new Error('boom'); return m.ret ? {} : undefined; } }));
            const order = own(), n = hooks(), fixedOf = () => own().length;
            let threw = false;
            try { E.use(...list); } catch { threw = true; }
            const fail = m => `batch ${b} ${JSON.stringify(batches[b])}: ${m}`;
            if (threw && (own().join() !== order.join() || hooks() !== n)) return fail(`threw but table changed: ${order} -> ${own()} (hooks ${n} -> ${hooks()})`);
            if (!threw && !list.every(m => E.has(m.name))) return fail('returned without error but a module of the batch is missing');
            for (const nm of own()) if (!E.has(nm)) return fail(`moduleOrder lists ${nm} but has() is false`);
            for (const nm of ['pb0', 'pb1', 'pb2', 'pb3']) if (E.has(nm) !== own().includes(nm)) return fail(`has(${nm}) disagrees with moduleOrder`);
            // hooks: one fixed hook per installed module that declares it. Track which installed pb modules declared fixed.
            if (!threw) for (const m of batches[b]) (E.__fx ??= {})['pb' + m.n] ??= m.fixed;
            const expect = own().filter(nm => E.__fx?.[nm]).length;
            if (hooks() !== expect) return fail(`fixed hooks ${hooks()} but ${expect} installed modules declare fixed`);
            void fixedOf;
          }
          return null;
        } finally { E.dispose(); }
      }, batches));
    },
  },
];
