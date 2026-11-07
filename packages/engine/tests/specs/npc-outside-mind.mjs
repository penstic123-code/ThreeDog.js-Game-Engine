// A custom NPC behaviour driven by a decision source outside the engine (a state machine that answers late, as an AI service would): its memory lives in rec.mind, the
// answer comes back through an op, and a save, a load or a reopened page must neither lose the memory nor let a stale answer land.
const READY = { timeout: 60000 };
const reload = async page => { await page.reload(); await page.waitForFunction(() => window.engine?.stateApplied, null, READY); };

// Runs in the page, on every page open: the game's own setup code. The behaviour is code, so each open registers it again; the record only keeps its name
const install = () => {
  const e = engine;
  window.brain = {
    open: new Map(),                            // id -> answer: held until the test lets it through, so "late" is exact
    table: { patrol: 'alert', alert: 'strike', strike: 'patrol' },   // the outside state machine
    ask(id, from) { return new Promise(r => this.open.set(id, () => r(this.table[from]))); },
    answer(id) { this.open.get(id)?.(); this.open.delete(id); },
    answerAll() { for (const id of [...this.open.keys()]) this.answer(id); },
  };
  // Tickets come from a page counter, never from the saved mind: a counter in the mind would go back on a load and hand a stale answer a ticket that matches.
  // live = tickets with a question open on this page: not saved, a question does not survive a load
  window.seq = 0; window.live = new Set();
  window.landed = [];
  e.ops.define('brain.answer', {
    args: { id: 'string', ticket: 'number', next: 'string' },
    can(en, a) { const m = en.world.get(a.id)?.mind; return m?.ticket === a.ticket && m.asking ? true : 'stale'; },
    run(en, a) { const m = en.world.get(a.id).mind; en.world.set(a.id, { mind: { ...m, state: a.next, asking: false, decided: (m.decided ?? 0) + 1 } }); },
  });
  e.ops.define('brain.strike', { args: {}, run(en, a, ctx) { const r = en.world.get(ctx.actor); en.world.set(ctx.actor, { strikes: (r.strikes ?? 0) + 1 }); } });
  e.npcs.behavior('brain', {
    near(rec, dt) {
      const m = rec.mind;
      m.nearT = (m.nearT ?? 0) + dt;
      if (m.asking && live.has(m.ticket)) return;
      if (m.state === 'strike') e.ops.run('brain.strike', {}, { actor: rec.id });
      m.ticket = ++seq; m.asking = true; live.add(m.ticket);   // no open question (or it died with a load): ask, under a new ticket
      const id = rec.id, ticket = m.ticket;                    // ids, not rec: a load replaces the record
      brain.ask(id, m.state).then(next => { landed.push(e.ops.run('brain.answer', { id, ticket, next })); });
    },
    far(rec, dt) { rec.mind.farT = (rec.mind.farT ?? 0) + dt; },
  });
};

