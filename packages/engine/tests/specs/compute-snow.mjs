// Recipe 65's GPU compute example (tests/compute-snow), read back from the GPU buffer: every flake moved, none left the box, a freeze stops them.
// Here a small count on the WebGL2 backend (software rendering takes minutes for 100k); the run that counts for WebGPU is in the header of tests/compute-snow/main.js.
const J = JSON.stringify;
export const specs = [
  {
    name: '[guard] compute-snow: flakes moved by a TSL compute shader, read back from the GPU; freeze stops them',
    url: '/tests/compute-snow/index.html?count=4000',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.snowCheck());
      console.log('  compute snow numbers:', J(r));
      check('every flake moved in 30 frames', r.moved > r.count * 0.99, J(r));
      check('every flake stays between the ground and the top', r.inside === r.count, J(r));
      check('frozen: dt is 0, the shader moves nothing', r.still === r.count, J(r));
    },
  },
];
