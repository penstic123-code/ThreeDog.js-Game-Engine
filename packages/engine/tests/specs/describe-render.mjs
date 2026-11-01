// describe().render: current renderer / post / light values, each tagged engine | style | game (core/describeRender.js).
export const specs = [
  {
    name: 'describe render: values listed, a change made by the game is tagged game (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const before = engine.describe().render;
        engine.look.tone.set({ mapping: 'neutral' });
        return { before, after: engine.describe().render, lookBy: engine.describe().look.tone.mapping.by, text: engine.describeText({ full: true }) };
      });
      check(r.before.toneMapping.by !== 'game', 'tone mapping untouched is not tagged game');
      check(r.after.toneMapping.value === 'neutral' && r.after.toneMapping.by === 'look.tone.mapping' && r.lookBy === 'game', 'look.tone.set by the game: render.by points at describe().look, which says game');
      check(Array.isArray(r.before.post) && Array.isArray(r.before.lights) && r.before.lights.length > 0, 'post and lights lists present');
      check(r.before.lights.every(l => l.source === 'engine-default'), 'default lights are marked engine-default');
      check(/^renderer: /m.test(r.text), 'full text has the renderer line');
    },
  },
  {
    name: 'describe heldBy: pause / freeze / camera / debug view owners come in one shape (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const none = engine.describe().time.heldBy;
        const p = engine.pause('t-pause'), f = engine.freeze('t-freeze'), c = engine.takeCamera('t-cam'), v = engine.debug.view('normals', { owner: 't-view' });
        const held = engine.describe().time.heldBy;
        p.remove(); f.remove(); c.remove(); engine.debug.clear('t-view');
        return { none, held, after: engine.describe().time.heldBy };
      });
      const shape = o => Array.isArray(o) && o.every(x => typeof x.owner === 'string' && typeof x.at === 'number');
      check(['pause', 'freeze', 'camera', 'debugView'].every(k => r.held[k]?.[0]?.owner === 't-' + (k === 'debugView' ? 'view' : k === 'camera' ? 'cam' : k)), 'each kind lists its owner', JSON.stringify(r.held));
      check(Object.values(r.held).every(shape), 'every kind has the same [{ owner, at }] shape');
      check(!r.after.pause && !r.after.freeze && !r.after.camera && !r.after.debugView, 'released claims leave the list', JSON.stringify(r.after));
    },
  },
];
