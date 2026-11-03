// Asset hot swap (core/assetHot.js): an edited generator / tuned params rebuild every live copy in place (props, templates' parts, vegetation),
// while the clock, the player and world state stay. Open-world example page; the models are registered by the test.
export const specs = [
  {
    // 不许绕开: every engine path that shows a named model (content props, vegetation, assets.model copies) must take part in the swap; a path that
    // keeps its own copy of the old geometry shows up here as an unchanged height
    name: '[guard] asset hot swap: reloadAssets / setParams swap props, multi-part copies and vegetation in place; clock and player untouched',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const T = engine.THREE, A = engine.assets, W = engine.world, tick = () => new Promise(res => setTimeout(res, 0));
        engine.pause();
        const params = { h: { type: 'number', min: 0.1, max: 9, default: 1 } };
        const box = p => new T.BoxGeometry(1, p.h, 1);
        const group = n => () => { const g = new T.Group(); for (let i = 0; i < n; i++) { const m = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 0.5), new T.MeshStandardMaterial()); m.position.y = i; g.add(m); } return g; };
        A.manifest({ name: 'hs', models: { hsBox: { build: box, params }, hsGroup: group(2) } });
        const p = engine.player.position, x = p.x + 6, z = p.z + 6;
        engine.content.load({ props: [{ id: 'hs-a', model: 'hsBox', x, z }, { id: 'hs-b', model: 'hsBox', x: x + 3, z }, { id: 'hs-g', model: 'hsGroup', x, z: z + 3 }] });
        const veg = engine.vegetation ? engine.vegetation.define('hsVeg', { model: 'hsBox', positions: [[x + 6, z], [x + 7, z + 1]] }) : null;
        await veg;
        for (let i = 0; i < 60 && !(W.view('hs-a') && W.view('hs-b') && W.view('hs-g')); i++) { engine.step(0.05); await tick(); }
        const height = o => { let h = 0; o?.traverse(m => { if (m.isMesh) { m.geometry.computeBoundingBox(); h = Math.max(h, m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y); } }); return +h.toFixed(2); };
        const parts = o => { let n = 0; o?.traverse(m => { if (m.isMesh) n++; }); return n; };
        const vegH = () => { const g = engine.vegetationLook?.kind('hsVeg')?.geometry; if (!g) return null; g.computeBoundingBox(); return +(g.boundingBox.max.y - g.boundingBox.min.y).toFixed(2); };
        const now0 = engine.clock.now, pos0 = p.toArray().join(','), before = { a: height(W.view('hs-a')), b: height(W.view('hs-b')), g: parts(W.view('hs-g')), veg: vegH() };
        const viewA = W.view('hs-a');
        // the edit: new functions under the same names (what the new module of assets.js brings)
        const box2 = q => new T.BoxGeometry(1, q.h * 2, 1);
        const rep = await engine.debug.reloadAssets({ name: 'hs', models: { hsBox: { build: box2, params }, hsGroup: group(3) } });
        const after = { a: height(W.view('hs-a')), b: height(W.view('hs-b')), g: parts(W.view('hs-g')), veg: vegH(), same: W.view('hs-a') === viewA };
        const tuned = await A.setParams('hsBox', { h: 1.5 });
        const after2 = { a: height(W.view('hs-a')), veg: vegH(), values: A.paramsOf('hsBox')?.values };
        let typo = null; try { await A.setParams('hsBox', { hh: 2 }); } catch (err) { typo = String(err.message); }
        const unchanged = await engine.debug.reloadAssets({ name: 'hs', models: { hsBox: { build: box2, params }, hsGroup: A.builder('hsGroup') } });
        const d = engine.describe().assetSwaps;
        return { before, after, after2, rep, tuned, typo, unchanged: unchanged.names, now: engine.clock.now === now0, pos: p.toArray().join(',') === pos0, d: d?.length ?? 0, hasVeg: !!veg };
      });
      check('before: props 1 m tall, group of 2 parts', r.before.a === 1 && r.before.b === 1 && r.before.g === 2, JSON.stringify(r.before));
      check('reloadAssets: both prop copies now 2 m, the same objects (swapped in place)', r.after.a === 2 && r.after.b === 2 && r.after.same, JSON.stringify(r.after));
      check('a copy whose model gained a part has 3 parts, reported as partsChanged', r.after.g === 3 && r.rep.partsChanged?.includes('hsGroup'), JSON.stringify(r.rep));
      check('vegetation species from the model swapped too', !r.hasVeg || (r.before.veg === 1 && r.after.veg === 2), JSON.stringify([r.before.veg, r.after.veg]));
      check('setParams rebuilds with the tuned value (copies 3 m, vegetation too), paramsOf shows it', r.after2.a === 3 && (!r.hasVeg || r.after2.veg === 3) && r.after2.values?.h === 1.5, JSON.stringify(r.after2));
      check('a param typo throws naming the key', /hh/.test(r.typo ?? ''), r.typo);
      check('registering the same functions again swaps nothing', r.unchanged.length === 0, JSON.stringify(r.unchanged));
      check('clock and player position untouched; describe().assetSwaps lists the swaps', r.now && r.pos && r.d >= 2, JSON.stringify({ now: r.now, pos: r.pos, d: r.d }));
    },
  },
];
