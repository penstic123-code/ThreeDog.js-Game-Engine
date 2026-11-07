// [review] Cross-module probes of the 1.0 whole-system review. A name starting "[review FAILING]" proves an open bug: it fails on purpose until the bug is fixed.
const PAGE = '/tests/threads/';
const J = JSON.stringify;

export const specs = [
  {
    name: '[guard] level.unload: paths stop at the level that left, on the navmesh and on A*',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine, world, collision, characters, level, nav, THREE } = threedogThreads;
        const quiet = [console.error, console.warn]; console.error = console.warn = () => {};
        const flat = (w, n) => { const s = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, w), new THREE.MeshBasicMaterial()); s.name = n; m.name = 'ground'; m.position.y = -0.1; s.add(m); return s; };
        const E = mk(createEngine, 'rv-unload');
        E.use(world(), collision(), characters(), level({ scene: flat(40, 'a') }), nav({ agentRadius: 0.4 }));
        await E.start();
        for (let i = 0; i < 20 && !E.nav.ready; i++) { await new Promise(s => setTimeout(s, 30)); E.step(1 / 60); }
        const out = { before: E.nav.findPath({ x: -10, z: 0 }, { x: 10, z: 0 })?.length ?? null, wide0: E.nav.findPath({ x: -10, z: 0 }, { x: 10, z: 0 }, { radius: 1.2 })?.length ?? null };
        E.level.unload(); E.step(1 / 60);
        out.afterReady = E.nav.ready; out.after = E.nav.findPath({ x: -10, z: 0 }, { x: 10, z: 0 })?.length ?? null;
        out.wide = E.nav.findPath({ x: -10, z: 0 }, { x: 10, z: 0 }, { radius: 1.2 })?.length ?? null;
        out.newWide = E.nav.findPath({ x: -10, z: 0 }, { x: 10, z: 0 }, { radius: 2.4 })?.length ?? null;
        out.playable = E.level.playable;
        await E.level.load(flat(10, 'b'));
        for (let i = 0; i < 5; i++) { await new Promise(s => setTimeout(s, 15)); E.step(1 / 60); }
        out.back = { small: E.nav.findPath({ x: -3, z: 0 }, { x: 3, z: 0 })?.length ?? null, wide: E.nav.findPath({ x: -3, z: 0 }, { x: 3, z: 0 }, { radius: 1.2 })?.length ?? null, sizes: E.nav.meshes.size };
        E.dispose();
        [console.error, console.warn] = quiet;
        return out;
      });
      check('there was a path first', r.before > 1 && r.wide0 > 1, J(r));
      check('no level: no path on the mesh of agentRadius', !r.after, J(r));
      check('no level: no path for a body size kept from before', !r.wide, J(r));
      check('engine.nav.ready is false with no level', r.afterReady === false, J(r));
      check('level.playable is false with no level', r.playable === false, J(r));
      check('a new level: every size is cut from it', r.back.small > 1 && r.back.wide > 1, J(r));
    },
  },
  {
    name: '[guard] Template bodies: rigid replaced, or a pack reload that changes the body, reach the built copies',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine, world, collision, level, THREE, all: T } = threedogThreads;
        const quiet = [console.error, console.warn]; const said = []; console.error = console.warn = m => said.push(String(m).slice(0, 160));
        const flat = () => { const s = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40), new THREE.MeshBasicMaterial()); m.name = 'ground'; m.position.y = -0.1; s.add(m); return s; };
        const E = mk(createEngine, 'rv-body');
        E.assets.manifest({ name: 'rv-b', models: { rvCrate: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)) } });
        E.use(world(), collision(), T.content(), level({ scene: flat() }), T.rigid());
        await E.start();
        const pack = mass => ({ templates: { rvCrate: { model: 'rvCrate', body: { shape: 'box', mass } } }, props: [{ id: 'rv-c1', template: 'rvCrate', x: 2, z: 2 }] });
        const settle = async n => { for (let i = 0; i < n; i++) { await E.loading.settled(); await new Promise(s => setTimeout(s, 10)); E.step(1 / 60); } };
        const out = {};
        const bodies = () => E.rigid.bodies.filter(b => b.mesh).length;
        const colliders = () => E.rigid.world.colliders.len();
        out.keys = Object.keys(E.rigid.bodies[0] ?? {});
        try { E.content.load(pack(2)); await settle(8); } catch (x) { out.loadErr = x.message; }
        out.keys = Object.keys(E.rigid.bodies[0] ?? {});
        out.first = { bodies: bodies(), colliders: colliders() };
        try { E.content.load(pack(9)); await settle(8); } catch (x) { out.reloadErr = x.message; }
        out.reload = { bodies: bodies(), colliders: colliders(), masses: E.rigid.bodies.filter(b => b.mesh).map(b => +(b.body?.mass?.() ?? b.rb?.mass?.() ?? -1).toFixed(2)) };
        try { E.use(T.rigid(), { replaces: 'rigid' }); await settle(10); } catch (x) { out.swapErr = x.message; }
        out.swap = { bodies: bodies(), colliders: colliders() };
        // the copy's own teardown after the swap: dispose must not throw
        try { E.ops.allow(() => E.world.remove('rv-c1')); await settle(3); out.removed = bodies(); } catch (x) { out.removeErr = x.message; }
        out.said = said.slice(0, 4); out.err = E.error?.message ?? null;
        E.dispose();
        [console.error, console.warn] = quiet;
        return out;
      });
      check('the pack built one body', r.first?.bodies === 1, J(r));
      check('a reload keeps one body', r.reload?.bodies === 1, J(r));
      check('a reload with a new mass reaches the body', r.reload?.masses?.[0] === 9, J(r));
      check('a rigid replaced: the crate has a body in the new module', r.swap?.bodies === 1, J(r));
      check('no error on the way', !r.swapErr && !r.removeErr && !r.err, J(r));
    },
  },
  {
    name: '[guard] Collision replaced while frozen or skipping: the level walls stand in the new module before the next fixed step',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine, world, collision, level, THREE } = threedogThreads;
        const s = new THREE.Group(), g = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40), new THREE.MeshBasicMaterial()), w = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), new THREE.MeshBasicMaterial());
        g.name = 'ground'; w.name = 'col_wall'; w.position.set(5, 1.5, 0); s.add(g, w);
        const E = mk(createEngine, 'rv-frz');
        E.use(world(), collision(), level({ scene: s }));
        await E.start(); E.step(1 / 60);
        const out = { first: !E.collision.walkable({ x: 5, z: 0 }) };
        const fz = E.freeze('rv');
        E.use(collision(), { replaces: 'collision' });
        E.step(1 / 60);
        out.frozen = !E.collision.walkable({ x: 5, z: 0 });
        fz.remove(); E.step(1 / 60);
        out.after = !E.collision.walkable({ x: 5, z: 0 });
        E.use(collision(), { replaces: 'collision' });
        await E.skip({ seconds: 60 });
        out.skip = !E.collision.walkable({ x: 5, z: 0 });
        E.dispose();
        return out;
      });
      check('the wall stands at first', r.first, J(r));
      check('frozen (a menu is open): the wall stands in the new module', r.frozen, J(r));
      check('after a skip: the wall stands in the new module', r.skip, J(r));
      check('after the freeze it stands', r.after, J(r));
    },
  },
];
