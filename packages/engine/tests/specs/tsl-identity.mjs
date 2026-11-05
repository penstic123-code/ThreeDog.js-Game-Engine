// [guard] A program on WebGPURenderer follows the tsl that runs. Why: its key once held the patch names and the GLSL-based cacheKeys only, so two
// patches with other tsl and the same GLSL (or none) drew as the first one, with no error: WebGL's clash() check cannot see a difference the
// key does not hold. The other way round matters as much: built-in effects called once per material must keep sharing one program.
// Headless, so WebGPURenderer's WebGL2 backend; the key logic is the same on real WebGPU.
export const specs = [
  {
    name: '[guard] tsl identity: patches that differ only in tsl draw as themselves on WebGPU, a built-in setup stays one program, WebGL keys do not move',
    url: '/tests/engine-webgpu/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.tslIdentity());
      console.log('  tsl identity numbers:', JSON.stringify(r));
      check('two same-named patches with no GLSL draw their own color (red, blue)', r.left[0] > 200 && r.left[2] < 50 && r.right[2] > 200 && r.right[0] < 50, JSON.stringify(r));
      check('their materials have two node keys', r.keys === 2, String(r.keys));
      check('engine.shaderTerms: a second spec with other tsl takes over (dark, then back to the built-in brightness)', r.dark < r.builtIn - 20 && Math.abs(r.light - r.builtIn) <= 2, JSON.stringify(r));
      check(`${r.materials} materials of one built-in setup (wind, season, clouds) share one key, at most 2 node builds`, r.sharedKeys === 1 && r.builds <= 2, JSON.stringify(r));
      check('WebGL: the same GLSL with other tsl keeps one program key', r.webglKeys === 1, String(r.webglKeys));
      // the hook called by hand: no real device was lost here
      check('a lost WebGPU device is reported as a lost context: contextLost at once, the page freeze held once the loop runs, page:contextlost once, three\'s own hook still ran', r.lost.halted.lost && !r.lost.halted.frozen && r.lost.held && r.lost.events === 1 && r.lost.three, JSON.stringify(r.lost));
    },
  },
];
