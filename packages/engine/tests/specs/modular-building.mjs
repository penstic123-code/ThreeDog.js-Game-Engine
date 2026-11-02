// Modular building technique example (examples/techniques/modular-building, page /modular-building.html). Builds streets from seeds and reads
// the result: a street that changes between two builds of one seed, a wall module off the grid or a gap between modules, pieces that stop
// sharing geometry, batching that no longer cuts draw calls, or params that do not reach the shape all fail here.

export const specs = [
  {
    name: 'modular building example: seeded street is deterministic, modules snap to the grid without gaps, batching cuts draw calls, params change shape',
    url: '/modular-building.html?threedog-headless',
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const r = await ev(async () => { try {
        const { kit, street, THREE } = window.mbTest, cell = kit.cell, storey = kit.storey;
        // signature: every module's kind and world position, rounded to mm
        const sig = root => {
          root.updateWorldMatrix(true, true);
          const out = [], v = new THREE.Vector3();
          root.traverse(o => { if (o.userData.module) { o.getWorldPosition(v); out.push(`${o.userData.module.type}@${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`); } });
          return out.join(';');
        };
        const a = sig(kit.street({ seed: 3 })), b = sig(kit.street({ seed: 3 })), c = sig(kit.street({ seed: 4 }));

        // grid snapping: each wall slab (mesh 'wall' of a facade module) spans whole cells along its side, its outer face is on the grid,
        // its floor sits at floor * storey, and the slabs of one side and floor cover the side end to end
        const onGrid = x => Math.abs(x / cell - Math.round(x / cell)) < 1e-4;
        const bad = [], runs = new Map();
        street.updateWorldMatrix(true, true);
        street.children.forEach((bld, bi) => {
          for (const g of bld.children) {
            const m = g.userData.module;
            if (!m || !'WSD.'.includes(m.type)) continue;
            const slab = g.children.find(x => x.name === 'wall'), box = new THREE.Box3().setFromObject(slab);
            const alongX = m.side === 'front' || m.side === 'back';
            const [lo, hi] = alongX ? [box.min.x, box.max.x] : [box.min.z, box.max.z];
            const face = m.side === 'front' ? box.max.z : m.side === 'back' ? box.min.z : m.side === 'right' ? box.max.x : box.min.x;
            if (!onGrid(lo) || !onGrid(hi) || Math.abs(hi - lo - cell) > 1e-4 || !onGrid(face) ||
              Math.abs(box.min.y - m.floor * storey) > 1e-4 || Math.abs(box.max.y - (m.floor + 1) * storey) > 1e-4) bad.push({ bi, ...m, lo, hi, face, y: [box.min.y, box.max.y] });
            const k = `${bi}|${m.side}|${m.floor}`;
            (runs.get(k) ?? runs.set(k, []).get(k)).push([lo, hi]);
          }
        });
        const gaps = [];
        for (const [k, list] of runs) {
          list.sort((p, q) => p[0] - q[0]);
          for (let i = 1; i < list.length; i++) if (Math.abs(list[i][0] - list[i - 1][1]) > 1e-4) gaps.push({ k, at: list[i - 1][1], next: list[i][0] });
          const [bi, side] = k.split('|'), cells = street.children[Number(bi)].userData.building.cells, n = side === 'front' || side === 'back' ? cells[0] : cells[1];
          if (list.length !== n) gaps.push({ k, modules: list.length, cells: n });
        }

        // shared geometry: copies of a module + params reuse one geometry
        const meshes = [], geos = new Set();
        street.traverse(o => { if (o.isMesh) { meshes.push(o); geos.add(o.geometry.uuid); } });

        // draw calls with engine.batching on (the page opted the street in), then off
        engine.step(0.2);
        const on = engine.describe().perf.drawCalls, stats = engine.batching.stats;
        engine.batching.enabled = false; engine.step(0.2);
        const off = engine.describe().perf.drawCalls;
        engine.batching.enabled = true; engine.step(0.2);
        const merged = kit.merge(street), mergedMats = merged.children.length;

        // params reach the shape: wider window -> wider glass; more floors -> taller building; through the manifest too
        const glassW = p => { const g = kit.modules.window({ width: p, height: 1.2, sill: 0.9 }).children.find(x => x.name === 'glass'); return new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).x; };
        const tall = kit.building({ floors: 3, front: 'WDW/WWW' }), low = kit.building({ floors: 1, front: 'WDW' });
        const height = o => new THREE.Box3().setFromObject(o).max.y;
        const viaManifest = await engine.assets.model('mb-building');
        // optional AO: every geometry gets a color attribute (a vertexColors material on a geometry without one draws black)
        const { createModularKit, makeSlots, bakeVertexAO } = window.mbTest;
        const aoKit = createModularKit({ prefix: 'mbao', slots: makeSlots('gray'), ao: { bake: bakeVertexAO, samples: 8 } }), noColor = [];
        aoKit.building({ front: 'SDS/WWW', sign: 'AO' }).traverse(o => { if (o.isMesh && !o.geometry.attributes.color) noColor.push(o.parent.name + '/' + o.name); });
        aoKit.dispose();
        let facadeError = '';
        try { kit.building({ width: 3, front: 'WD' }); } catch (e) { facadeError = String(e.message); }
        return { a: a.length, same: a === b, differs: a !== c, bad: bad.slice(0, 3), badN: bad.length, gaps: gaps.slice(0, 3), meshes: meshes.length, geos: geos.size,
          on, off, stats, mergedMats, glass: [glassW(0.8), glassW(1.4)], heights: [height(low), height(tall)],
          manifest: viaManifest.userData.building ?? null, schema: Object.keys(engine.assets.paramsOf('mb-street')?.schema ?? {}), facadeError, noColor };
      } catch (err) { return { err: String(err.stack) }; } });
      if (r.err) { check('runs without error', false, r.err); return; }
      check('the same seed builds the same street, another seed a different one', r.a > 100 && r.same && r.differs, JSON.stringify({ chars: r.a, same: r.same, differs: r.differs }));
      check('every wall slab spans one whole cell on the grid, outer face on the grid, at its floor height', r.badN === 0, JSON.stringify(r.bad));
      check('slabs of each side and floor touch end to end, one per footprint cell (no gaps, no overlaps)', r.gaps.length === 0, JSON.stringify(r.gaps));
      check('copies share geometry (distinct geometries under a fifth of the meshes)', r.geos * 5 < r.meshes, JSON.stringify({ meshes: r.meshes, geometries: r.geos }));
      check('engine.batching: a 10-building street draws in under 400 calls, under a third of the unbatched count', r.on < 400 && r.on * 3 < r.off, JSON.stringify({ on: r.on, off: r.off, stats: r.stats }));
      check('kit.merge: one mesh per material (8 slots + textured awnings / signs, at most 16)', r.mergedMats > 0 && r.mergedMats <= 16, String(r.mergedMats));
      check('params change shape: a wider window param gives wider glass', Math.abs(r.glass[0] - 0.8) < 1e-3 && Math.abs(r.glass[1] - 1.4) < 1e-3, JSON.stringify(r.glass));
      check('params change shape: three floors stand taller than one', r.heights[1] > r.heights[0] + 5.9, JSON.stringify(r.heights));
      check('registered through assets.manifest with a params schema (gallery / tune / hot swap see it)',
        r.manifest?.cells?.join() === '3,2' && ['seed', 'count', 'gap'].every(k => r.schema.includes(k)), JSON.stringify({ manifest: r.manifest, schema: r.schema }));
      check('a facade row that does not match the footprint throws naming the side', /facade front row "WD" has 2 letters.*3 cells/.test(r.facadeError), r.facadeError);
      check('optional AO bakes a color attribute into every module geometry', r.noColor.length === 0, JSON.stringify(r.noColor.slice(0, 5)));
      check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
];
