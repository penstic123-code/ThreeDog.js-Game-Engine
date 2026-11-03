// Shadow-map redraws per frame with ao off / on, WebGL and WebGPU (tests/shadow-passes/main.js). Guards render/postWebGL.js holding redraws
// after the scene pass: one redraw a frame with ao on (it was two on WebGL), and a requested redraw (every third frame) still drawn. The frame
// times are logged, not checked: software rendering, compared within one run only.
export const specs = [
  {
    serial: true,   // frame times: runs alone, not beside other pages
    name: 'shadow passes per frame: once with ao on (WebGL and WebGPU), requested redraws still drawn',
    url: '/tests/shadow-passes/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.shadowPasses());
      console.log('  shadow passes numbers:', JSON.stringify(r));
      for (const k of ['webgl', 'webgpu']) {
        const x = r[k];
        check(`${k} (${x.backend}): without post the shadow map is redrawn once a frame (${x.off.perFrame})`, x.off.perFrame === 1, JSON.stringify(x.off));
        check(`${k}: with ao on still once a frame (${x.ao.perFrame}; frame ${x.off.ms} -> ${x.ao.ms} ms)`, x.ao.perFrame === 1, JSON.stringify(x.ao));
        check(`${k}: a redraw requested every third frame with ao on is drawn each time (${x.every3.redraws} of ${x.every3.frames / 3})`,
          x.every3.redraws === x.every3.frames / 3, JSON.stringify(x.every3));
      }
      check('webgl: the shadow autoUpdate switch holds its own value again after the chain', r.webgl.autoAfter === true, String(r.webgl.autoAfter));
    },
  },
];
