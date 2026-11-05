// three's BundleGroup beside the engine: batching and hlod leave what is inside alone, describe and inspect say what is replayed, and a replay stays right for the shadow pass, hiding,
// removal and disposal. `software` here means WebGPURenderer's WebGL2 backend, where a BundleGroup is a plain group; `node packages/tools/real-webgpu.mjs bundles` runs the same checks on real bundles.
export const specs = [
  {
    // 不许绕开: a mesh has one owner for drawing. Take `!inBundle(m)` out of Batching._eligible and the meshes move to layer 31 under a bundle that keeps drawing them or draws nothing
    name: '[guard] BundleGroup: one owner per mesh, and a replay stays right for shadows, hiding, removal and disposal',
    url: '/tests/backend/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.bundleCases());
      console.log('  bundle numbers:', JSON.stringify(r));
      const on = (s, box, left, right) => s && s.box === box && s.shadowLeft === left && s.shadowRight === right;
      check('a bundle draws, and casts on ground outside it', on(r.drawn, true, true, false), JSON.stringify(r.drawn));
      check('the shadow pass follows a moved light without a recording', on(r.sunMoved, true, false, true), JSON.stringify(r.sunMoved));
      check('group.visible hides the bundle and its shadow at once', on(r.groupHidden, false, false, false), JSON.stringify(r.groupHidden));
      check('and shows them again', on(r.groupBack, true, true, false), JSON.stringify(r.groupBack));
      check('a hidden child with needsUpdate: box and shadow gone', on(r.childHidden, false, false, false), JSON.stringify(r.childHidden));
      check('shown again with needsUpdate', on(r.childBack, true, true, false), JSON.stringify(r.childBack));
      check('a child removed with needsUpdate: gone', on(r.removed, false, false, false), JSON.stringify(r.removed));
      check('engine.remove(bundle): gone from the picture', on(r.gone, false, false, false), JSON.stringify(r.gone));
      check('engine.remove(bundle): its geometry disposed, its records freed', r.goneFreed === 1 && r.recordsDropped > 0, `${r.goneFreed} ${r.recordsDropped}`);
      if (r.bundles) {
        // red after a three upgrade: replay changed. Update "Render bundles" in recipe 05, which promises exactly this, before changing the checks
        check('nothing changed: nothing recorded again', r.replayRecorded === 0, r.replayRecorded);
        check('hiding the group costs no recording', r.groupRecorded === 0, r.groupRecorded);
        check('a hidden child stays drawn until needsUpdate', on(r.childHiddenStale, true, true, false), JSON.stringify(r.childHiddenStale));
        check('a removed child stays drawn until needsUpdate', on(r.removedStale, true, true, false), JSON.stringify(r.removedStale));
      }
      check('12 plain copies batch; the 24 in bundles do not', r.batched === 12, r.batched);
      check('bundled meshes stay on their layer', r.bundledLayers === true);
      check('userData.batch = true on a BundleGroup warns', r.batchWarned === 1, r.batchWarned);
      check('describe counts the bundles', r.described?.groups === 2 && r.described?.meshes === 24 && r.described?.replayed === r.bundles && r.describedText === true, JSON.stringify(r.described));
      check('inspect names the bundle where one replays', r.inspected === r.bundles, r.inspected);
      check('a stream build may return a bundle, and batching leaves it alone', r.streamLoaded === true && r.streamBatched === 12, `${r.streamLoaded} ${r.streamBatched}`);
      check('unloading takes the bundle out of the scene', r.streamUnloaded === true);
      check('hlod takes nothing from a bundle and warns', r.hlodCells === 0 && r.hlodTouched === false && r.hlodWarned === 1, `${r.hlodCells} ${r.hlodTouched} ${r.hlodWarned}`);
      // 不许绕开: DynamicDrawUsage back on a batch costs every batch a full refresh per pass per frame on WebGPU (about 2 ms on the city run, docs/testing/field/2026-11-05-city/)
      check('the batch is not DynamicDrawUsage', r.batchUsage === false, r.batchUsage);
      check('the batch draws', r.batch.at0 === true && r.batch.at6 === false, JSON.stringify(r.batch));
      check('a moved copy moves on screen', r.batchMoved.at0 === false && r.batchMoved.at6 === true, JSON.stringify(r.batchMoved));
      // 不许绕开: the first tint of a batch already drawn must reach the screen (a shader built before any instance color existed never read it). Take `material.needsUpdate` out of batchGroups.color and this is red on real WebGPU
      check('a tint on a drawn batch shows: that copy shows darker', r.batchTinted.at0 === false && r.batchTinted.dimmed6 === true, JSON.stringify(r.batchTinted));
      check('a removed copy leaves the screen', r.batchLeft.at0 === false && r.batchLeft.at6 === false, JSON.stringify(r.batchLeft));
    },
  },
];
