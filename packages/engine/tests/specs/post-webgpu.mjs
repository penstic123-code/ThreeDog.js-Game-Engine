// Post chain on WebGPU (docs/plans/2026-11-03-webgpu-phase2.md §7 step 7): render/PostFX.js runs the same effect list through RenderPipeline
// (render/fx/postWebGPU.tsl.js) on a WebGPURenderer (WebGL2 backend). A guard: the four slots keep their order with tone mapping placed by hand
// (ldr / final effects color the tone-mapped image), lut and a game tone stage give the same pixels, bloom and vignette look the same on both backends (screenshot mean within 3%: bloom is not
// compared pixel by pixel, UnrealBloomPass and bloom() blur differently; outline and dof are the engine's GLSL ported step by step), an effect with only a three.js Pass fails by name with the node: form,
// and look.post.manual() stops the engine rebuilding the chain. software: like every pixel test here, so the numbers repeat on any machine.
export const specs = [
  {
    name: '[guard] post on WebGPU: slot order around renderOutput, bloom / vignette / outline / dof match WebGL (mean < 3%), lut and a game tone stage match per pixel, create-only Pass fails by name, manual() stops rebuilds',
    url: '/tests/post-webgpu/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.postWebGPU());
      console.log('  post webgpu numbers:', JSON.stringify(r));
      for (const [n, c] of Object.entries(r.direct))
        check(`no effects (straight to the canvas), ${n}: WebGPU vs WebGL screenshot mean within 1%`, !c.active && c.diff < 1, JSON.stringify(c));
      const pa = r.parity;
      check('baseline: both chains on with a no-op effect, screenshot means within 3%', pa.base.diff < 3, JSON.stringify(pa.base));
      for (const n of ['bloom', 'vignette'])
        check(`${n}: WebGPU vs WebGL screenshot mean within 3%, and the effect changes the mean on both (> 3%)`,
          pa[n].diff < 3 && pa[n].effectGL > 3 && pa[n].effectGPU > 3, JSON.stringify(pa[n]));
      // outline / dof are the engine's own passes ported to nodes: the mean must agree (< 3%) and the effect must really draw on both
      // (mean absolute pixel change vs the no-op chain > 0.5% of 255: about one pixel in ten changed fully; a blur barely moves the mean itself)
      const fxOk = c => c.diff < 3 && c.effectGL > 0.5 && c.effectGPU > 0.5;
      for (const [n, c] of Object.entries(r.outline))
        check(`outline ${n}: WebGPU node vs WebGL OutlinePass screenshot mean within 3%, lines drawn on both`, fxOk(c), JSON.stringify(c));
      check('outline offLayer: the exempt sphere loses its lines on both backends (less change than without the mask)',
        r.outline.offLayer.effectGL < r.outline.depth.effectGL - 0.2 && r.outline.offLayer.effectGPU < r.outline.depth.effectGPU - 0.2, JSON.stringify(r.outline.offLayer));
      check('dof: WebGPU node vs WebGL DofPass screenshot mean within 3%, blur visible on both', fxOk(r.dof), JSON.stringify(r.dof));
      // lut and a game tone stage run the same per-pixel math on both backends: besides the mean, the two shots agree pixel by pixel
      // (mean absolute difference < 1% of 255), and the effect really changes the picture on both (> 1% of 255 against the no-op chain)
      const exact = c => c.diff < 3 && c.cross < 1 && c.effectGL > 1 && c.effectGPU > 1;
      for (const [n, c] of Object.entries(r.lut))
        check(`lut ${n}: WebGPU vs WebGL mean within 3% and per pixel within 1% of 255, grading visible on both`, exact(c), JSON.stringify(c));
      for (const [n, c] of Object.entries(r.tone))
        check(`tone slot ${n}: a game tone stage (Pass on WebGL, node on WebGPU) gives the same pixels (mean 3%, per pixel 1% of 255), replacing the default curve`,
          exact(c), JSON.stringify(c));
      // smoke only: this scene has no contact corners, so GTAOPass barely changes it; the darkening is GTAONode on the reconstructed normals
      check('ao: GTAONode builds on the scene pass depth and renders on WebGPU (picture a little darker), mean within 3% of WebGL',
        pa.ao.darkerGPU && pa.ao.diff < 3, JSON.stringify(pa.ao));
      check('four slots in order: scene effect, hdr (bloom), output (tone mapping), ldr by order (chromatic lut vignette grain), final',
        r.order.join(',') === 'pixelScene,bloom,output (tone mapping),chromatic,lut,vignette,grain,sharpen', r.order.join(','));
      const g = r.graph;
      check('the node graph: bloom is under renderOutput, the ldr effects (vignette, lut) are outside it', g.renderOutput && g.bloomUnder && g.vigInGraph && g.vigAfter && g.lutAfter, JSON.stringify(g));
      check('post.object() on WebGPU is { pipeline, scenePass }, with outputColorTransform off (renderOutput placed by hand)',
        r.object.pipeline && r.object.scenePass && r.object.manualOutput, JSON.stringify(r.object));
      check('a number param writes its uniform (no pipeline rebuild)', r.live.same && Math.abs(r.live.value - 0.7) < 1e-6, JSON.stringify(r.live));
      check("a param the effect reads as a plain value (ctx.params in node(), baked at create() without update()): set() changes the picture on WebGL and WebGPU alike (about x2)",
        ['gl', 'gpu'].every(b => r.plainParam[b].ratio > 1.7 && r.plainParam[b].ratio < 2.2) && Math.abs(r.plainParam.gl.ratio - r.plainParam.gpu.ratio) < 0.1, JSON.stringify(r.plainParam));
      check("an effect with only create() (a three.js Pass) throws on WebGPU naming it, with the node: form and the post-effect code",
        r.onlyCreate.includes("post effect 'myCopy' has only create()") && r.onlyCreate.includes('node: (input, ctx)') && r.onlyCreate.includes('[post-effect]') && r.onlyCreateGone, r.onlyCreate);
      check('a GLSL-only fuse effect throws on WebGPU naming it, with the fuse.tsl form', r.glslFuse.includes("post effect 'tintGL'") && r.glslFuse.includes('fuse.tsl'), r.glslFuse);
      for (const b of ['gpu', 'gl'])
        check(`${b}: look.post.manual() keeps the built chain through a chain change (writer manual:game); manual(false) rebuilds it`,
          r.manual[b].kept && r.manual[b].rebuilt && r.manual[b].writer === 'manual:game', JSON.stringify(r.manual[b]));
    },
  },
];