export const specs = [
  {
    name: '[guard] NPC outside mind: an async decision source drives a custom behaviour through ops; its mind survives save, load and a reopened page, stale answers are refused, and the behaviour registers again',
    url: '/?cutscene=skip',
    async run({ page, check, ev }) {
      await ev(install);
      const a = await ev(async () => {
        engine.haltLoop();
        const P = engine.player, h = P.position;
        for (const [id, initial] of [['g-run', false], ['g-con', true]]) engine.npcs.add({ id, name: id, position: { x: h.x + 3, z: h.z + (initial ? 3 : -3) }, behavior: 'brain', mind: { state: 'patrol' }, initial });
        const settle = () => new Promise(r => setTimeout(r, 0));
        const tick = async () => { engine.step(0.1, { render: false }); brain.answerAll(); await settle(); };
        await tick(); await tick(); await tick();    // patrol -> alert -> strike -> patrol, one question per tick per NPC; 'strike' runs its op on the way
        const run = () => engine.world.get('g-run'), con = () => engine.world.get('g-con'), copy = v => JSON.parse(JSON.stringify(v));
        const o = { state: run().mind.state, decided: run().mind.decided, strikes: run().strikes, ops: engine.ops.recent('brain.strike').at(-1) };
        engine.step(0.1, { render: false });         // a question goes out
        // save with a question open, the answer lands after the save
        o.openAtSave = brain.open.size; o.saved = copy(run().mind); o.savedCon = copy(con().mind); o.savedStrikes = run().strikes;
        await engine.saves.save('mind'); await engine.saves.flush();
        brain.answerAll(); await settle();           // the world moves on past the save
        engine.step(0.1, { render: false });         // new questions go out: one is answered in the middle of the load, the other only after the NPC asked again
        landed.length = 0;
        const during = engine.saves.load('mind');
        brain.answer('g-run');
        await during; await settle();
        o.during = landed.slice();
        o.afterLoad = copy(run().mind); o.afterLoadCon = copy(con().mind); o.afterStrikes = run().strikes;
        // the loaded mind says "asking" under a ticket whose question died; the behaviour sees no live question and asks again
        live.clear();
        const late = brain.open.get('g-con'); brain.open.delete('g-con');
        const before = run().mind.ticket;
        engine.step(0.1, { render: false });
        o.reasked = run().mind.ticket !== before && run().mind.asking;
        late(); await settle();
        o.late = landed.at(-1); o.conAsking = con().mind.asking;
        brain.answerAll(); await settle();
        await engine.saves.save('mind2'); await engine.saves.flush();
        return o;
      });
      check('the outside machine walked patrol -> alert -> strike', a.state === 'patrol' && a.decided === 3 && a.strikes === 1, JSON.stringify(a));
      check('the game action went through ops, as the NPC, in the fixed step', a.ops?.actor === 'g-run' && a.ops.phase === 'fixed' && a.ops.ok, JSON.stringify(a.ops));
      check('load gives back the mind as saved (runtime NPC)', a.saved.ticket && JSON.stringify(a.afterLoad) === JSON.stringify(a.saved), JSON.stringify([a.saved, a.afterLoad]));
      check('load gives back the mind as saved (content NPC, in-place writes)', a.savedCon.ticket && JSON.stringify(a.afterLoadCon) === JSON.stringify(a.savedCon), JSON.stringify([a.savedCon, a.afterLoadCon]));
      check('a game fact set by an op comes back too', a.afterStrikes === a.savedStrikes);
      check('an answer landing during the load is refused', a.during.length === 1 && a.during[0].code === 'loading', JSON.stringify(a.during));
      check('a question that died with the load is asked again', a.reasked === true, JSON.stringify(a.reasked));
      check('an answer from before the load is stale, and the new question stays open', a.late?.code === 'stale' && a.conAsking === true, JSON.stringify(a.late));

      // the page is reopened: no behaviour exists yet. Loading first must keep the name and the mind, and the NPC stands still until the code is back
      await reload(page);
      const b = await ev(async () => {
        engine.haltLoop();
        const o = {};
        await engine.saves.load('mind2');
        const r = engine.world.get('g-run');
        o.mind = JSON.parse(JSON.stringify(r?.mind ?? null)); o.behavior = r?.behavior;
        engine.step(0.5, { render: false });
        o.same = JSON.stringify(engine.world.get('g-run').mind) === JSON.stringify(o.mind);
        return o;
      });
      check('a reopened page loads the record before the code exists: name and mind are kept, nothing runs', b.behavior === 'brain' && b.mind?.state && b.same, JSON.stringify(b));
      await ev(install);
      const c = await ev(async () => {
        const m0 = JSON.parse(JSON.stringify(engine.world.get('g-run').mind)), o = { m0 };
        // setup code adding the same NPC again after the load: it names the behaviour and passes no mind, so the memory stays
        engine.npcs.add({ id: 'g-run', name: 'g-run', behavior: 'brain' });
        o.kept = JSON.parse(JSON.stringify(engine.world.get('g-run').mind));
        engine.step(0.1, { render: false }); brain.answerAll(); await new Promise(r => setTimeout(r, 0));
        const m = engine.world.get('g-run').mind;
        o.state = m.state; o.decided = m.decided; o.landed = landed.map(r => r.ok);
        return o;
      });
      check('adding the NPC again by the same behaviour keeps its mind', JSON.stringify(c.kept) === JSON.stringify(c.m0), JSON.stringify(c));
      check('after registering again the behaviour runs on from the loaded mind', c.decided === (c.m0.decided ?? 0) + 1 && c.state === { patrol: 'alert', alert: 'strike', strike: 'patrol' }[c.m0.state] && c.landed.every(Boolean), JSON.stringify(c));
    },
  },
];
