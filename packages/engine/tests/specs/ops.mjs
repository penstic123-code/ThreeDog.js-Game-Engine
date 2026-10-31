// engine.ops: the one entry point for actions (core/Ops.js). Same format as specs.mjs; appended at the end of specs.mjs.
import { runScenario, pageDriver } from '@threedog/tools/scenario';
export const specs = [
  {
    name: 'ops-core: define / run / can / list / recent, nesting depth, ring history, failure merging, phase',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const O = engine.ops, log = [];
        let gold = 3;
        const hs = [
          O.define('test.buy', {
            desc: 'buy', args: { n: 'int?' },
            can: (e, { n = 1 }) => gold >= n ? true : 'noMoney',
            run: (e, { n = 1 }, ctx) => { gold -= n; log.push(ctx.source + '/' + ctx.actor); e.ops.run('test.give', { n }); return n; },
            offers: () => [{ n: 1 }, { n: 9 }],
          }),
          O.define('test.give', { args: { n: 'int' }, run: (e, a, ctx) => { log.push('give:' + ctx.actor); } }),
          O.define('test.ping', { run: () => 'pong' }),
        ];
        const a = O.run('test.buy', { n: 2 }), b = O.run('test.buy', { n: 2 }), c = O.run('test.buy', { n: 2 });
        const npc = O.run('test.buy', { n: 1 }, { actor: 'npc_1', source: 'test' });
        const asked = O.can('test.buy', { n: 5 }), before = O.recent().length;
        const hist = O.recent().filter(h => h.name.startsWith('test.')).map(h => [h.name, h.ok, h.reason, h.depth, h.count, h.phase]);
        gold = 5;
        const avail = O.list({ available: true }).filter(x => x.name.startsWith('test.')).map(x => `${x.name}:${JSON.stringify(x.args)}:${x.ok}:${x.reason ?? ''}`);
        const names = O.list().filter(x => x.name.startsWith('test.')).map(x => x.name);
        // ring: wrap around a 4-entry history
        O.historySize = 4;
        for (let i = 0; i < 6; i++) O.run('test.ping');
        const ring = O.recent().map(h => h.seq), ringLen = ring.length;
        O.historySize = 256;
        // phase: inside a fixed step vs between steps
        engine.pause();
        const fh = engine.onFixed(() => { if (!fh.done) { fh.done = true; O.run('test.ping'); } });
        engine.step(1 / 60, { render: false }); fh.remove();
        O.run('test.ping');
        const ph = O.recent('test.ping').slice(-2).map(h => h.phase + '/' + h.source + '/' + (h.tick === engine.tick));
        for (const h of hs) h.remove();
        return { a, b, c, npc, asked, before, hist, avail, names, log, ring, ringLen, ph, after: O.list().some(x => x.name.startsWith('test.')) };
      });
      check('run returns { ok, value } / { ok: false, reason }; can only asks', r.a.ok && r.a.value === 2 && !r.b.ok && r.b.reason === 'noMoney' && r.npc.ok && !r.asked.ok && r.asked.reason === 'noMoney', JSON.stringify(r));
      check('Nested op: depth 1, logged after its parent; actor and source are inherited', JSON.stringify(r.hist.slice(0, 2)) === JSON.stringify([['test.buy', true, null, 0, 1, 'between'], ['test.give', true, null, 1, 1, 'between']]) && r.log.join() === 'player/player,give:player,test/npc_1,give:npc_1', JSON.stringify({ hist: r.hist, log: r.log }));
      check('Consecutive identical failures merge into one entry with count', r.hist[2]?.[0] === 'test.buy' && r.hist[2][4] === 2, JSON.stringify(r.hist));
      check('list() names, list({ available }) runs can on each offer; an op without args or offers is checked with {}',
        r.names.join() === 'test.buy,test.give,test.ping' && r.avail.join('|') === 'test.buy:{"n":1}:true:|test.buy:{"n":9}:false:noMoney|test.ping:{}:true:', JSON.stringify(r.avail));
      check('Ring history keeps the newest entries in order', r.ringLen === 4 && r.ring.every((s, i) => i === 0 || s === r.ring[i - 1] + 1), JSON.stringify(r.ring));
      check('phase: fixed inside a fixed step (source game), between outside (source player)', r.ph.join() === 'fixed/game/true,between/player/true', JSON.stringify(r.ph));
      check('remove() unregisters', !r.after);
    },
  },
  {
    name: 'ops-core: dev errors say how to fix it; run throwing freezes gameplay with the op in engine.error',
    url: '/tests/city/index.html',
    expectErrors: /kaboom/,   // test.boom throws on purpose
    async run({ check, ev }) {
      const r = await ev(() => {
        const O = engine.ops, errs = {};
        const t = (k, f) => { try { f(); errs[k] = null; } catch (e) { errs[k] = e.message; } };
        const h = O.define('shop.buy', { args: { shop: 'string', item: 'string', n: 'int?' }, can: () => true, run: () => 1 });
        t('unknown', () => O.run('shop.by', { shop: 'a', item: 'b' }));
        t('vector', () => O.run('shop.buy', { shop: 'a', item: 'b', n: new engine.THREE.Vector3() }));
        t('missing', () => O.run('shop.buy', { shop: 'a' }));
        t('extra', () => O.run('shop.buy', { shop: 'a', item: 'b', itme: 1 }));
        t('wrong', () => O.run('shop.buy', { shop: 'a', item: 'b', n: 1.5 }));
        t('dup', () => O.define('shop.buy', { run() {} }));
        t('badName', () => O.define('ShopBuy', { run() {} }));
        t('badKey', () => O.define('shop.sell', { run() {}, cann() {} }));
        O.define('test.noReason', { can: () => false, run() {} });
        t('canResult', () => O.run('test.noReason'));
        O.define('test.canWrites', { can: () => { engine.vars.setFlag('x'); return true; }, run() {} });
        t('canWrote', () => O.run('test.canWrites'));
        O.define('test.loop', { run: e => e.ops.run('test.loop') });
        t('loop', () => O.run('test.loop'));
        const args = { shop: 'a', item: 'b' }; O.run('shop.buy', args);
        t('frozenArgs', () => { 'use strict'; args.item = 'c'; });
        O.define('test.boom', { run() { throw new Error('kaboom'); } });
        const boom = O.run('test.boom');
        const err = engine.error && { where: engine.error.where, ops: engine.error.ops, frozen: engine.frozen };
        const halted = O.run('shop.buy', { shop: 'a', item: 'b' });
        engine.error = null; engine.unfreeze('error');
        engine.freeze('menu'); let seen; O.define('test.peek', { run: (e, a, ctx) => { seen = ctx.frozen; } }); const pk = O.run('test.peek'); engine.unfreeze('menu');
        for (const n of ['shop.buy', 'test.noReason', 'test.canWrites', 'test.loop', 'test.boom', 'test.peek']) O.defs.delete(n);
        h.remove();
        return { errs, boom, err, halted, pk, seen };
      });
      const e = r.errs;
      check('Unknown op: did you mean', /did you mean.*shop\.buy/i.test(e.unknown), e.unknown);
      check('Vector3 argument: pass plain data [x, y, z]', /n is a Vector3; pass plain data: n: \[x, y, z\]/.test(e.vector), e.vector);
      check('Missing / unknown / wrong-type argument name the shape', /missing item \(args:/.test(e.missing) && /unknown argument itme \(did you mean item\?\)/.test(e.extra) && /n should be int, got 1\.5/.test(e.wrong), JSON.stringify([e.missing, e.extra, e.wrong]));
      check('define: duplicate / bad name / unknown field', /already defined.*remove\(\)/.test(e.dup) && /noun\.verb/.test(e.badName) && /did you mean can\?/.test(e.badKey), JSON.stringify([e.dup, e.badName, e.badKey]));
      check('can must return true or a reason; can must not change state', /must return true or a reason string, e\.g\. return 'noMoney'/.test(e.canResult) && /can changed state \(vars\.setFlag\)/.test(e.canWrote), JSON.stringify([e.canResult, e.canWrote]));
      check('Ops calling each other in a loop are reported', /in a loop.*test\.loop -> test\.loop/.test(e.loop), e.loop);
      check('Args passed to run are frozen in dev (pass a fresh object each call)', /read.only|frozen|not extensible/i.test(e.frozenArgs || ''), e.frozenArgs);
      check('run throwing: reason error, engine.error.where names the op, recent ops attached, gameplay frozen; later ops are halted',
        r.boom.reason === 'error' && r.err?.where === "ops.run('test.boom')" && r.err.frozen && r.err.ops?.at(-1) === 'test.boom x error' && r.halted.reason === 'halted', JSON.stringify(r));
      check('Ops still run while frozen by a menu; ctx.frozen is true', r.pk.ok && r.seen === true, JSON.stringify({ pk: r.pk, seen: r.seen }));
    },
  },
  {
    name: 'ops-core perf: 10,000 run() calls (dev checks on) stay in the low milliseconds',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        let n = 0;
        const h = engine.ops.define('test.hit', { args: { amount: 'number' }, can: (e, a) => a.amount > 0 || 'zero', run: (e, { amount }) => { n += amount; } });
        const t0 = performance.now();   // measure
        for (let i = 0; i < 10000; i++) engine.ops.run('test.hit', { amount: 1 });
        const ms = performance.now() - t0;   // measure
        h.remove();
        return { ms: Math.round(ms * 10) / 10, n };
      });
      console.log(`    ops.run x10000: ${r.ms} ms`);
      check('10,000 runs finish under 100 ms and all apply', r.n === 10000 && r.ms < 100, JSON.stringify(r));
    },
  },
  {
    name: 'ops-guard: gameplay state written outside fixed steps and ops is reported in dev; loading, fixed, ops, saves and applyState pass',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const warns = [], orig = console.warn;
        console.warn = (...a) => { warns.push(String(a[0])); };
        const W = engine.world, I = engine.inventory, guardWarns = () => warns.filter(w => w.includes('outside a fixed step'));
        const quiet = {}, n = () => guardWarns().length;
        // allowed: inside an op, a fixed step, save load, applyState
        const h = engine.ops.define('test.give', { run: e => { e.world.add({ id: 'guard_crate', kind: 'crate', position: [0, 0, 0] }, { save: false }); e.inventory.add('film', 1, { silent: true }); } });
        engine.ops.run('test.give'); h.remove(); quiet.op = n();
        engine.pause();
        const fh = engine.onFixed(() => { if (!fh.n) { fh.n = 1; W.set('guard_crate', { hp: 1 }); I.add('film', 1, { silent: true }); } });
        engine.step(1 / 30, { render: false }); fh.remove(); quiet.fixed = n();
        // reported: a frame callback and a timer write gameplay state
        const fr = engine.onFrame(() => { if (!fr.n) { fr.n = 1; W.set('guard_crate', { hp: 3 }); } });
        engine.step(1 / 30, { render: false }); fr.remove();
        await new Promise(res => setTimeout(() => { I.add('film', 1, { silent: true }); res(); }, 0));   // presentation: the misuse under test
        const reported = guardWarns();
        engine.saves.save('guard'); engine.saves.load('guard'); quiet.load = n() - reported.length;
        await engine.applyState({ time: '10:00' }); quiet.apply = n() - reported.length;
        console.warn = orig;
        engine.resume();
        return { quiet, warns: reported };
      });
      check('[guard] fixed step, op, save load and applyState write without a warning', Object.values(r.quiet).every(n => n === 0), JSON.stringify(r.quiet));
      check('[guard] world.set in onFrame and inventory.add in setTimeout are reported with the fix engine.ops.run',
        r.warns.length === 2 && r.warns.some(w => w.includes('world.set')) && r.warns.some(w => w.includes('inventory.add')) && r.warns.every(w => w.includes("engine.ops.run('name', args)")), JSON.stringify(r.warns));
    },
  },
  {
    name: 'ops built-ins: the interact key and the prompt run interaction.use, dialogue keys run dialogue.*, inventory.transfer, content { op } / { can }',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const I = engine.interactions, inp = engine.input, used = [];
        const p = engine.player.position, h = I.add([p.x + 0.5, p.y, p.z], { id: 'test-lever', label: 'lever', onUse: () => used.push('lever') });
        engine.step(0.1, { render: false });
        inp._keyDown('KeyE', 'keyboard'); engine.step(1 / 30, { render: false }); inp._keyUp('KeyE'); engine.step(1 / 30, { render: false });
        const key = engine.ops.recent('interaction.use').at(-1);
        document.querySelector('.threedog-prompt').click();   // the default 'prompt' UI part
        const click = engine.ops.recent('interaction.use').at(-1);
        h.remove();
        const gone = engine.ops.run('interaction.use', { id: 'test-lever' }).reason;
        // dialogue: digits pick through dialogue.choose
        const D = engine.dialogue;
        D.define('ops-test', { start: { text: 'x', choices: [{ text: 'A', next: 'a' }, { text: 'B', next: 'end' }] }, a: { text: 'picked A' } });
        D.start('ops-test'); engine.step(0.5, { render: false });
        inp._keyDown('Digit1', 'keyboard'); engine.step(1 / 30, { render: false }); inp._keyUp('Digit1'); engine.step(1 / 30, { render: false });
        const chose = engine.ops.recent('dialogue.choose').at(-1), line = D.full;
        D.end();
        const noDlg = engine.ops.can('dialogue.advance').reason;
        // inventory.transfer
        const inv = engine.inventory;
        engine.ops.allow(() => { inv.container('ops-chest', { capacity: 2 }); inv.add('film', 2, { silent: true }); });
        const t1 = engine.ops.run('inventory.transfer', { from: 'player', to: 'ops-chest', item: 'film', n: 2 });
        const t2 = engine.ops.run('inventory.transfer', { from: 'player', to: 'ops-chest', item: 'film', n: 99 }).reason;
        const t3 = engine.ops.run('inventory.transfer', { from: 'nope', to: 'player', item: 'film' }).reason;
        // content: { op } / { can } and a misspelled op name
        let n = 0;
        const hd = engine.ops.define('test.count', { can: () => n < 1 || 'enough', run: () => { n++; } });
        const acts = engine.describe().actions?.find(a => a.op === 'test.count');
        const actText = engine.describeText().split('\n').find(l => l.startsWith('Can do (engine.ops)')) || '';
        engine.content.load({ dialogues: { opsc: { nodes: { start: { text: 'y', choices: [{ text: 'go', if: { can: ['test.count'] }, do: { op: ['test.count'] }, next: 'end' }] } } } } });
        D.start('opsc'); engine.step(0.5, { render: false });
        const shown = D._visible().length;
        engine.ops.run('dialogue.choose', { index: 0 });
        D.start('opsc'); engine.step(0.5, { render: false });
        const hidden = D._visible().length; D.end();
        let typo = null;
        try { engine.content.load({ dialogues: { opst: { nodes: { start: { text: 'z', choices: [{ text: 'go', do: { op: ['test.cuont'] } }] } } } } }); } catch (e) { typo = e.message; }
        hd.remove();
        engine.resume();
        return { used, key: key && `${key.source}/${key.phase}/${key.args.id}`, click: click && click.source, gone, chose: chose && `${chose.args.index}/${chose.ok}`, line, noDlg, t1, t2, t3, n, shown, hidden, typo, acts, actText };
      });
      check('[guard] pressing E runs interaction.use (source player, phase fixed) with the interaction id; the prompt click runs it too', r.key === 'player/fixed/test-lever' && r.click === 'player' && r.used.length === 2, JSON.stringify(r));
      check('A removed interaction is refused with a reason', r.gone === 'unknown', r.gone);
      check('[guard] a digit key in a dialogue runs dialogue.choose; advance without a dialogue says noDialogue', r.chose === '0/true' && r.line === 'picked A' && r.noDlg === 'noDialogue', JSON.stringify(r));
      check('inventory.transfer: moves, and refuses with notEnough / noContainer', r.t1.ok && r.t1.value === 2 && r.t2 === 'notEnough' && r.t3 === 'noContainer', JSON.stringify([r.t1, r.t2, r.t3]));
      check('content { can } shows a choice only when the op would succeed, { op } runs it', r.shown === 1 && r.n === 1 && r.hidden === 0, JSON.stringify(r));
      check('describe().actions lists ops on offer (max 8) and describeText prints one line', r.acts?.ok === true && r.actText.includes('✓ test.count'), JSON.stringify({ a: r.acts, t: r.actText }));
      check('content naming a missing op fails at load with did you mean', /test\.cuont.*did you mean.*test\.count/i.test(r.typo || ''), r.typo);
    },
  },
  {
    name: 'ops scenario runner: a misspelt op or step field fails before any step runs',
    url: '/?cutscene=skip',
    async run({ page, check, ev }) {
      const res = [], err = async sc => { try { await runScenario(pageDriver(page), sc, { check: (l, ok) => res.push(ok) }); return null; } catch (e) { return e.message; } };
      const before = await ev(() => engine.ops.recent().length);
      const typo = await err({ name: 't', steps: [{ op: 'barter.buy', args: { shop: 'fisher-basket', item: 'berry' } }, { op: 'barter.bye', args: {} }] });
      const after = await ev(() => engine.ops.recent().length);
      const field = await err({ name: 't', steps: [{ op: 'barter.buy', arg: {} }] });
      check('[guard] unknown op name -> did you mean, and no step ran', /barter\.bye.*did you mean 'barter\.buy'/.test(typo || '') && after === before && !res.length, typo);
      check('unknown step field -> did you mean', /"arg".*did you mean 'args'/.test(field || ''), field);
    },
  },
  {
    name: 'ops load separator; commits: a save load drops results requested for the old world; threads.pure names a free variable at registration',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const E = engine, got = [];
        E.pause();
        await E.saves.save('t-epoch');
        E.jobs.add(function* () { for (let i = 0; i < 3; i++) yield; return 'job'; }, { apply: v => got.push(v), lag: 3 });
        E.commits.request({ lag: 3, apply: () => got.push('plain'), fallback: () => 0 });
        E.commits.request({ lag: 3, apply: () => got.push('valid'), fallback: () => 0, valid: () => true });
        await E.saves.load('t-epoch');
        const sep = E.ops.recent().at(-1);
        E.step(0.2, { render: false });
        E.jobs.add(() => 'after', { apply: v => got.push(v), lag: 1 });
        E.step(0.1, { render: false });
        let pure; try { const SPEED = 2; E.threads.pure(rec => { rec.v = SPEED; }, 'test far'); } catch (e) { pure = e.message; }
        const okPure = E.threads.pure((rec, dt) => { const { a = 1 } = rec; rec.v = Math.max(a, dt); }, 'test ok').call({}, 2);
        return { got, sep: sep && sep.name + '/' + sep.ok, pure, okPure };
      });
      check('[guard] a job and a plain request from before the load are dropped; one with valid decides itself; later jobs apply', r.got.join() === 'valid,after', JSON.stringify(r.got));
      check('a save load writes a separator into the op history', r.sep === '(load)/true', r.sep);
      check('threads.pure: a free variable fails at registration naming it; a valid function still compiles', /test far.*'SPEED'/.test(r.pure || '') && r.okPure === undefined, r.pure);
    },
  },
  {
    name: 'ops photo.take: the photo key runs the op; refused with the canTake reason and photo:denied { reason }; the button path logs too',
    url: '/?cutscene=skip',
    async run({ page, check, ev, frames }) {
      await ev(() => { engine.pause(); window._denied = []; engine.events.on('photo:denied', d => window._denied.push(d.reason)); });
      const film0 = await ev(() => engine.inventory.count('film'));
      await page.keyboard.down('KeyP'); await ev(() => engine.step(1 / 30)); await page.keyboard.up('KeyP');
      const r = await ev(() => {
        const key = engine.ops.recent('photo.take').at(-1), film1 = engine.inventory.count('film');
        engine.ops.allow(() => engine.inventory.remove('film', film1));
        document.getElementById('shoot').click();
        return { key: key && key.source + '/' + key.ok, film1, last: engine.ops.recent('photo.take').at(-1).reason, denied: window._denied };
      });
      check('[guard] P runs photo.take (source player) and the film is used inside the op', r.key === 'player/true' && r.film1 === film0 - 1, JSON.stringify(r));
      await page.keyboard.down('KeyP'); await ev(() => engine.step(1 / 30)); await page.keyboard.up('KeyP');
      const denied = await ev(() => window._denied);
      check('without film the shutter button is refused with noFilm (logged); the key path emits photo:denied { reason }', r.last === 'noFilm' && denied.join() === 'noFilm', JSON.stringify({ r, denied }));
    },
  },
  {
    name: 'ops inspect / explain: nearby ops with reasons, why an op cannot run, where a quest is stuck',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        const E = engine, B = { shop: 'fisher-basket', item: 'feather' };
        E.ops.run('barter.buy', { ...B }); const sold = E.ops.run('barter.buy', { ...B });
        const ex = E.explain({ op: 'barter.buy', args: { ...B } });
        const ins = E.inspect(), npc = E.inspect('fisher');
        E.quests.define('t-q', { title: 'T', steps: [{ text: 'find the key', done: () => false }] });
        E.ops.allow(() => E.quests.start('t-q'));
        let bad; try { E.explain({ qeust: 'x' }); } catch (e) { bad = e.message; }
        return { sold: sold.reason, ex, ins: ins.ops.find(o => o.args?.item === 'feather'), npcActor: npc.actor, q: E.explain({ quest: 't-q' }).text, bad };
      });
      check('explain({ op }) says why not, with the reasons note and the last attempt', r.sold === 'soldOut' && !r.ex.ok && /soldOut \(The basket has none left\)$/.test(r.ex.text) && /last attempt.*soldOut/.test(r.ex.detail) && r.ex.recent.length === 2, JSON.stringify(r.ex));
      check('inspect() lists ops on offer with reason and why; inspect(id) acts as that record', r.ins?.ok === false && r.ins.why === 'The basket has none left' && r.npcActor === 'fisher', JSON.stringify(r.ins));
      check('explain({ quest }) names the step it waits on (module explain hook)', /waits on step 1\/1 "find the key"/.test(r.q), r.q);
      check('explain with an unknown key -> did you mean', /did you mean 'quest'/.test(r.bad || ''), r.bad);
    },
  },
];
