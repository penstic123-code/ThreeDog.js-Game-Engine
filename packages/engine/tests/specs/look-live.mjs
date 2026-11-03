// look.materials live keys (render/lookSurface.js LIVE_KEYS): plain numeric / color properties reach materials already made for the role;
// shader keys (detail, patch ...) are for new materials only, and appliesTo says which is which. Same format as the other files here.
export const specs = [
  {
    name: 'look.materials live keys: color / opacity change materials already made for the role; shader keys (detail) wait for new materials; appliesTo names the live keys',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const L = engine.look, out = {};
        const old = engine.makeMaterial('prop'), k0 = old.customProgramCacheKey();
        const h = L.materials.set({ prop: { color: 0x00ff00, opacity: 0.5 } }, { owner: 'live' });
        out.live = [old.color.getHex() === 0x00ff00, old.opacity === 0.5];
        out.fresh = engine.makeMaterial('prop').color.getHex() === 0x00ff00;
        const h2 = L.materials.set({ prop: { detail: { noise: 'grain', strength: 0.2 } } }, { owner: 'live2' });
        out.shaderKeyOld = old.customProgramCacheKey() === k0;
        h2.remove(); h.remove();
        // 优先级：风格值 / 调用传色 / 手设色 三个材质，set 后只有第一个变，并有一条警告（§5.1）
        const plain = engine.makeMaterial('prop'), called = engine.makeMaterial('prop', { color: 0x112233 }), hand = engine.makeMaterial('prop');
        hand.color.set(0x445566);
        const w = await __t.warns(() => L.materials.set({ prop: { color: 0xff0000 } }, { owner: 'prio' }));
        out.prio = { plain: plain.color.getHex() === 0xff0000, called: called.color.getHex() === 0x112233, hand: hand.color.getHex() === 0x445566,
          warn: w.warns.filter(x => x.includes("skipped 1 'prop' material(s) whose color you set directly")).length };
        L.materials._clear('prio');
        out.note = engine.catalog('look.materials').appliesTo ?? '';
        return out;
      });
      check('numeric / color keys reach the material made before the set', r.live[0] && r.live[1] && r.fresh, JSON.stringify(r));
      check('a shader key (detail) does not touch the material made before', r.shaderKeyOld, JSON.stringify(r));
      check('live keys skip the call own keys and hand-set values (one warning); style-valued materials change', r.prio.plain && r.prio.called && r.prio.hand && r.prio.warn === 1, JSON.stringify(r.prio));
      check('appliesTo names the live keys', /color/.test(r.note) && /opacity/.test(r.note) && /detail/.test(r.note), r.note);
    },
  },
];
