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
  {
    name: 'render scale: describe().render.scale says upscaled / auto-lowered / floor, and the first auto-lowering warns once (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const warns = [], w0 = console.warn; console.warn = (...a) => { warns.push(String(a[0])); };
        try {
          engine.pause();
          const dpr = devicePixelRatio || 1, base = engine.describe().render.scale;
          const a = engine.adaptive; a.on = true; a.paused = false; a.target = 60; a.lowered = false; a.from = null;
          const max = a.max; engine.setPixelRatio(max);
          const slow = () => { for (let i = 0; i < 10; i++) engine._adapt(0.1); };
          engine.ready = true; slow(); slow();
          const low = engine.describe().render.scale;
          const text = engine.describeText({ full: true });
          engine.setPixelRatio(max); a.on = false;
          return { dpr, base, low, max, warns: warns.filter(x => /render scale/.test(x)), text };
        } finally { console.warn = w0; }
      });
      check(r.base.devicePixelRatio === r.dpr && typeof r.base.upscaled === 'boolean' && r.base.floor === 0.6, 'scale lists current / devicePixelRatio / upscaled / floor', JSON.stringify(r.base));
      check(r.low.autoLowered === true && r.low.current < r.max && r.low.upscaled === true, 'after auto-lowering: autoLowered and upscaled are true', JSON.stringify(r.low));
      check(r.warns.length === 1 && /->/.test(r.warns[0]) && /adaptiveResolution: false/.test(r.warns[0]), 'one dev warning names the change, the fps and how to turn it off', JSON.stringify(r.warns));
      check(/render scale: .*auto-lowered/.test(r.text), 'the text summary says so too');
    },
  },
];
