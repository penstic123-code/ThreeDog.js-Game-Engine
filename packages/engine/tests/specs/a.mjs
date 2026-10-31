// Batch-3 group A specs (same format as packages/engine/tests/specs.mjs), appended at the end of specs.mjs.
// Checks use engine.step / describe, no screenshots. Timing numbers go into the detail text (visible in npm test output).
export const specs = [
  {
    name: 'A: compressed assets (Meshopt / Draco / KTX2)',
    url: '/tests/a/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { urls } = threedogTest, tris = o => { let n = 0; o.traverse(m => { if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return n; };
        const a = await engine.assets.model(urls.meshopt), b = await engine.assets.model(urls.draco);
        const t = await engine.assets.texture(urls.ktx2);
        const plane = new threedogTest.THREE.Mesh(new threedogTest.THREE.PlaneGeometry(2, 2), engine.level.root.children[0].material.clone());
        plane.material.map = t; engine.add(plane); engine.step(1 / 30);
        return { a: tris(a), b: tris(b), draco: !!engine.assets.draco, compressed: !!t.isCompressedTexture, ktx2: !!engine.assets.ktx2 };
      });
      check('Meshopt box has 12 triangles', r.a === 12, JSON.stringify(r));
      check('Draco box has 12 triangles (decoder loaded on demand)', r.b === 12 && r.draco, JSON.stringify(r));
      check('KTX2 texture is a compressed texture', r.compressed && r.ktx2, JSON.stringify(r));
    },
  },
  {
    name: 'A: streaming and time-sliced jobs',
    url: '/tests/a/',
    async run({ check, ev }) {
      const s0 = await ev(() => ({ ...engine.stream.stats, startup: engine.startup }));
      check('at startup, in-range chunks are built and out-of-range ones are not', s0.queued === 0 && s0.built > 0 && s0.built < 100, JSON.stringify(s0));
      // both default stream sources leave: the player (engine.stream.player) and the camera focus (engine.stream.camera)
      const far = await ev(() => { window.aHome = engine.player.position.clone(); engine.player.placeAt([500, 0, 500]); engine.focus.set(500, 0, 500); engine.step(0.5); return engine.stream.stats; });
      check('player and focus moved away: old chunks unload, nothing is built where nothing is registered', far.built === 0, JSON.stringify(far));
      const back = await ev(async () => {
        engine.player.placeAt(window.aHome); engine.focus.set(0, 0, 0);
        for (let i = 0; i < 60 && (engine.stream.stats.built === 0 || engine.stream.stats.queued); i++) { engine.step(1 / 30); await new Promise(r => setTimeout(r, 0)); }
        return engine.stream.stats;
      });
      check('player and focus returned: chunks rebuild', back.built === s0.built && back.queued === 0, JSON.stringify(back));
      const jobs = await ev(async () => {
        const log = [];
        const p = engine.jobs.add(function* () { for (let i = 0; i < 5; i++) { log.push(i); const t = performance.now(); while (performance.now() - t < 2); yield; } return 'ok'; });
        engine.jobs.add(() => log.push('hi'), { priority: 5 });
        engine.jobs.run();                      // one frame: 3 ms budget, cannot finish
        const afterOne = log.length;
        for (let i = 0; i < 10; i++) engine.jobs.run();
        return { afterOne, log: log.join(','), result: await p };
      });
      check('time-sliced jobs: higher priority runs first, generator finishes over several frames', jobs.log.startsWith('hi,0') && jobs.afterOne < 6 && jobs.result === 'ok', JSON.stringify(jobs));
    },
  },
  {
    name: 'A: raycast (BVH acceleration)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const cam = engine.camera, b = engine.level.root.getObjectByName('building_1_1');
        cam.position.set(22, 30, 60); cam.lookAt(22, 5, 22); cam.updateMatrixWorld();
        engine.cameraOverride = { owner: 'test' };
        const hit = engine.pick(0, 0);
        // 1000 rays from a height toward the surrounding buildings
        const rays = [];
        for (let i = 0; i < 1000; i++) { const a = i * 2.399; rays.push([{ x: Math.cos(a) * 5, y: 3 + (i % 10), z: Math.sin(a) * 5 }, { x: Math.cos(a), y: -0.05, z: Math.sin(a) }]); }
        const run = () => { const t = performance.now(); let n = 0; for (const [o, d] of rays) if (engine.raycast(o, d)) n++; return { ms: +(performance.now() - t).toFixed(1), n }; };
        const withBvh = run();
        const geos = [...engine.rays.statics.keys()].map(m => m.geometry), saved = geos.map(g => g.boundsTree);
        geos.forEach(g => { g.boundsTree = null; });
        const without = run();
        geos.forEach((g, i) => { g.boundsTree = saved[i]; });
        return { name: hit?.object.name, bvh: !!b.geometry.boundsTree, withBvh, without, statics: engine.rays.statics.size };
      });
      check('pick on a city building returns building_*', /^building_/.test(r.name ?? ''), JSON.stringify(r));
      check(`city 1000 rays ${r.withBvh.ms} ms (box building has 12 triangles, no tree built: ${!r.bvh})`, !r.bvh && r.withBvh.n === r.without.n && r.withBvh.n > 0, JSON.stringify(r));
      const hp = await ev(() => {
        const T = engine.THREE, m = new T.Mesh(new T.SphereGeometry(10, 256, 256), engine.level.root.getObjectByName('ground').material);
        m.position.set(0, 20, 300); engine.add(m); m.updateMatrixWorld();
        const tris = m.geometry.index.count / 3, rays = [];
        for (let i = 0; i < 1000; i++) rays.push([{ x: (i % 40) / 4 - 5, y: 20 + Math.floor(i / 40) / 4 - 3, z: 250 }, { x: 0, y: 0, z: 1 }]);
        const run = (k = 1) => { const t = performance.now(); let n = 0; for (let i = 0; i < rays.length; i += k) if (engine.raycast(rays[i][0], rays[i][1], { targets: [m] })) n++; return { ms: +((performance.now() - t) * k).toFixed(1), n: n * k }; };
        const without = run(25);   // without BVH this is too slow: cast only 40 rays and scale to 1000
        const tb = performance.now(); engine.rays.addStatic(m); const buildMs = +(performance.now() - tb).toFixed(1);
        const withBvh = run();
        return { tris, without, withBvh, buildMs, tree: !!m.geometry.boundsTree };
      });
      check(`high-poly ${hp.tris} triangles, 1000 rays: BVH ${hp.withBvh.ms} ms / without about ${hp.without.ms} ms (tree build ${hp.buildMs} ms)`, hp.tree && hp.withBvh.n > 0 && hp.withBvh.ms < hp.without.ms, JSON.stringify(hp));
    },
  },
  {
    name: 'A: photo subject',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.timeline.skip?.();
        const npc = engine.npcs.list()[0], p = npc.root.position, cam = engine.camera;
        engine.cameraOverride = { owner: 'test' };
        cam.position.set(p.x + 4, p.y + 1.5, p.z + 4); cam.lookAt(p.x, p.y + 1, p.z); cam.updateMatrixWorld();
        const shot = engine.ops.run('photo.take', {}, { source: 'test' }).value;
        return { subject: shot.subject, npc: npc.name };
      });
      check('photo of an NPC: subject is that NPC', r.subject?.kind === 'npc' && r.subject.name === r.npc && r.subject.distance > 3, JSON.stringify(r));
    },
  },
  {
    name: 'A：烘焙往返（代码搭的街区 → GLB → level.load）',
    url: '/tests/a/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const stats = () => {
          engine.step(1 / 30);
          const lv = engine.level, mats = new Set();
          lv.root.traverse(o => { if (o.isMesh) mats.add(o.material.type + ':' + (o.material.userData.purpose ?? '')); });
          return { boxes: engine.collision.boxes.length, markers: Object.keys(lv.markers).sort().join(','), calls: engine.renderer.info.render.calls, mats: [...mats].sort().join(','),
            spawn: lv.spawn.toArray().map(v => +v.toFixed(2)).join(','), height: +engine.surface(0, -14).toFixed(2) };
        };
        engine.player.placeAt([1000, 0, 1000]); engine.focus.set(1000, 0, 1000); engine.step(0.2);   // both stream sources leave: unload streamed blocks first so they do not affect draw calls
        const code = stats();
        const buf = await threedogTest.toGLB(threedogTest.buildTestBlock());
        const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
        let loaded = 0; engine.events.on('level:loaded', () => loaded++);
        await engine.level.load(url);
        const file = stats();
        engine.saves.save('a-test');
        const saved = JSON.parse(decodeURIComponent(escape(atob(engine.saves.export('a-test'))))).parts.level;   // the save lives in IndexedDB; read the in-memory copy via export
        return { code, file, loaded, saved: saved === url, bytes: buf.byteLength };
      });
      check('collider count matches', r.code.boxes === r.file.boxes && r.code.boxes > 0, JSON.stringify(r));
      check('marker names, spawn point and ground height match', r.code.markers === r.file.markers && r.code.spawn === r.file.spawn && r.code.height === r.file.height, JSON.stringify(r));
      check('draw calls match', r.code.calls === r.file.calls, `${r.code.calls} / ${r.file.calls}`);
      check('material type and purpose are restored as-is', r.code.mats === r.file.mats, `${r.code.mats} | ${r.file.mats}`);
      check('level.load emits level:loaded and the current level is recorded in the save', r.loaded === 1 && r.saved, JSON.stringify(r));
      const c = await ev(async () => {
        let n = 0;
        const build = () => { n++; return new threedogTest.THREE.BoxGeometry(1, 2, 3); };
        const g1 = await engine.assets.cached('a-box', build), g2 = await engine.assets.cached('a-box', build);
        const o = await engine.assets.cached('a-block', threedogTest.buildTestBlock);
        return { n, same: g1 === g2, geo: !!g1.isBufferGeometry, obj: !!o.getObjectByName('spawn') };
      });
      check('assets.cached: same name builds once, geometry is shared, objects get a copy', c.n === 1 && c.same && c.geo && c.obj, JSON.stringify(c));
    },
  },
  {
    name: 'A: warning for per-frame overridden props (ownedProps)',
    url: '/tests/a/',
    async run({ page, check, ev }) {
      const warns = [];
      page.on('console', m => { if (m.type() === 'warning' && m.text().includes('test.light')) warns.push(m.text()); });
      await ev(() => {
        const light = { intensity: 1 }, own = threedogTest.ownedProps('test.light.intensity', () => light.intensity, 'hint');
        const frame = () => { own.check(); light.intensity = 1; own.mark(); };   // what a module does each frame: check, write, mark
        frame(); frame();
        light.intensity = 9; frame(); frame();      // game edits it directly: one warning
        light.intensity = 9; frame();               // edited again: no repeat
        threedogTest.allowOwned('timeline'); light.intensity = 5; frame(); threedogTest.allowOwned('timeline', false);   // no warning while exempted
      });
      await new Promise(r => setTimeout(r, 200));
      check('direct edit warns once, does not repeat, and stays silent when exempted', warns.length === 1, warns.join(' | '));
    },
  },
  {
    name: 'A: URL scenario (?state= / ?pos=)',
    url: '/tests/a/?state=corner&wait=1',
    async run({ check, ev }) {
      const r = await ev(() => ({ applied: engine.stateApplied, x: engine.player.position.x, z: engine.player.position.z, t: engine.elapsed }));
      check('?state=corner expands to pos=30,30 and wait=1 advanced 1 second', r.applied && Math.abs(r.x - 30) < 0.5 && Math.abs(r.z - 30) < 0.5 && r.t >= 0.99, JSON.stringify(r));
    },
  },
  {
    name: 'A: URL scenario (open world time / weather / pos / cutscene)',
    url: '/?time=18:30&weather=rain&pos=40,-20&cutscene=skip',
    async run({ check, ev }) {
      const d = await ev(() => {
        const s = engine.describe(), hooks = name => !!engine.modules.get(name)?.applyState;
        return { applied: engine.stateApplied, x: s.player.x, z: s.player.z, clock: s.time.clock, weather: s.weather?.name, cutscene: !!engine.timeline.playing, sky: hooks('sky'), wea: hooks('weather'), tl: hooks('timeline') };
      });
      check('pos=40,-20 takes effect', d.applied && Math.abs(d.x - 40) < 1 && Math.abs(d.z + 20) < 1, JSON.stringify(d));
      // time / weather / cutscene are handled by group C/D module hooks: do not fail while a hook is not merged yet
      check('time=18:30 (sky hook)', !d.sky || d.clock?.startsWith('18:3'), JSON.stringify(d));
      check('weather=rain (weather hook)', !d.wea || d.weather === 'rain', JSON.stringify(d));
      check('cutscene=skip (timeline hook)', !d.tl || !d.cutscene, JSON.stringify(d));
    },
  },
];
