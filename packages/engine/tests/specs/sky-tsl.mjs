// The sky dome and the sky's fog kinds on WebGPURenderer (docs/plans/2026-11-03-webgpu-phase2.md §7 step 9): a node material over the same uniforms.
// A guard: the real sky drives one set of uniforms, the real makeDome builds the WebGL ShaderMaterial and the WebGPU node material from it, and at five
// moments from sunrise to noon the two pictures agree to within 3% mean brightness; each time step moves both. The cumulus kind, the fog band and
// drifting clouds agree too. Fog 'exp' / 'height' through the scene fog node match the GLSL 'fog' patch. GLSL-only parts (dome layers, the clouds
// and fog hooks) and a missing threedog/tsl fail by code, never silently. Software rendering like every pixel test.
export const specs = [
  {
    name: '[guard] sky dome / sky fog on WebGPURenderer: picture mean within 3% of WebGL from sunrise to noon, time moves both; GLSL fails by name',
    url: '/tests/sky-tsl/index.html',
    software: true,   // compares rendered pixels (through window.skyTsl): same pixels on every machine
    async run({ check, ev }) {
      const r = await ev(() => window.skyTsl());
      console.log('  sky tsl numbers:', JSON.stringify(r));
      check('WebGL dome is a ShaderMaterial, WebGPU dome a MeshBasicNodeMaterial', r.kinds.join() === 'ShaderMaterial,MeshBasicNodeMaterial', r.kinds.join());
      const near = c => c.meanDiff < 3 && c.absDiff < 3 && c.mean > 5;
      for (const [t, c] of Object.entries(r.times)) {
        check(`time ${t}: picture mean differs < 3%`, near(c), JSON.stringify(c));
        if (c.moved) check(`time ${t}: the time step moved both pictures by about the same`, c.moved[0] > 0.5 && c.moved[1] > 0.5 && Math.abs(c.moved[0] - c.moved[1]) < Math.max(c.moved[0], c.moved[1]) * 0.3, JSON.stringify(c.moved));
      }
      for (const [n, c] of Object.entries(r.cumulus)) check(`${n}: picture mean differs < 3%`, near(c), JSON.stringify(c));
      for (const [k, c] of Object.entries(r.fog)) {
        check(`fog '${k}': scene fog node on WebGPU, picture mean within 3% of the GLSL fog patch`, c.node && near(c), JSON.stringify(c));
        check(`fog '${k}': density read live, and a game's linear THREE.Fog gets three's own fog`, c.liveDensity > 1 && c.linearYields, JSON.stringify(c));
      }
      check("createEngine({ renderer: 'webgpu' }) + sky(): node dome, fog kind 'exp' as the scene fog node, picture mean within 3% of the WebGL dome",
        r.engine.isGPU && r.engine.dome === 'MeshBasicNodeMaterial' && r.engine.fogNode && near(r.engine), JSON.stringify(r.engine));
      const e = r.errors, named = (m, what) => new RegExp(what).test(m) && /\[webgpu-needs-tsl\]/.test(m);
      check('style.sky.layers on WebGPU throws [webgpu-needs-tsl], naming it', named(e.layersGpu, 'style\\.sky\\.layers'), e.layersGpu);
      check("look.sky.patch('clouds') on a WebGPU dome throws [webgpu-needs-tsl], naming it", named(e.cloudsHookGpu, "look\\.sky\\.patch\\('clouds'\\)"), e.cloudsHookGpu);
      check("look.fog.patch('fog') GLSL on WebGPU throws [webgpu-needs-tsl], naming it", named(e.fogHookGpu, "look\\.fog\\.patch\\('fog'\\)"), e.fogHookGpu);
      check("without threedog/tsl, the dome and the fog kinds on WebGPU say import 'threedog/tsl' [webgpu-needs-tsl]",
        [e.noTslDome, e.noTslFog].every(m => named(m, "import 'threedog/tsl'")), JSON.stringify(e));
      check('the same dome still builds on WebGL', e.glDome === 'no error', e.glDome);
    },
  },
];
