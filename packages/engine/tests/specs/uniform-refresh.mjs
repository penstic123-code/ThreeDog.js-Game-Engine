// Guard against frozen uniforms on WebGPURenderer (render/fx/uniforms.tsl.js readBack): a value the TSL side reads back every render must keep
// reaching the GPU after the first frames, also on a node material without node properties of its own (three refreshes only its shared groups).
// Changed after 3 frames, read 4 frames later: both renderers moved and agree within 1%.
export const specs = [
  {
    name: '[guard] uniforms read back each render stay live on WebGPU: changed after a few frames, both backends move and agree (< 1%)',
    url: '/tests/uniform-refresh/index.html',
    software: true,   // compares rendered pixels (through window.uniformRefresh)
    async run({ check, ev }) {
      const r = await ev(() => window.uniformRefresh());
      console.log('  uniform refresh numbers:', JSON.stringify(r));
      for (const [k, c] of Object.entries(r)) {
        check(`${k}: the change moved both pictures`, c.moved[0] > 5 && c.moved[1] > 5, JSON.stringify(c));
        check(`${k}: after the change WebGL and WebGPU agree within 1%`, c.diff < 1, JSON.stringify(c));
      }
    },
  },
];
