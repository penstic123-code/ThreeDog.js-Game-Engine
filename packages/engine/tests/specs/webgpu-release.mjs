// A dropped mesh must not stay in WebGPURenderer's records (render/recordSweep.js). Found by the 2026-11-05 flight stress: every unloaded terrain chunk kept about
// 66 KB of JS heap and its GPU buffers, while chunk and geometry counters stayed flat. Why this reads three's private count: no public counter sees it, which is how it hid.
export const specs = [
  {
    name: '[guard] WebGPURenderer records: engine.remove with a shared material and streamed terrain chunks leave none behind',
    url: '/tests/backend/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.releaseCases());
      console.log('  webgpu release numbers:', JSON.stringify(r));
      check('every mesh drawn makes a record', r.drawn === 12, r.drawn);
      // when this one fails, three frees the record by itself: delete render/recordSweep.js
      check("three still keeps the record of a mesh dropped with geometry.dispose() alone, so the sweep is still needed", r.plainDrop === 12, r.plainDrop);
      check('the sweep frees those records', r.released === 0, r.released);
      check('engine.remove frees the records even when it must keep the material', r.engineRemove === 0, r.engineRemove);
      const t = r.terrain;
      check('the flight really unloaded chunks', t.seen >= t.loaded * 3, JSON.stringify(t));
      check('terrain: records follow the loaded chunks, not every chunk ever drawn', t.records > 0 && t.records <= t.loaded, JSON.stringify(t));
      check('terrain streaming stays silent in the geometry warning', t.samples > 13 && t.geometryWarnings === 0, JSON.stringify(t));
    },
  },
  {
    name: '[guard] record sweep: frees what left the scene, leaves pools, second scenes and scene-less draws, turns off if three moves the field',
    url: '/tests/backend/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.sweepCases());
      console.log('  record sweep numbers:', JSON.stringify(r));
      check('every mesh drawn makes a record', r.drawn === 12, r.drawn);
      check('one sweep alone frees nothing: a mesh must stay detached across two', r.afterOneSweep === 12, r.afterOneSweep);
      check('scene.remove with the material in use: freed after two sweeps', r.afterTwoSweeps === 0, r.afterTwoSweeps);
      check('a re-added mesh rebuilds its record', r.readded === 1, r.readded);
      check('a mesh going in and out of the scene keeps its record', r.poolKept === true);
      check('and loses it once it stays out', r.poolFreed === true);
      // red here after a three upgrade: a new way to draw with no Scene above the object. Add it to drawnWithoutScene (render/recordSweep.js), or it rebuilds every sweep
      check('second Scene, background mesh, QuadMesh, render(mesh), render(group), PMREM and the post chain keep their records', r.rebuilt.length === 0, r.rebuilt.join());
      check('those cases really were drawn with no Scene above them', r.noScene.includes('Mesh:Background.mesh') && r.noScene.some(n => n.startsWith('QuadMesh')), r.noScene.join());
      check('a child out of a live render bundle keeps its record, and the bundle draws on (a plain group where the backend has no bundles)', r.bundleKept === r.bundles);
      check('the bundle gone, its records go', r.bundleFreed === true);
      // red here after a three upgrade: the sweep reads renderer._objects._renderObjects and each record's .object, .scene, .bundle. Follow the rename in render/recordSweep.js
      check("the sweep ran on three's real record list", r.sweeping === true);
      check('field gone, record shape changed, _objects gone: off, no throw', r.guards.every(g => g === true), r.guards.join());
      check('off with a coded warning', r.guardWarnings >= 1, r.guardWarnings);
      check('geometry warning silent: streaming that disposes', r.warnStreaming === 0, r.warnStreaming);
      check('geometry warning silent: a static world drawn for the first time', r.warnFirstDraws === 0, r.warnFirstDraws);
      check('geometry warning silent: a world that keeps growing', r.warnGrowingWorld === 0, r.warnGrowingWorld);
      check('geometry warning silent: one burst, then flat', r.warnOneBurst === 0, r.warnOneBurst);
      check('geometry warning: a steady climb says so, once', r.warnLeak === 1 && r.warnLeakAgain === 0, `${r.warnLeak} then ${r.warnLeakAgain}`);
    },
  },
];
