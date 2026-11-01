// look.materials live keys (render/lookSurface.js LIVE_KEYS): plain numeric / color properties reach materials already made for the role;
// shader keys (detail, patch ...) are for new materials only, and appliesTo says which is which. Same format as specs.mjs.
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
        out.note = engine.catalog('look.materials').appliesTo ?? '';
        return out;
      });
      check('numeric / color keys reach the material made before the set', r.live[0] && r.live[1] && r.fresh, JSON.stringify(r));
      check('a shader key (detail) does not touch the material made before', r.shaderKeyOld, JSON.stringify(r));
      check('appliesTo names the live keys', /color/.test(r.note) && /opacity/.test(r.note) && /detail/.test(r.note), r.note);
    },
  },
];
