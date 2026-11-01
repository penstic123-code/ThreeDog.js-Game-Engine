// describe().render: current renderer / post / light values, each tagged engine | style | game (core/describeRender.js).
export const specs = [
  {
    name: 'describe render: values listed, a change made by the game is tagged game (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const before = engine.describe().render;
        engine.setToneMapping('neutral');
        return { before, after: engine.describe().render, text: engine.describeText({ full: true }) };
      });
      check(r.before.toneMapping.by !== 'game', 'tone mapping untouched is not tagged game');
      check(r.after.toneMapping.value === 'neutral' && r.after.toneMapping.by === 'game', 'setToneMapping by the game shows as game');
      check(Array.isArray(r.before.post) && Array.isArray(r.before.lights) && r.before.lights.length > 0, 'post and lights lists present');
      check(/^renderer: /m.test(r.text), 'full text has the renderer line');
    },
  },
];
