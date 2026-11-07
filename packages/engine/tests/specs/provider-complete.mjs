// [guard] A swap is finished when queries can trust it: what feeds a provider has fed it before engine.use returns. And a hold ends only through the handle that took it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PAGE = '/tests/threads/';
const levelIndex = readFileSync(fileURLToPath(new URL('../../modules/level/index.js', import.meta.url)), 'utf8');

export const specs = [
  {
    name: '[guard] Provider complete: the line after a replaces sees the level walls; a feeder that fails rolls the swap back and is not counted as done',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, createEngine, level, collision, world, THREE } = threedogThreads, out = {};
        const quiet = [console.error, console.warn];
        console.error = console.warn = () => {};
        const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial();
        const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40), mat), wall = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), mat);
        floor.name = 'ground'; wall.name = 'col_wall'; wall.position.set(5, 2, 0);
        g.add(floor, wall);
        const E = mk(createEngine, 'pcomplete');
        E.use(collision(), level({ scene: g }), world());
        await E.start();
        E.step(0.1);
        const wallUp = () => !E.collision.walkable({ x: 5, z: 0 });
        out.before = wallUp();
        E.use(collision(), { replaces: 'collision' });
        out.nextLine = wallUp();
        const boxes = () => E.modules.get('collision').describe(E).boxes;
        out.once = boxes();
        // frozen, with no step between: one that comes late is complete at once too
        E.freeze('pc');
        E.unuse('collision');
        E.use(collision());
        out.late = wallUp();
        // a provider that cannot take the walls fails its install: the old one comes back, walls and all
        const bad = collision();
        const inner = bad.install;
        bad.install = (e, ctx) => { const api = inner.call(bad, e, ctx); api.addBox = () => { throw new Error('no boxes here'); }; return api; };
        try { E.use(bad, { replaces: 'collision' }); } catch (err) { out.threw = err.message; }
        out.rolledBack = wallUp() && boxes() === out.once;
        [console.error, console.warn] = quiet;
        return out;
      });
      check('the wall stood before', r.before);
      check('the line after a replaces sees it, with no step between', r.nextLine);
      check('a collision module that comes late while frozen sees it too', r.late);
      check('a provider that refuses the walls fails its use(), naming why', /no boxes here/.test(r.threw ?? ''), r.threw);
      check('after that failure the old one stands with the walls once', r.rolledBack, JSON.stringify(r));
      check('level has no hook that re-feeds walls: the module plan does (no fixed / frame / skip)', !/^\s*(fixed|frame|skip)\(\) \{ addColliders/m.test(levelIndex));
    },
  },
  {
    name: '[guard] Provider complete: an old halt handle leaves a later hold standing',
    url: '/?threedog-headless',
    async run({ check, ev }) {
      const r = await ev(() => {
        const old = engine.haltLoop('pc-halt');
        old.remove();
        const now = engine.haltLoop('pc-halt');
        old.remove();
        const held = engine.halted && engine.stacks.get('halt').has('pc-halt');
        now.remove();
        // the same class, by view name
        engine.views.define('pc-view', { position: [0, 5, 5] });
        const first = engine.views.show('pc-view');
        first.remove();
        const second = engine.views.show('pc-view');
        first.remove();
        const shown = engine.views.current === 'pc-view';
        second.remove();
        return { held, free: !engine.stacks.get('halt').has('pc-halt'), shown, gone: engine.views.current === null };
      });
      check('an old handle does not end the later hold of the same name', r.held);
      check('the later handle ends it', r.free);
      check('an old view handle leaves a later show of that view up', r.shown);
      check('the later view handle ends it', r.gone);
    },
  },
];
