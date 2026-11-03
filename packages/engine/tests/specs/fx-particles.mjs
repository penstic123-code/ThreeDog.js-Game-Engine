// Particles and weather on WebGPURenderer (docs/plans/2026-11-03-webgpu-phase2.md §7 step 9): sprite quads + node materials instead of point sprites.
// A guard: the engine's own particle / weather code, built against both renderers from one seed, must hold the same particles (count, positions,
// sizes, alpha read from the data) and draw the same picture to within 3% mean brightness, with the particles in the same place; moving time moves
// both and they still agree. GLSL text on WebGPU and a missing threedog/tsl fail by code, never silently. Software rendering like every pixel test.
export const specs = [
  {
    name: '[guard] particles / weather on WebGPURenderer: same count and positions as WebGL, picture mean within 3% (with fog 1%), time moves both; GLSL fails by name',
    url: '/tests/fx-particles/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.fxParticles());
      console.log('  fx particles numbers:', JSON.stringify(r));
      const near = c => c.meanDiff < 3 && c.centroid < 3 && c.mean > 0.5;
      for (const [n, c] of Object.entries(r.particles)) {
        check(`particles ${n}: WebGL Points / WebGPU Sprite with PointsNodeMaterial`, c.kinds.join() === 'Points,Sprite,PointsNodeMaterial', c.kinds.join());
        check(`particles ${n}: same live count and the same positions / sizes / alpha on both`, c.count[0] === 50 && c.count[1] === 50 && c.samePos && c.instances >= 50, JSON.stringify(c));
        check(`particles ${n}: picture mean differs < 3%, lit centroid < 3 px apart`, near(c), JSON.stringify(c));
        check(`particles ${n}: aged 0.5 s, both pictures move and still agree`, c.later.moved[0] > 1 && c.later.moved[1] > 1 && c.later.samePos && near(c.later), JSON.stringify(c.later));
      }
      for (const [n, c] of Object.entries(r.fog))
        check(`particles ${n} with fog (linear target, as with post on): fog changes the picture (> 5%), WebGPU mean within 1% of WebGL`,
          c.fogGL > 5 && c.meanDiff < 1 && c.centroid < 3, JSON.stringify(c));
      for (const [n, c] of Object.entries(r.weather)) {
        check(`weather ${n}: node material on WebGPU`, /NodeMaterial$/.test(c.kinds[2]) && c.kinds[1] === (n === 'rain' ? 'LineSegments' : 'Sprite'), c.kinds.join());
        check(`weather ${n}: same scatter and the same number drawn`, c.samePos && c.drawn[0] === c.drawn[1] && c.drawn[0] > 0, JSON.stringify(c));
        check(`weather ${n}: picture mean differs < 3%, lit centroid < 3 px apart`, near(c), JSON.stringify(c));
        check(`weather ${n}: time moved on, both pictures move and still agree`, c.later.moved[0] > 1 && c.later.moved[1] > 1 && near(c.later), JSON.stringify(c.later));
      }
      const e = r.errors;
      check('a weather glsl spec on WebGPU throws [webgpu-needs-tsl], naming the field and the TSL way', /weather particles 'ash'/.test(e.glslGpu) && /\[webgpu-needs-tsl\]/.test(e.glslGpu) && /create\(engine\)/.test(e.glslGpu), e.glslGpu);
      check('the same glsl spec still builds on WebGL', e.glslGl === 'no error', e.glslGl);
      check("without threedog/tsl, particles and weather on WebGPU say import 'threedog/tsl' [webgpu-needs-tsl]",
        [e.noTslParticles, e.noTslWeather].every(m => /import 'threedog\/tsl'/.test(m) && /\[webgpu-needs-tsl\]/.test(m)), JSON.stringify(e));
    },
  },
];
