// Light probes (render/probes.js). Page: tests/probes (gray floor, unlit red wall at +x, headless).
// The non-bypassable check: the probe next to the red wall must come out redder than the one far from it, so a bake that renders nothing,
// reads the wrong face or mixes up the grid order fails here; plus interpolation, the file round trip, refusal of a bad file, no leaked
// render targets, describe / ownership / debug view.

export const specs = [
  {
    name: 'light probes: bake sees the red wall, sample interpolates, toJSON -> loadProbes round-trips, no render target left, describe / owned / view',
    software: true,   // reads the baked colors
    url: '/tests/probes/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE } = threedogTest, info = engine.renderer.info, out = {};
        engine.step(0.1);
        const tex0 = info.memory.textures;
        const set = await engine.bakeProbes({ bounds: { min: [-3, 1, -1], max: [3, 1, 1] }, spacing: 3, resolution: 8, follow: () => [3, 1, 0], owner: 'probe-test' });
        out.texLeak = info.memory.textures - tex0;
        Object.assign(out, { count: set.count, counts: set.counts, bakeMs: set.bakeMs });
        // red share of the average light (DC term) at the probe beside the wall (x = 3) and the one far from it (x = -3)
        const red = sh => { const c = sh.coefficients[0]; return c.x / Math.max(1e-6, (c.x + c.y + c.z) / 3); };
        out.redNear = red(set.sample([3, 1, 0])); out.redFar = red(set.sample([-3, 1, 0]));
        // halfway between grid points x = 0 and x = 3 is their average
        const a = set.sample([0, 1, 0]).toArray(), b = set.sample([3, 1, 0]).toArray(), m = set.sample([1.5, 1, 0]).toArray();
        out.lerpErr = Math.max(...m.map((v, i) => Math.abs(v - (a[i] + b[i]) / 2)));
        out.clampErr = Math.max(...set.sample([99, 1, 0]).toArray().map((v, i) => Math.abs(v - b[i])));
        // the scene probe follows [3, 1, 0] and carries that sample after a frame
        engine.step(0.05);
        out.sceneProbe = Math.max(...set.probe.sh.toArray().map((v, i) => Math.abs(v - b[i])));
        // file round trip: JSON text -> loadProbes gives the same samples
        const json = JSON.parse(JSON.stringify(set.toJSON()));
        const loaded = engine.loadProbes(json, { follow: false });
        out.jsonErr = Math.max(...loaded.sample([1, 1, 0.3]).toArray().map((v, i) => Math.abs(v - set.sample([1, 1, 0.3]).toArray()[i])));
        out.loadedSource = loaded.source;
        // a damaged file is refused with a code and adds nothing
        const before = engine.describe().render.probes.length;
        try { engine.loadProbes({ ...json, sh: json.sh.slice(1) }); out.badData = 'no throw'; } catch (e) { out.badData = e.code; }
        try { engine.loadProbes({ ...json, format: 'x' }); out.badFormat = 'no throw'; } catch (e) { out.badFormat = e.code; }
        out.countAfterBad = engine.describe().render.probes.length - before;
        try { await engine.bakeProbes({ bounds: { min: [0, 0, 0], max: [1, 1, 1] }, spacing: 1, spacng: 2 }); out.typo = 'no throw'; } catch (e) { out.typo = e.code; }
        try { await engine.bakeProbes({ bounds: { min: [0, 0, 0], max: [100, 100, 100] }, spacing: 1 }); out.tooMany = 'no throw'; } catch (e) { out.tooMany = e.code; }
        // describe
        const d = engine.describe().render;
        out.describe = d.probes[0]; out.text = /probes: 6 \(3x1x2/.test(d.text);
        // the debug view draws one dot per probe and takes them away again
        engine.debug.view('probes', { owner: 'probe-test' });
        out.viewDots = engine.scene.getObjectByName('debug:probes')?.count ?? 0;
        engine.debug.clear('probe-test');
        out.viewGone = !engine.scene.getObjectByName('debug:probes');
        // ownership: a game that writes the probe's SH itself keeps it, the engine stops writing it (warns once)
        const warns = [], w0 = console.warn; console.warn = (...x) => warns.push(String(x[0]));
        try {
          set.probe.sh.coefficients[0].set(9, 9, 9); engine.step(0.05);
          out.kept = set.probe.sh.coefficients[0].x === 9; out.writer = engine.describe().render.probes[0].writer;
          out.warned = warns.some(w => /probes\.sh/.test(w) && /probes\.own\(\)/.test(w));
        } finally { console.warn = w0; }
        set.own(false); engine.step(0.05);
        out.handedBack = Math.abs(set.probe.sh.coefficients[0].x - b[0]) < 1e-5;
        // remove: the scene probe leaves, the data stays readable
        const probe = set.probe; set.remove(); set.remove(); loaded.remove();
        out.removed = !probe.parent && !engine.describe().render.probes.length && set.sample([0, 1, 0]).toArray()[0] === a[0];
        return out;
      });
      check('bake: 3 x 1 x 2 = 6 probes, time measured', r.count === 6 && r.counts.join() === '3,1,2' && r.bakeMs > 0, JSON.stringify(r));
      check('the probe beside the red wall is redder than the far one', r.redNear > r.redFar * 1.2, `near ${r.redNear} far ${r.redFar}`);
      check('sample halfway is the average of the two grid probes; outside the grid it clamps to the edge', r.lerpErr < 1e-5 && r.clampErr < 1e-5, `${r.lerpErr} ${r.clampErr}`);
      check('the scene LightProbe takes the sample at its follow point every frame', r.sceneProbe < 1e-5, String(r.sceneProbe));
      check('toJSON -> loadProbes gives the same samples', r.jsonErr < 1e-4 && r.loadedSource === 'file', String(r.jsonErr));
      check('a damaged / foreign file is refused (probes-data) and adds nothing', r.badData === 'probes-data' && r.badFormat === 'probes-data' && r.countAfterBad === 0, JSON.stringify(r));
      check('an option typo throws (module-params); too many probes throws (probes-option)', r.typo === 'module-params' && r.tooMany === 'probes-option', `${r.typo} ${r.tooMany}`);
      check('no render target / texture left after the bake', r.texLeak === 0, String(r.texLeak));
      check('describe().render.probes: count, owner, source, follow; text line', r.describe?.count === 6 && r.describe.owner === 'probe-test' && r.describe.source === 'bake' && r.text, JSON.stringify(r.describe));
      check("debug.view('probes'): one dot per live probe (6 + 6 loaded), gone after clear", r.viewDots === 12 && r.viewGone, String(r.viewDots));
      check('a direct sh write is kept (engine yields, warns once with the takeover call); manual(false) hands it back', r.kept && /yielded/.test(r.writer) && r.warned && r.handedBack, JSON.stringify({ kept: r.kept, writer: r.writer, warned: r.warned, back: r.handedBack }));
      check('remove(): probe leaves the scene and describe, data still readable; twice is harmless', r.removed);
    },
  },
  {
    // 为什么：步长 0 而一条轴上有 2 个以上探针的文件，sample() 里除以 0 得到 NaN，场景 LightProbe 全是 NaN，画面直接变黑也不报错；
    // follow 写错以前要等整个烘焙跑完（每个探针 6 次渲染）才在最后报出来。两者都应在动手之前拒绝。
    name: 'light probes: a file with step 0 on a multi-probe axis is refused; a bad follow is refused before any bake render',
    url: '/tests/probes/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.step(0.1);
        const counts = [2, 1, 1], json = { format: 'threedog-probes', version: 1, origin: [0, 0, 0], step: [0, 0, 0], counts, height: null, sh: new Array(2 * 27).fill(0.1) };
        const out = {};
        try { engine.loadProbes(json, { follow: false }); out.step0 = 'no throw'; } catch (e) { out.step0 = e.code; }
        const frames = engine.renderer.info.render.frame;
        try { await engine.bakeProbes({ bounds: { min: [-3, 1, -1], max: [3, 1, 1] }, spacing: 3, resolution: 8, follow: 'player' }); out.follow = 'no throw'; } catch (e) { out.follow = e.code; }
        out.renders = engine.renderer.info.render.frame - frames;
        out.left = engine.describe().render.probes.length;
        return out;
      });
      check('[guard] step 0 on an axis with 2+ probes is refused (probes-data), not sampled as NaN', r.step0 === 'probes-data', JSON.stringify(r));
      check('[guard] bakeProbes with a bad follow throws probes-option without rendering a cube', r.follow === 'probes-option' && r.renders === 0 && r.left === 0, JSON.stringify(r));
    },
  },
];
