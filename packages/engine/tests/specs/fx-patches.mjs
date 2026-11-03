// Patch `tsl` field (docs/plans/2026-11-03-webgpu-phase2.md §7 step 4): applyEffects on a NodeMaterial goes through each patch's tsl code.
// A guard: the built-in wind / clouds / season must draw on WebGPURenderer (WebGL2 backend) what they draw on WebGLRenderer, a GLSL-only patch
// must fail by name on a NodeMaterial (never be skipped silently), one slot's patches must chain in the order added, and the lighting slot
// must reach three's light loop. Steps 4-5 add detail (every projection, texture, bump / roughness), lighting (wrap / shadowTint / rim) and the
// water module's waves / waterSurface / fresnel to the same parity, and clone() + copyPatches applying each effect once. Rendered in software like every pixel test here (tools/run.mjs), so the numbers repeat on any machine.
export const specs = [
  {
    name: '[guard] patch tsl field: built-in wind / clouds / season / detail / lighting / water match GLSL on NodeMaterials; clone once; GLSL-only patches fail by name; slot chaining; lighting slot',
    software: true,   // pixel parity, read inside the page
    url: '/tests/fx-patches/index.html',
    async run({ check, ev }) {
      const r = await ev(() => window.fxPatches());
      console.log('  fx patches numbers:', JSON.stringify(r));
      check('baseline: the same lit vegetation scene without effects matches on both renderers (< 0.5%)', r.base < 0.5, String(r.base));
      for (const [n, c] of Object.entries(r.cases)) {
        check(`${n}: applyEffects on MeshLambertNodeMaterial vs MeshLambertMaterial differ on < 0.5% of pixels`, c.parity < 0.5 && c.mean > 5, JSON.stringify(c));
        check(`${n}: the effect itself changes the picture (on vs off > 1%), so the parity is not two no-ops`, c.effect > 1, JSON.stringify(c));
      }
      for (const [n, c] of Object.entries(r.water)) {
        check(`water ${n} (${c.patches}): the module's patches on MeshPhongNodeMaterial vs MeshPhongMaterial differ on < 0.5% of pixels`, c.parity < 0.5 && c.mean > 5, JSON.stringify(c));
        check(`water ${n}: the patches change the picture (on vs off > 1%)`, c.effect > 1, JSON.stringify(c));
      }
      const k = r.clone;
      check('clone() + copyPatches of a patched NodeMaterial draws what the original draws (each effect once, not chained twice)',
        k.cloned < 0.05 && k.effect > 1 && k.own && k.nodes[0] === k.nodes[1], JSON.stringify(k));
      check('clone() alone carries no patches (the plain material, as on the GLSL side)', k.bare < 0.05, JSON.stringify(k));
      check('wind: WebGL meshes keep their swaying depth / distance materials; NodeMaterial meshes get none (the shadow follows positionNode)',
        r.depth.gl && r.depth.gpu && r.depth.positionNode, JSON.stringify(r.depth));
      const e = r.errors;
      check('a GLSL-only patch on a NodeMaterial throws, first line naming it', e.glslOnly.includes("patch 'tint' has no tsl version; add tsl: (ctx) => ..., or keep this material on WebGLRenderer")
        && /\[shader-patch\]/.test(e.glslOnly), e.glslOnly);
      check("a style's own GLSL sway on a NodeMaterial says wind has no tsl version", e.styleWind.includes("patch 'wind' has no tsl version"), e.styleWind);
      check('a tsl patch on lightsPars points at the lighting slot\'s direct hook', /lightsPars/.test(e.lightsPars) && /direct/.test(e.lightsPars), e.lightsPars);
      check("a throwing tsl patch is reported with the prefix patch 'x' (slot y)", e.badCode.startsWith("[threedog] patch 'oops' (slot color): "), e.badCode);
      check('a lighting patch on an unlit NodeMaterial fails by name', /patch 'dark'/.test(e.unlit) && /lit material/.test(e.unlit), e.unlit);
      check('a patch that fails leaves the material\'s list as it was', r.rolledBack === 'season', r.rolledBack);
      const o = r.order, near = (a, b) => Math.abs(a - b) <= 3;
      check('two tsl patches on one slot chain in the order added (0.6 x0.5 +0.25 = 0.55; the other order 0.425), like GLSL',
        near(o.halfThenLift, 140) && near(o.liftThenHalf, 108) && near(o.glsl, o.halfThenLift), JSON.stringify(o));
      const l = r.lighting;
      check('lighting slot: a minimal tsl patch (no direct light) darkens the lit scene', l.noDirect < l.plain - 5, JSON.stringify(l));
      check('lighting slot hooks: direct() sees the sun and its shadow, and the after() code scales its light (between none and full)',
        l.directional && l.shadow && l.quarter < l.plain - 2 && l.quarter > l.noDirect + 2, JSON.stringify(l));
    },
  },
];
