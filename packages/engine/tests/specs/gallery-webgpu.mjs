// [guard] The asset gallery draws node materials: a model with a TSL material gets a real turntable picture (it was an empty frame when the
// gallery only had a WebGLRenderer), on a WebGPU-route game and on a WebGL game whose asset carries a node material; a classic material
// still draws in the same run. software: a pixel test like its neighbours (WebGPURenderer falls back to its WebGL2 backend there).
export const specs = [
  {
    name: '[guard] asset gallery draws node materials (WebGPU renderer picked for a TSL asset, on a WebGPU and a WebGL game), classic ones still draw',
    url: '/tests/gallery-webgpu/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.galleryNodeMaterials());
      console.log('  gallery node material numbers:', JSON.stringify(r));
      check('hasNodeMaterial tells a TSL material from a classic one', r.node && !r.plain, JSON.stringify(r));
      for (const k of ['gpu', 'gl']) {
        const g = r[k];
        check(`${k} game: every picture made (2 models x 3 lights), no error`, g.count === 6 && !g.errors.length, JSON.stringify(g));
        check(`${k} game: the node material box shows its own red (> 20% of the middle third)`, g.nodeRed > 20, JSON.stringify(g));
        check(`${k} game: the classic box still shows its blue (> 20% of the middle third)`, g.plainBlue > 20, JSON.stringify(g));
      }
      check('live grid: the node material box cell shows its red (> 20%), close() removes the grid', r.live > 20 && r.liveGone, JSON.stringify({ live: r.live, gone: r.liveGone }));
    },
  },
];
