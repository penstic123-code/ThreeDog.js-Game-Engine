// flow.transition whose fn lands in a frozen state (title screen etc.) finishes on a stepped page too, and the next transition runs.
export const specs = [
  {
    name: 'flow: a stepped transition into a frozen state finishes, then the next one runs',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const tick = () => new Promise(r => setTimeout(r, 0));
        engine.haltLoop();
        engine.flow.define('frozenTitle', { freeze: true, lockInput: true });
        engine.flow.transition(() => engine.flow.go('frozenTitle'), {});
        await tick(); for (let i = 0; i < 10 && engine.flow.transitioning; i++) { await tick(); engine.step(1, { render: false }); engine.step(1 / 60); await tick(); }
        const first = { done: !engine.flow.transitioning, state: engine.flow.state };
        let ran2 = false;
        engine.flow.transition(() => { ran2 = true; engine.flow.go('playing'); }, {});
        await tick(); for (let i = 0; i < 10 && engine.flow.transitioning; i++) { await tick(); engine.step(1, { render: false }); engine.step(1 / 60); await tick(); }
        return { first, second: { done: !engine.flow.transitioning, ran2 } };
      });
      check('first transition ends in the frozen state', r.first.done && r.first.state === 'frozenTitle', JSON.stringify(r.first));
      check('the next transition runs', r.second.done && r.second.ran2, JSON.stringify(r.second));
    },
  },
];
