// [guard] A style pack is a bundle of look plugins (docs/plans/done/2026-11-03-style-bundle.md). Why a guard: the owner's rule is "one job, one
// way": the material per purpose has one entry (look.materials, the style's table is its style layer), and a style folder's plugins go through
// the same engine.plugins loader as the game's plugins/ folder. If makeMaterial reads engine.style again, a style plugin is loaded by a second
// path, a style value beats the game's, or switching the style's plugins off leaves something behind, this fails.
// Same format as the other files here.

export const specs = [
  {
    name: '[guard] style bundle: a style folder with a post Pass, a material and a patch plugs through engine.plugins on the style layer; the game wins; off(style) removes them; makeMaterial reads only look.materials',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE, createEngine, materialPatches, ShaderPass, CopyShader } = threedogTest, out = {};
        const mk = (style, key) => createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: key, style });
        const pass = new ShaderPass(CopyShader);
        const stone = Object.assign(new THREE.MeshToonMaterial({ color: 0x334455 }), { name: 'stone' });
        // what style/index.js holds: starting values, the material per role, and plugins: import.meta.glob('./plugins/*.js', { eager: true })
        const ink = { name: 'ink', exposure: 1.2, materials: { wood: { type: 'lambert', color: 0xff0000 } },
          plugins: { './plugins/10-paper.js': { default: pass }, './plugins/20-stone.js': { default: stone },
            './plugins/30-tint.js': { default: { slot: 'color', glsl: 'diffuseColor.rgb *= 0.9;', roles: ['wood'] } } } };
        const e = mk(ink, 'style-bundle');
        await e.start();
        const hex = m => m.color?.getHex();
        const state = () => {
          const wood = e.makeMaterial('wood'), st = e.makeMaterial('stone');
          return { wood: hex(wood), tint: materialPatches(wood).includes('ink/30-tint'), stone: st.type, stoneColor: hex(st),
            pass: e.describe().slots.some(x => x.slot === 'post' && x.on && x.file === 'style ink: plugins/10-paper.js') && e.post._list.some(h => h._def._pass === pass && h.name === 'ink/10-paper') };
        };
        out.list = e.plugins.list().map(p => `${p.name}:${p.slots.join()}:${p.style}`);
        out.start = state();
        out.exposure = e.renderer.toneMappingExposure;
        // the game's layer is above the style's: set reaches a spec role and a Material role alike; replace and a game plugin beat the style's Material
        e.look.materials.set({ wood: { color: 0x00ff00 }, stone: { color: 0x00ff00 } });
        out.gameSet = state();
        e.look.materials.set({ wood: { color: null }, stone: { color: null } });
        const h = e.look.materials.replace('stone', new THREE.MeshBasicMaterial());
        out.gameReplace = state().stone;
        h.remove();
        e.plugins.add({ './plugins/40-stone.js': { default: Object.assign(new THREE.MeshPhongMaterial(), { name: 'stone' }) } });   // the same file shape, in the game's folder
        out.gamePlugin = state().stone;
        e.plugins.off('40-stone');
        // makeMaterial never reads engine.style: changing the raw table after creation does nothing (look.materials is the one entry)
        e.style.materials = { wood: { color: 0x0000ff } };
        out.rawIgnored = hex(e.makeMaterial('wood'));
        // switching the style's plugins off takes every one out; on puts them back
        e.plugins.off('ink');
        out.off = state();
        e.plugins.on('ink');
        out.on = state();
        e.dispose();
        // without the style there are no style plugins; parts keep each pack's plugins under its own name; plugins: null drops the earlier ones'
        const plain = mk({ name: 'plain' }, 'style-bundle-2'); await plain.start();
        out.removed = { list: plain.plugins.list().length, stone: plain.makeMaterial('stone').type };
        plain.dispose();
        const extra = { name: 'mine', plugins: { grain: { default: { slot: 'color', glsl: 'diffuseColor.rgb *= 0.95;' } } } };
        const parts = mk([ink, extra], 'style-bundle-3'); await parts.start();
        out.parts = parts.plugins.list().map(p => p.name).join();
        parts.dispose();
        const dropped = mk([ink, { plugins: null }], 'style-bundle-4'); await dropped.start();
        out.dropped = dropped.plugins.list().length;
        dropped.dispose();
        try { mk({ name: 'bad', plugins: [pass] }, 'style-bundle-5'); out.badShape = ''; } catch (err) { out.badShape = err.message; }
        return out;
      });
      console.log('  style bundle:', JSON.stringify(r));
      check('the style folder plugins are in engine.plugins, named <style>/<file>, in file order, marked with the style',
        r.list.join() === 'ink/10-paper:post:ink,ink/20-stone:material:ink,ink/30-tint:patch:ink', JSON.stringify(r.list));
      check('at start: the style table gives wood, the plugin gives stone and the wood patch, the Pass is in the chain, starting values apply',
        r.start.wood === 0xff0000 && r.start.tint && r.start.stone === 'MeshToonMaterial' && r.start.stoneColor === 0x334455 && r.start.pass && Math.abs(r.exposure - 1.2) < 1e-6, JSON.stringify(r.start));
      check('the game layer wins: look.materials.set recolors both the spec role and the plugin Material role',
        r.gameSet.wood === 0x00ff00 && r.gameSet.stoneColor === 0x00ff00 && r.gameSet.stone === 'MeshToonMaterial', JSON.stringify(r.gameSet));
      check("the game's replace and a game plugin of the same shape beat the style's Material", r.gameReplace === 'MeshBasicMaterial' && r.gamePlugin === 'MeshPhongMaterial', JSON.stringify(r));
      check('makeMaterial reads only look.materials, never engine.style', r.rawIgnored === 0xff0000, String(r.rawIgnored));
      check("off('ink') takes the Pass, the Material and the patch out; on('ink') puts them back",
        !r.off.pass && r.off.stone === 'MeshLambertMaterial' && !r.off.tint && r.off.wood === 0xff0000 && r.on.pass && r.on.stone === 'MeshToonMaterial' && r.on.tint, JSON.stringify({ off: r.off, on: r.on }));
      check('without the style: no style plugins, stone is the neutral default', r.removed.list === 0 && r.removed.stone === 'MeshLambertMaterial', JSON.stringify(r.removed));
      check('style parts keep each pack\'s plugins under its name; plugins: null drops the earlier parts\'',
        r.parts === 'ink/10-paper,ink/20-stone,ink/30-tint,mine/grain' && r.dropped === 0, JSON.stringify(r));
      check('style.plugins of the wrong shape fails at createEngine with what to give', /engine\.plugins\.add takes/.test(r.badShape), r.badShape);
    },
  },
];
