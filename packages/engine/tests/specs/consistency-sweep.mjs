// Guards for the consistency sweep: the dev checks run in the npm test bundle, validate is per engine, positional options throw.
// Each test builds fresh headless engines on the threads test page (no game content). Run: npm test -- "Sweep"

const PAGE = '/tests/threads/';

export const specs = [
  {
    // the event-name spelling check read raw import.meta.env.DEV, which is false in the test bundle: it never ran under npm test
    name: '[guard] Sweep: the event-name spelling check runs under npm test, and validate is per engine',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine } = threedogThreads;
        const mk = (o = {}) => createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'sw-' + Math.random(), ...o });
        const A = mk(), B = mk({ validate: false });
        const { warns } = await __t.warns(() => {
          A.events.on('sweepcheck:opened', () => {}); A.events.emit('sweepcheck:openex');
          B.events.on('sweepcheck:closed', () => {}); B.events.emit('sweepcheck:closex');
        });
        const out = { warns, a: A.validate, b: B.validate };
        A.dispose(); B.dispose();
        return out;
      });
      check('a near-miss event name warns [event-typo] in the test bundle', r.warns.some(w => /event-typo/.test(w) && /sweepcheck:open/.test(w)), JSON.stringify(r.warns));
      check('the engine created later with validate: false does not switch the first engine off; its own events are not checked',
        r.a === true && r.b === false && !r.warns.some(w => /sweepcheck:close/.test(w)), JSON.stringify(r));
    },
  },
  {
    name: '[guard] Sweep: music.stop takes an options object; the old positional stop(3) throws [module-params]',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, all: { music } } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'sw-music' });
        E.use(music());
        await E.start();
        let ok = null, old = null;
        try { E.music.stop({ fade: 0 }); ok = true; } catch (e) { ok = e.message; }
        try { E.music.stop(3); } catch (e) { old = e.code; }
        E.dispose();
        return { ok, old };
      });
      check('stop({ fade }) works and stop(3) throws module-params', r.ok === true && r.old === 'module-params', JSON.stringify(r));
    },
  },
  {
    // three.js stays writable: the engine changes no three prototype for rays, and the class changes it does make are listed and can be undone
    name: '[guard] Sweep: no Mesh.prototype.raycast change; describe().threePatches lists the class changes and off(id) undoes one',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, THREE, all } = threedogThreads;
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, urlState: false, saveKey: 'sw-patches' });
        await E.start();
        const geo = new THREE.SphereGeometry(1, 32, 32), mesh = new THREE.Mesh(geo);
        E.scene.add(mesh); E.rays.addStatic(mesh);
        const ids = E.describe().threePatches.map(p => p.id);
        const proto = THREE.Mesh.prototype.raycast.name, own = Object.hasOwn(mesh, 'raycast') && !!geo.boundsTree;
        const hit = E.raycast([0, 0, 5], [0, 0, -1])?.object === mesh;
        all.threePatches.off('shadow-accessors');
        const gone = !Object.getOwnPropertyDescriptor(THREE.Mesh.prototype, 'customDepthMaterial')?.get, listed = all.threePatches.list().find(p => p.id === 'shadow-accessors')?.on;
        E.dispose();
        return { ids, proto, own, hit, gone, listed };
      });
      check("Mesh.prototype.raycast is three's own; a registered mesh has its own BVH raycast and is still hit", r.proto !== 'acceleratedRaycast' && r.own && r.hit, JSON.stringify(r));
      check("describe().threePatches names shadow-accessors; off('shadow-accessors') removes the accessor and the list says off", r.ids.includes('shadow-accessors') && r.gone && r.listed === false, JSON.stringify(r));
    },
  },
];
