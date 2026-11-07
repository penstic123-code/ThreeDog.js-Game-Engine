// Real-time light: the guards for @threedog/post-effects/tsl. Ordinary runs land on WebGPURenderer's WebGL2 backend, where voxel GI cannot run: there the check is that it
// says so. `node packages/tools/real-webgpu.mjs light-webgpu` runs the same specs on real WebGPU, where light must actually bounce.
export const specs = [
  {
    name: '[guard] voxel GI: a red wall tints its white neighbor on WebGPU, switching off removes the cost, low tier and the WebGL2 backend hold it off and say so',
    url: '/tests/light-webgpu/index.html',
    software: true,
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
      const r = await ev(() => window.lightGI());
      console.log('  voxel GI numbers:', JSON.stringify(r));
      check('describe() says temporalAA stands in for MSAA, and the real samples without it', r.antialias.samples === 0 && r.antialias.replacedBy === 'temporalAA' && r.aaText && r.msaa.samples === 4 && r.msaaText, JSON.stringify([r.antialias, r.msaa]));
      if (r.backend !== 'webgpu') {
        check(`on the ${r.backend} backend it is held off, not silently dropped: describe() names why`, r.row.on === false && /forceWebGL/.test(r.row.held), JSON.stringify(r.row));
        check('nothing was built and the chain does not hold it', !r.built && !r.buffersWithoutGI);
        return;
      }
      const tint = c => c.r - c.g;
      check(`light bounces: red minus green on the white wall ${tint(r.plain)} -> ${tint(r.bounced)}`, tint(r.bounced) > tint(r.plain) + 4, JSON.stringify([r.plain, r.bounced]));
      check('the normal and diffuse buffers come from one merged scene render, with velocity for temporalAA', ['normal', 'diffuse', 'velocity'].every(b => r.buffersOn.includes(b)), JSON.stringify(r.buffersOn));
      check('describe() reports the voxel size, and nothing once the chain let it go', r.row.facts?.voxelSize > 0 && r.off.facts === null, JSON.stringify([r.row, r.off.facts]));
      // 不许绕开: voxelGI and occlusion together, what culling hides stays in the bounce
      check(`a wall occlusion culling hides still bounces: red minus green ${tint(r.plain)} -> ${tint(r.hiddenBounce)}`, tint(r.hiddenBounce) > tint(r.plain) + 4, JSON.stringify(r.hiddenBounce));
      check('low tier: held, out of the chain, and describe() says why', !r.lowTier.on && !r.lowTier.order && /low/.test(r.lowTier.held), JSON.stringify(r.lowTier));
      check(`off removes it: not in the chain, no extra scene outputs, ${r.costOn} ms -> ${r.off.cost} ms (base ${r.base} ms)`,
        !r.off.order.includes('voxelGI') && !r.off.mrt && r.off.cost < Math.max(r.base * 1.5, r.base + 0.5), JSON.stringify(r.off));
    },
  },
  {
    // 不许绕开: every reason an effect is held, without a GPU, so no run can skip them
    name: '[guard] voxel GI held: a fake effect through low tier, WebGL2 backend, the swap to WebGLRenderer, a game that chose WebGL, forceWebGL',
    url: '/tests/light-webgpu/index.html',
    software: true,
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
      const r = await ev(() => window.lightHeld()), c = r.cases;
      check('real WebGPU on a good tier: nothing held', c.runs === null, JSON.stringify(c));
      check('low tier: follows the declaration and names it', /tier is 'low'.*skipOnLowTier/.test(c.low), c.low);
      check('the game has it off: not held, whatever the tier', c.lowOff === null, c.lowOff);
      check('the device has no WebGPU: says so', /this device has none/.test(c.webgl2), c.webgl2);
      check('swapped to WebGLRenderer: the device, not the game', /fell back to WebGLRenderer/.test(c.swapped), c.swapped);
      check('forceWebGL: the game, not the device', /game chose WebGL2 \(forceWebGL/.test(c.forced), c.forced);
      check('a WebGLRenderer the game chose: not held, on a low tier either', c.chose === null && c.choseLow === null, JSON.stringify([c.chose, c.choseLow]));
      check('the fake and all four effects throw the same named error there', r.errors.length === 5 && r.errors.every(m => /has only node\(\).*chose WebGLRenderer/.test(m)), JSON.stringify(r.errors));
      check('a hold is said once in the console', r.lowNotes === 1, String(r.lowNotes));
    },
  },
  {
    name: '[guard] sun shafts and light volumes: a missing light or missing bounds throw by name',
    url: '/tests/light-webgpu/index.html',
    software: true,
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
      const r = await ev(() => window.lightMissing());
      check('lightVolumes() names bounds', /lightVolumes: bounds is required/.test(r.noBounds), r.noBounds);
      check('sunShafts() with no sun names the light', /sunShafts: no light/.test(r.noLight), r.noLight);
    },
  },
  {
    name: '[guard] sun shafts: a shaft stands out from the dark room',
    url: '/tests/light-webgpu/index.html',
    software: true,
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
      const r = await ev(() => window.lightShafts());
      console.log('  sun shaft numbers:', JSON.stringify(r));
      const flat = r.rows.flat(), most = Math.max(...flat), least = Math.min(...flat);
      check(`shafts are local, not a haze over the whole frame: ${least} to ${most}`, most > 6 && most > 3 * Math.max(least, 0.5), JSON.stringify(r.rows));
    },
  },
  {
    name: '[guard] light volumes: a spot cone lights the air where it stands, the sun does nothing and describe() says so',
    url: '/tests/light-webgpu/index.html',
    software: true,
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
      const r = await ev(() => window.lightCones());
      console.log('  light volume numbers:', JSON.stringify(r));
      const flat = r.cone.flat(), most = Math.max(...flat), least = Math.min(...flat);
      check(`the cone is local: ${least} to ${most}`, most > 6 && most > 3 * Math.max(least, 0.5), JSON.stringify(r.cone));
      check(`the sun adds nothing (${r.sunOnly}) and describe() says that`, Math.abs(r.sunOnly) < 1 && /sun does nothing/.test(r.fact.lights), JSON.stringify(r));
      check(`a scene.backgroundNode stays out of the air, only light is added (${r.skyOnly}), and the game keeps its node`, Math.abs(r.skyOnly) < 1 && r.atDraw?.backgroundNode === null && r.atDraw.background === null && r.atDraw.alpha === 0 && r.nodeKept, JSON.stringify(r.atDraw));
      check('removing it takes the layer off the lights it lit', r.lampLayer && r.lampBack, JSON.stringify([r.lampLayer, r.lampBack]));
    },
  },
];
