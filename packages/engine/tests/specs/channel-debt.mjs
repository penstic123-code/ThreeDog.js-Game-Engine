// Time a record owes is the time it lived through. world.simulate settles far work late, in batches; the rate at settlement must not rewrite the past.
export const specs = [
  {
    name: '[guard] Channel debt: far, skip, one record\'s own rate and a saved debt each pay the time as it passed, not at the rate of the settlement',
    url: '/?threedog-headless',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const E = engine, W = E.world, sum = {};
        const put = id => W.add({ id, kind: 'cd-far', position: { x: 0, y: 0, z: 0 } });
        E.time.channel('cdSlow');
        W.simulate('cd-far', { far: (rec, dt) => { sum[rec.id] = (sum[rec.id] ?? 0) + dt; }, farEvery: 1, channel: 'cdSlow' });
        const slow = () => E.mod('time.cdSlow', { owner: 'cd', mul: 0.5 });
        // far turns fall on a record's bucket: stop right after its settlement, so the next one closes the second under test
        const align = id => { const v = sum[id]; for (let i = 0; i < 120 && sum[id] === v; i++) E.step(1 / 60); sum[id] = 0; };
        put('cd-a');
        align('cd-a');
        // half at 1x, half at 0.5x is 0.75, wherever the settlement falls

        E.step(0.5);
        let m = slow();
        E.step(0.5);
        const far1 = sum['cd-a'];
        m.remove();
        sum['cd-a'] = 0;
        m = slow();
        E.step(0.5); m.remove(); E.step(0.5);
        const far2 = sum['cd-a'];
        // one record's own rate
        put('cd-b');
        align('cd-b');
        sum['cd-a'] = 0;
        m = E.mod('time.local', { owner: 'cd', id: 'cd-b', set: 0 });
        E.step(0.5); m.remove(); E.step(0.5);
        const own = { a: sum['cd-a'], b: sum['cd-b'] };
        // skip settles the same way: 0.25 at 1x stepped, 0.25 + 0.5 at 0.5x
        align('cd-a');
        E.step(0.25);
        m = slow();
        E.step(0.25);
        await E.skip({ seconds: 0.5 * E.clock.speed });
        m.remove();
        const skipped = sum['cd-a'];
        // a save between: the debt comes back as it was
        align('cd-a');
        E.step(0.5);
        const saved = JSON.parse(JSON.stringify(W.toJSON()));
        const keys = Object.keys(saved);
        W.fromJSON(saved);
        m = slow();
        E.step(0.5);
        m.remove();
        const load = sum['cd-a'];
        // an old save has only the real seconds: it pays them at the rate it first meets
        align('cd-a');
        const old = JSON.parse(JSON.stringify(W.toJSON()));
        delete old.marks; old.owed = { 'cd-a': 0.5 };
        W.fromJSON(old);
        E.step(1);
        return { far1, far2, own, skipped, load, legacy: sum['cd-a'], keys };
      });
      const near = (a, b) => Math.abs(a - b) < 0.04;
      check(`half normal, half slow, settled slow: 0.75 (${r.far1})`, near(r.far1, 0.75));
      check(`half slow, half normal, settled normal: 0.75 (${r.far2})`, near(r.far2, 0.75));
      check(`a record stopped for half the second owes half of it (${r.own.b})`, near(r.own.b, 0.5));
      check(`its neighbour on the same channel owes the whole second (${r.own.a})`, near(r.own.a, 1));
      check(`skip pays each stretch at its rate: 0.625 (${r.skipped})`, near(r.skipped, 0.625));
      check(`a saved debt keeps its past: 0.5 + 0.25 (${r.load})`, near(r.load, 0.75));
      check(`a save with no marks still pays what it owes (${r.legacy})`, near(r.legacy, 1.5));
      check('the save holds the debt', r.keys.includes('marks'));
    },
  },
  {
    name: '[guard] Channel debt: a record faster than its channel saves a mark below zero, and that save loads with the mark unchanged',
    url: '/?threedog-headless',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const E = engine, W = E.world;
        E.time.channel('cdFast');
        W.simulate('cd-quick', { far: () => {}, farEvery: 10, channel: 'cdFast' });
        W.add({ id: 'cd-q', kind: 'cd-quick', position: { x: 0, y: 0, z: 0 } });
        const m = E.mod('time.local', { owner: 'cd', id: 'cd-q', set: 2 });
        E.step(0.25);
        const saved = JSON.parse(JSON.stringify(W.toJSON()));
        let threw = null, bad = null;
        try { W.fromJSON(saved); } catch (err) { threw = err.code; }
        const back = W.toJSON().marks?.['cd-q'];
        // the rule is finite, not a range: what is no number stays refused
        try { W.fromJSON({ ...saved, marks: { 'cd-q': 'x' } }); } catch (err) { bad = err.code; }
        m.remove(); W.remove('cd-q');
        return { mark: saved.marks?.['cd-q'], back, threw, bad };
      });
      check(`the mark really is below zero (${r.mark})`, r.mark < 0);
      check(`the engine reads what it wrote (${r.threw})`, r.threw === null);
      check(`the mark comes back unchanged, not clamped (${r.back})`, r.back === r.mark);
      check(`a mark that is no number is still refused (${r.bad})`, r.bad === 'save-bad-record');
    },
  },
];
