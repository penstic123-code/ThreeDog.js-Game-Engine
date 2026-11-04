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
          JSON.stringify(x.photoPicture.after) === JSON.stringify(x.photoPicture.before) && x.photoPicture.bloomAfter === false, JSON.stringify(x.photoPicture));
        check(`${k}: bakeProbes() runs: 8 probes, finite SH, the red wall shows (DC red > DC blue), stored half precision`, x.probes.count === 8 && x.probes.finite && x.probes.red > x.probes.blue && x.probes.half, JSON.stringify(x.probes));
        check(`${k}: the grid reaches a lit pixel, and the file draws the same picture as the bake`, x.probes.on > x.probes.off + 0.1 && Math.abs(x.probes.on - x.probes.fromFile) < 0.05, JSON.stringify(x.probes));
      }
      // the same probe on both renderers: an upside-down read back (the WebGL2 backend's rows) or a swapped axis shows as a big gap, the small rest is 8 px cube faces
      const gap = Math.max(...r.webgl.probes.dc.flat().map((v, i) => Math.abs(v - r.webgpu.probes.dc.flat()[i])));
      check('[guard] both renderers bake the same light into the same probes', gap < 0.05, String(gap));
      check('control: with the node frame frozen the WebGPU route repeats the first picture (the bug renderOnce prevents)', r.control.changed < 1, JSON.stringify(r.control));
    },
  },
];
