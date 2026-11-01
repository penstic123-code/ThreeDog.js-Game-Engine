// Vegetation on any ground ("do not bypass" guards): without terrain, vegetation grows on its own chunks over whoever provides the ground --
// here a level built in code with a 'lawn' and a 'stone' floor at y = 5. Plants follow the rule (only on lawn, at the floor's height, inside
// the area), stay one InstancedMesh per species per chunk, block walking through collision, are felled / saved like terrain trees,
// stream out and back with the source, and a code-built ground (setGround) rebuilds them. Same format as specs.mjs. Run: npm test -- "vegetation ground"

export const specs = [
  {
    name: 'vegetation ground: grows on a level model by ground type (no terrain), instanced per chunk, collision / felling / streaming / setGround follow',
    url: '/tests/terrain-edit/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, vegetation, collision, level, THREE } = threedogTerrain;
        const wait = () => new Promise(res => setTimeout(res, 5));
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, loading: false, urlState: false, saveKey: 'veg-ground' });
        const root = new THREE.Group();
        const floor = (name, type, x) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2)); m.name = name; m.position.set(x, 5, 0); m.userData.groundType = type; root.add(m); };
        floor('ground_lawn', 'lawn', -20); floor('ground_stone', 'stone', 20);
        E.use(level({ scene: root }), vegetation({ chunkSize: 16, viewChunks: 3, area: { min: [-40, -20], max: [40, 20] } }), collision());
        E.vegetation.add('bush', { geometry: new THREE.ConeGeometry(0.5, 1, 5), rule: { perChunk: 80, maxSlope: 1, sink: 0, biomes: { lawn: 1 }, collider: 0.4 } });
        await E.start();
        const settle = async (x, z) => { E.focus.set(x, 0, z); for (let i = 0; i < 300 && E.stream.sources().length && !E.vegetation.host.isReadyAround({ x, z }); i++) { E.step(1 / 60); await wait(); } E.step(2.2); };   // 2.2 s: the outer ring's collision is due by then (commits lag by ring)
        await settle(0, 0);
        const H = E.vegetation.host, all = [];
        let meshes = 0, perChunkMeshes = true;
        for (const c of H.chunks.values()) {
          const ims = Object.values(c.veg); meshes += ims.length; if (ims.length > 1) perChunkMeshes = false;
          for (const im of ims) { const a = im.instanceMatrix.array; for (let i = 0; i < im.count; i++) all.push([c.cx * H.CHUNK + a[i * 16 + 12], a[i * 16 + 13], c.cz * H.CHUNK + a[i * 16 + 14]]); }
        }
        // ground types are read per level grid point (0.5 m): at the lawn / stone seam a plant may sit up to half a cell over the line
        const out = { terrain: !!E.terrain, n: all.length, meshes, perChunkMeshes, instanced: [...H.chunks.values()].every(c => Object.values(c.veg).every(im => im.isInstancedMesh)),
          onLawn: all.every(p => p[0] <= 0.26 && p[0] >= -40 && Math.abs(p[2]) <= 20), atFloor: all.every(p => Math.abs(p[1] - 5) < 1e-4) };
        // collision: the walk check refuses the spot of a bush (circles reach collision through engine.ground.forEachCollider)
        const b = all[0];
        out.blocked = b ? !E.collision.walkableAt(b[0], b[2], 0.3) : null;
        out.freeOnStone = E.collision.walkableAt(20, 0, 0.3);
        // felling is the same as on terrain: instanceAt -> removeInstance hides it, drops its collider and goes into the save
        const hit = b && E.vegetation.instanceAt({ x: b[0], z: b[2] }, { radius: 0.5 });
        if (hit) E.vegetation.removeInstance(hit.species, hit.cx, hit.cz, hit.id);
        out.felled = hit ? E.collision.walkableAt(b[0], b[2], 0.3) || null : null;
        const saved = JSON.parse(JSON.stringify(E.saves.collect()));
        out.saved = hit ? saved.parts.vegetation?.removed?.[E.vegetation.key(hit.species, hit.cx, hit.cz, hit.id)] === null : false;
        // stream away and back: chunks are released, then placed again with the same plants and the felled one still gone
        await settle(4000, 4000);
        out.released = H.chunks.size === 0;
        await settle(0, 0);
        const hit2 = E.vegetation.instanceAt({ x: b[0], z: b[2] }, { radius: 0.05 });
        let n2 = 0; for (const c of H.chunks.values()) for (const im of Object.values(c.veg)) n2 += im.count;
        out.back = { n2, stillFelled: !hit2 };
        // a code-built ground replaces the level ground: everything is placed again on the new surface
        E.setGround({ height: () => 2, slope: () => 0, type: () => 'lawn' });
        await settle(0, 0);
        const ys = []; for (const c of H.chunks.values()) for (const im of Object.values(c.veg)) { const a = im.instanceMatrix.array; for (let i = 0; i < im.count; i++) if (a[i * 16 + 15]) ys.push(a[i * 16 + 13]); }
        out.reground = { n: ys.length, at2: ys.length > 0 && ys.every(y => Math.abs(y - 2) < 1e-4), stoneSideToo: [...H.chunks.values()].some(c => c.cx >= 0 && Object.keys(c.veg).length) };
        out.stillJoined = typeof E.ground.forEachCollider === 'function';
        E.dispose();
        // with terrain installed, vegetation() options are terrain options: refused with where they live
        const T = createEngine({ canvas: document.createElement('canvas'), headless: true, loading: false, urlState: false, saveKey: 'veg-ground-t' });
        T.use(threedogTerrain.terrain({ viewChunks: 1 }));
        try { T.use(vegetation({ density: 2 })); out.refused = 'no throw'; } catch (err) { out.refused = err.message; }
        T.dispose();
        return out;
      });
      check('[guard] no terrain: plants grow on the level floor of the named ground type only, at its height, inside the area',
        !r.terrain && r.n > 20 && r.onLawn && r.atFloor, JSON.stringify(r));
      check('[guard] one InstancedMesh per species per chunk (instancing kept)', r.instanced && r.perChunkMeshes && r.meshes > 0, JSON.stringify(r));
      check('[guard] collision sees the plants through the ground collider API (blocked on a bush, free on bare stone)', r.blocked === true && r.freeOnStone === true, JSON.stringify(r));
      check('felling a plant clears its spot and it is saved', r.felled === true && r.saved, JSON.stringify(r));
      check('[guard] chunks stream: released far away, placed again on return with the same plants, the felled one still gone',
        r.released && r.back.n2 === r.n && r.back.stillFelled, JSON.stringify(r));
      check('[guard] a new ground provider (setGround) re-places every chunk on the new surface, colliders still joined',
        r.reground.at2 && r.reground.stoneSideToo && r.stillJoined, JSON.stringify(r.reground));
      check('with terrain installed, vegetation() options are refused, naming terrain({ density, viewChunks })', /terrain\(\{ density, viewChunks \}\)/.test(r.refused || ''), r.refused);
    },
  },
  {
    name: 'vegetation ground: the settings page drives vegetation density and view distance without terrain',
    url: '/tests/terrain-edit/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, vegetation, level, settings, THREE } = threedogTerrain;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, loading: false, urlState: false, saveKey: 'veg-ground-settings' });
        const root = new THREE.Group();
        const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2)); m.name = 'ground'; root.add(m);
        E.use(level({ scene: root }), vegetation({ chunkSize: 16, viewChunks: 2 }), settings());
        await E.start();
        const H = E.vegetation.host, out = { terrain: !!E.terrain, v0: E.settings.get('viewChunks'), d0: E.settings.get('density') };
        E.settings.set('density', 0.5); E.settings.set('viewChunks', 4);
        out.host = { density: H.density, view: H.viewChunks };
        E.dispose();
        return out;
      });
      check('settings read the vegetation chunks without terrain', !r.terrain && r.v0 === 2 && r.d0 === 1, JSON.stringify(r));
      check('density and view distance reach the vegetation chunks', r.host.density === 0.5 && r.host.view === 4, JSON.stringify(r));
    },
  },
  {
    name: 'vegetation ground: rigid bodies collide with plants scattered on a level (cylinders from ground.forEachCollider), and let go when felled',
    url: '/tests/terrain-edit/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, vegetation, level, rigid, collision, THREE } = threedogTerrain;
        const wait = () => new Promise(res => setTimeout(res, 5));
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, loading: false, urlState: false, saveKey: 'veg-ground-rigid' });
        const root = new THREE.Group();
        const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2)); m.name = 'ground_lawn'; m.userData.groundType = 'lawn'; root.add(m);
        E.use(level({ scene: root }), vegetation({ chunkSize: 16, viewChunks: 2 }), collision(), rigid());
        E.vegetation.add('bush', { geometry: new THREE.ConeGeometry(0.5, 1, 5), rule: { perChunk: 30, maxSlope: 1, sink: 0, collider: 0.4 } });
        await E.start();
        for (let i = 0; i < 300 && !E.vegetation.host.isReadyAround({ x: 0, z: 0 }); i++) { E.step(1 / 60); await wait(); }
        E.step(2.2);
        const out = { circles: 0, colliders: E.rigid.groundTrees.size };
        E.ground.forEachCollider(0, 0, 20, () => out.circles++);
        const first = [...E.rigid.groundTrees.keys()][0]?.split(',').map(Number);
        if (first) { const hit = E.vegetation.instanceAt({ x: first[0], z: first[1] }, { radius: 0.5 }); if (hit) E.vegetation.removeInstance(hit.species, hit.cx, hit.cz, hit.id); }
        E.step(1);
        out.after = E.rigid.groundTrees.size;
        E.dispose();
        return out;
      });
      check('rigid() builds a cylinder for the plant circles around the physics source', r.colliders > 10 && r.colliders >= r.circles, JSON.stringify(r));
      check('a felled plant loses its rigid collider', r.after === r.colliders - 1 || r.after < r.colliders, JSON.stringify(r));
    },
  },
  {
    name: 'vegetation fade: near-only species shrink out by distance (default band from maxRing, fade:false = hard edge), centred on the focus, shader compiles',
    url: '/tests/terrain-edit/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, vegetation, level, THREE } = threedogTerrain;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, loading: false, urlState: false, saveKey: 'veg-fade' });
        const root = new THREE.Group(), m = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2)); m.name = 'ground_lawn'; m.userData.groundType = 'lawn'; root.add(m);
        E.use(level({ scene: root }), vegetation({ chunkSize: 16, viewChunks: 2 }));
        const g = () => new THREE.ConeGeometry(0.1, 1, 4), rule = { perChunk: 5 };
        const tuft = E.vegetation.add('tuft', { geometry: g(), nearOnly: true, maxRing: 2, wind: 0.2, rule });
        const hard = E.vegetation.add('hard', { geometry: g(), nearOnly: true, fade: false, rule });
        const set = E.vegetation.add('set', { geometry: g(), nearOnly: true, fade: { start: 5, end: 9 }, rule });
        const tree = E.vegetation.add('tree', { geometry: g(), rule });
        let bad = null; try { E.vegetation.add('bad', { geometry: g(), nearOnly: true, fade: { start: 9, end: 5 }, rule }); } catch (e) { bad = String(e.message); }
        await E.start();
        E.focus.set(12, 0, -7); E.step(0.1);
        const out = { tuft: tuft.fade, hard: hard.fade, set: set.fade, tree: tree.fade, bad, center: tuft.fadeUniforms.uNearFadeCenter.value.toArray(), hardU: hard.fadeUniforms };
        const im = new THREE.InstancedMesh(g(), tuft.material, 2); E.scene.add(im);
        E.renderer.compile(E.scene, E.camera);
        out.programsOk = E.renderer.info.programs.length > 0 && E.renderer.info.programs.every(p => p.diagnostics?.runnable !== false);
        return out;
      });
      check(r.tuft?.end === 32 && Math.abs(r.tuft.start - 20.8) < 1e-6, 'near-only default: end = maxRing x chunk (2 x 16), start 65%', JSON.stringify(r.tuft));
      check(r.hard === null && r.hardU === null && r.tree === null, 'fade:false and a non-near species keep the hard edge (no band)', JSON.stringify([r.hard, r.tree]));
      check(r.set?.start === 5 && r.set?.end === 9, 'fade: { start, end } sets the band', JSON.stringify(r.set));
      check(/start < end/.test(r.bad || ''), 'a reversed band is refused with the numbers', String(r.bad));
      check(r.center[0] === 12 && r.center[2] === -7, 'the fade centre follows the view focus each frame', JSON.stringify(r.center));
      check(r.programsOk, 'the faded wind material compiles (no shader error)');
    },
  },
];
