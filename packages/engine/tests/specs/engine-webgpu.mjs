// [guard] The engine's own content on the WebGPU route (docs/plans/done/2026-11-03-review-0.4.md section 2.D). Terrain, vegetation, water, sky,
// particles and bloom all on, drawn by a WebGL engine and a renderer: 'webgpu' engine (headless: WebGPURenderer's WebGL2 backend), compared
// per pixel; each patch effect must also move on WebGPU (wind sways, the season tint recolors). Plus fallback: 'webgl' with post, sky (hook, fog, cascades), particles, weather.
// Why a guard: the engine's materials once drew on WebGPU without any of their patches and nothing said so.
export const specs = [
  {
    name: '[guard] engine content on WebGPU looks like WebGL: terrain / vegetation / water / sky / particles / post, effects move; fallback webgl rebuilds post, sky, fog, cascades, particles, weather',
    url: '/tests/engine-webgpu/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.engineWebGPU());
      console.log('  engine webgpu numbers:', JSON.stringify(r));
      check('the WebGPU engine runs WebGPURenderer (webgpu or its webgl2 backend)', ['webgpu', 'webgl2'].includes(r.backend), r.backend);
      check('engine materials with patches are in the scene (terrain, vegetation, water)', r.materials.length >= 3 && r.materials.some(m => m.patches.includes('wind')), JSON.stringify(r.materials));
      check('the swaying material carries its tsl position chain on WebGPU (positionNode for the shadow pass)', r.materials.filter(m => m.patches.includes('wind')).every(m => m.position), JSON.stringify(r.materials));
      check('near-only plants draw on WebGPU with their distance fade (the nearFade patch has a tsl form: once GLSL only, it froze the world example on WebGPU)',
        r.materials.some(m => m.patches.includes('nearFade') && m.position) && !r.errors.length, JSON.stringify(r.materials));
      // tight on purpose: the WebGPU route was once 4% darker overall (Lambert / Phong node twins lost scene.environment's fill) while
      // under 4% of pixels differed by more than 24 levels, so a loose per-pixel bound alone let a whole-picture shift through
      check('WebGPU and WebGL pictures agree: mean brightness within 1.5 levels, under 1.5% of pixels differ by more than 24 levels, under 4% by more than 8',
        Math.abs(r.mean.gl - r.mean.gpu) < 1.5 && r.differ < 1.5 && r.differFine < 4, JSON.stringify({ differ: r.differ, differFine: r.differFine, mean: r.mean }));
      check('wind sways the trees on WebGPU about as much as on WebGL (both > 0.3% of pixels)', r.sway > 0.3 && r.swayGL > 0.3, JSON.stringify({ gpu: r.sway, gl: r.swayGL }));
      check('the season tint recolors terrain and trees on WebGPU (> 5% of pixels)', r.tint > 5, String(r.tint));
      const ts = await ev(() => window.textureShading());
      console.log('  texture shading numbers:', JSON.stringify(ts));
      check("terrain shading: 'texture': the color map patch draws on WebGPU like WebGL (same bounds as the whole picture)",
        ts.patched && !ts.errors.length && Math.abs(ts.mean.gl - ts.mean.gpu) < 1.5 && ts.differ < 1.5 && ts.differFine < 4, JSON.stringify(ts));
      const pm = await ev(() => window.patchMeanings());
      console.log('  patch meanings numbers:', JSON.stringify(pm));
      check('patch meanings match: a position offset on turned instances and a lighting direct() hook after another patch draw the same on both routes',
        pm.differ < 0.5 && pm.differFine < 1.5, JSON.stringify(pm));
      const f = await ev(() => window.fallbackWebGL());
      console.log('  fallback webgl numbers:', JSON.stringify(f));
      check("fallback 'webgl' with bloom and sky: start() succeeds on WebGLRenderer, the dome rebuilt as a WebGL material, the picture is drawn",
        !f.error && f.isWebGL && f.backend === 'webgl' && !f.domeNode && f.mean > 5, JSON.stringify(f));
      check("fallback 'webgl': a look.sky.patch('clouds') made before start() is on the rebuilt dome; no node material left in the scene",
        !f.error && f.cloudHook && f.nodeMats.length === 0, JSON.stringify(f));
      check("fallback 'webgl': particles and rain / snow rebuilt as WebGL points / lines, rain drawn; exp fog moved from the scene fog node to the patch; cascades are lights",
        !f.error && f.particles === 'Points ShaderMaterial' && f.rain === 'ShaderMaterial' && f.snow === 'ShaderMaterial' && f.rainShown && !f.fogNode && f.fogPatch && f.csm === 'lights', JSON.stringify(f));
      const ps = await ev(() => window.programSharing());
      console.log('  program sharing numbers:', JSON.stringify(ps));
      check(`${ps.materials} materials of one style role (lighting + detail) share their patch objects on WebGPU: one node key, at most 2 node builds (was one per material)`,
        ps.nodeKeys === 1 && ps.builds <= 2 && ps.colors === ps.materials, JSON.stringify(ps));
      const cs = await ev(() => window.colorSpots());
      console.log('  color spots numbers:', JSON.stringify(cs));
      // same bound as the whole picture above: these two once differed on 9-15% (transparent in fog) and ~6% (sRGB background) of pixels
      for (const [k, what] of [['fog', 'half-transparent meshes in fog'], ['backgroundFlat', 'an sRGB texture as scene.background (no tone mapping)']])
        check(`${what}: WebGPU and WebGL agree (mean within 1.5 levels, under 1.5% of pixels differ by more than 24 levels, under 4% by more than 8)`,
          Math.abs(cs[k].mean.gl - cs[k].mean.gpu) < 1.5 && cs[k].differ < 1.5 && cs[k].differFine < 4, JSON.stringify(cs[k]));
      // once a known difference (WebGL's straight path left the sRGB background out of tone mapping, three's WebGLBackground rule): the
      // engine tone-maps it there too (render/postWebGL.js toneBackground), so a skybox photo no longer changes with MSAA, effects or renderer
      check('an sRGB texture as scene.background with tone mapping: WebGPU and WebGL straight-to-canvas agree (same bounds)',
        Math.abs(cs.background.mean.gl - cs.background.mean.gpu) < 1.5 && cs.background.differ < 1.5 && cs.background.differFine < 4, JSON.stringify(cs.background));
      const bc = cs.backgroundComposer;
      check('the same sRGB background on WebGL: straight to the canvas = through the composer (under 1% of pixels differ by more than 8); back to straight is the first picture',
        !bc.direct && bc.composer && bc.differFine < 1 && bc.back < 0.5, JSON.stringify(bc));
    },
  },
];
