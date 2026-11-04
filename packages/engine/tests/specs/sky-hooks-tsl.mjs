// The sky's GLSL hooks in their tsl form on WebGPURenderer (render/fx/sky.tsl.js): engine.sky.clouds(), dome layers
// (engine.sky.layer('<name>')). Two real engines, one style: each hook given { glsl, tsl } moves both pictures and
// they agree within 1% mean; ctx's value so far returned unchanged draws the hook-less picture; patch(null) gives it back. A hook missing the
// form a renderer draws throws by name there ([webgpu-needs-tsl] on WebGPU). Software rendering like every pixel test.
export const specs = [
  {
    name: '[guard] sky hooks tsl form: clouds / dome layers draw on WebGPU within 1% of their GLSL on WebGL; a missing form fails by name',
    url: '/tests/sky-hooks-tsl/index.html',
    software: true,   // compares rendered pixels (through window.skyHooksTsl)
    async run({ check, ev }) {
      const r = await ev(() => window.skyHooksTsl());
      console.log('  sky hooks tsl numbers:', JSON.stringify(r));
      check('WebGL engine dome is a ShaderMaterial, WebGPU engine dome a MeshBasicNodeMaterial', r.kinds.join() === 'ShaderMaterial,MeshBasicNodeMaterial', r.kinds.join());
      for (const [k, c] of Object.entries(r.hooks)) {
        check(`${k}: hook on moves both pictures (on vs off clearly > 0)`, c.moved[0] > 0.5 && c.moved[1] > 0.5, JSON.stringify(c));
        check(`${k}: WebGL (glsl) and WebGPU (tsl) picture means differ < 1%`, c.meanDiff < 1 && c.offDiff < 1, JSON.stringify(c));
      }
      for (const [k, v] of Object.entries(r.same)) check(`${k}: the WebGPU picture equals the hook-less one`, v < 0.05, String(v));
      const e = r.errors, gpu = (m, what) => m.includes(what) && /\[webgpu-needs-tsl\]/.test(m), gl = (m, what) => m.includes(what) && /only a tsl form/.test(m);
      check("glsl-only engine.sky.clouds() on WebGPU throws [webgpu-needs-tsl] naming it", gpu(e.cloudsGlslOnGpu, "engine.sky.clouds()"), e.cloudsGlslOnGpu);
      check("glsl-only engine.sky.layer('x') on WebGPU throws [webgpu-needs-tsl] naming it", gpu(e.layerGlslOnGpu, "engine.sky.layer('x')"), e.layerGlslOnGpu);
      check('tsl-only hooks on WebGL throw naming the hook and asking for glsl', gl(e.cloudsTslOnGl, "engine.sky.clouds()") &&
        gl(e.layerTslOnGl, "engine.sky.layer('x')"), JSON.stringify(e));
      check('a typo in the tsl code throws at the patch call, naming the hook', /sky\.clouds\(\) tsl/.test(e.badTsl), e.badTsl);
    },
  },
];
