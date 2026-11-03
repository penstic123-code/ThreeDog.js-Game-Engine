// engine.renderOnce, photo and probe bake on both renderers (docs/plans/2026-11-03-webgpu-phase2.md step 8). A guard: two renderOnce() calls in
// one task give two pictures on WebGL and on the WebGPU route, through post too (a RenderPipeline draws its scene pass once per node frame);
// the loop's frame right after a renderOnce() is its own; photo.take() returns a real picture and bakeProbes() runs on both. The control run
// freezes three's node frame and must repeat the first picture, so the guard is known to bite on the backend the test runs on.
export const specs = [
  {
    name: '[guard] renderOnce: two pictures in one task on WebGL and WebGPU (post too), photo and bakeProbes on both renderers',
    url: '/tests/render-once/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.renderOnceCases());
      console.log('  render-once numbers:', JSON.stringify(r));
      for (const k of ['webgl', 'webgpu']) {
        const x = r[k];
        check(`${k} (${x.backend}): renderOnce(target, camera) twice in one task, two cameras: two different pictures (> 5% of pixels)`, x.targets.changed > 5, JSON.stringify(x.targets));
        check(`${k}: renderOnce() twice in one task through post, engine camera moved: two different pictures`, x.post.active && x.post.changed > 5, JSON.stringify(x.post));
        check(`${k}: renderOnce(target) through post puts the canvas's picture in the target (< 1% of pixels differ)`,
          x.postTarget.best < 1 && x.postTarget.mean > 5, JSON.stringify(x.postTarget));
        check(`${k}: step() right after a renderOnce() in the same task draws its own camera`, x.stepAfter > 5, String(x.stepAfter));
        check(`${k}: photo.take() gives a real picture (canvas size, not one color)`, x.photo.w === 160 * 1.6 && x.photo.spread > 60, JSON.stringify(x.photo));
        check(`${k}: photo.take({ bloom: true }) leaves the game layer as it was and bloom back off`,
          JSON.stringify(x.photoLook.after) === JSON.stringify(x.photoLook.before) && x.photoLook.bloomAfter === false, JSON.stringify(x.photoLook));
        check(`${k}: bakeProbes() runs: 4 probes, finite SH, the red wall shows (DC red > DC blue)`, x.probes.count === 4 && x.probes.finite && x.probes.red > x.probes.blue, JSON.stringify(x.probes));
      }
      check('control: with the node frame frozen the WebGPU route repeats the first picture (the bug renderOnce prevents)', r.control.changed < 1, JSON.stringify(r.control));
    },
  },
];
