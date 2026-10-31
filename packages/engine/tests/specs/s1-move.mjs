// Stage 1.12, unified "can walk there" parameters: engine.movement is defined in one place and collision / navigation / physics read the same copy; narrow doors give no route; after building a wall, collision and navigation update together.
// Navigation tests use /tests/nav/index.html (collision + level + nav installed); the level is built in code and registered in assets.manifest.
export const specs = [
  {
    name: 'S1 movement params: no route when the door is narrower than the capsule diameter, a route through a wide door',
    url: '/tests/nav/index.html',
    async run({ check, ev }) {
      await ev(() => __t.until(() => engine.nav.ready, 10000).catch(() => {}));   // the page's own navmesh first
      const r = await ev(async () => {
        engine.pause();
        const T = engine.THREE;
        // a wall at x=0 splits the 40x40 ground in two, with a door in the middle: gap is the door width
        const make = gap => () => {
          const g = new T.Group(), floor = new T.Mesh(new T.BoxGeometry(40, 1, 40), new T.MeshBasicMaterial());
          floor.name = 'ground'; floor.position.y = -0.5; g.add(floor);
          const len = 20 - gap / 2;
          for (const s of [-1, 1]) {
            const w = new T.Mesh(new T.BoxGeometry(1, 3, len), new T.MeshBasicMaterial());
            w.name = 'col_wall' + s; w.position.set(0, 1.5, s * (gap / 2 + len / 2)); g.add(w);
          }
          return g;
        };
        engine.assets.manifest({ models: { 's1m-narrow': make(0.6), 's1m-wide': make(2.0) } });
        const result = {};
        for (const [key, name] of [['narrow', 's1m-narrow'], ['wide', 's1m-wide']]) {
          await engine.level.load(name);
          for (let i = 0; i < 100 && !engine.nav.ready; i++) await new Promise(res => setTimeout(res, 50));   // measure: wait for Recast to generate
          engine.step(0.1);
          result[key] = engine.characters.findPath({ x: -8, z: 0 }, { x: 8, z: 0 }, { detailed: true });
        }
        return result;
      });
      check('Door 0.6 < capsule diameter 0.8: status is noPath, path is null', r.narrow.status === 'noPath' && r.narrow.path === null, JSON.stringify(r.narrow));
      check('Door 2.0: status ok, route has several points', r.wide.status === 'ok' && r.wide.path.length >= 2, JSON.stringify(r.wide));
    },
  },
  {
    name: 'S1 movement params: after building a wall, collision and navigation update together; pathfinding distinguishes not-ready',
    url: '/tests/nav/index.html',
    async run({ check, ev }) {
      await ev(() => __t.until(() => engine.nav.ready, 10000).catch(() => {}));   // the page's own navmesh first
      const r = await ev(async () => {
        engine.pause();
        const T = engine.THREE;
        engine.assets.manifest({ models: { 's1m-open': () => {
          const g = new T.Group(), floor = new T.Mesh(new T.BoxGeometry(40, 1, 40), new T.MeshBasicMaterial());
          floor.name = 'ground'; floor.position.y = -0.5; g.add(floor); return g;
        } } });
        await engine.level.load('s1m-open');
        for (let i = 0; i < 100 && !engine.nav.ready; i++) await new Promise(res => setTimeout(res, 50));   // measure
        engine.step(0.1);
        const from = { x: -8, z: 0 }, to = { x: 8, z: 0 };
        const before = engine.characters.findPath(from, to, { detailed: true });
        // place a sealed wall (x=0, z -20 to 20): both collision and navigation must honor it
        const wall = engine.collision.addBox({ x: 0, z: 0 }, { halfWidth: 0.5, halfDepth: 20, height: 3 });
        engine.step(0.1);
        const pushed = engine.collision.resolve({ x: -0.3, y: 0, z: 0 }, engine.movement.radius);
        const blocked = engine.characters.findPath(from, to, { detailed: true });
        wall.remove(); engine.step(0.1);
        const reopened = engine.characters.findPath(from, to, { detailed: true });
        // after nav is unloaded: nav installed but not ready -> notReady
        engine.nav.dispose();
        const notReady = engine.characters.findPath(from, to, { detailed: true });
        return { before, pushed, blocked, reopened, notReady, plain: engine.characters.findPath(from, to) };
      });
      check('Route exists before the wall', r.before.status === 'ok', JSON.stringify(r.before));
      check('After the wall, light collision pushes the character out', r.pushed === true);
      check('After the wall, navigation no longer passes through: noPath', r.blocked.status === 'noPath' && r.blocked.path === null, JSON.stringify(r.blocked));
      check('Navigation recovers after the wall is removed', r.reopened.status === 'ok', JSON.stringify(r.reopened));
      check('After nav unload, detailed returns notReady; without detailed it is still a path array or null (compatible)', r.notReady.status === 'notReady' && (r.plain === null || Array.isArray(r.plain)), JSON.stringify({ n: r.notReady.status, plain: r.plain }));
    },
  },
  {
    name: 'S1 movement params: changing engine.movement radius, collision / navigation / character read the same value',
    url: '/tests/nav/index.html?radius=0.6',
    async run({ check, ev }) {
      await ev(() => __t.until(() => engine.nav.ready, 10000).catch(() => {}));   // the page's own navmesh first
      const r = await ev(async () => {
        for (let i = 0; i < 100 && !engine.nav.ready; i++) await new Promise(res => setTimeout(res, 50));   // measure
        const m = engine.movement;
        // col_wall is a wall at z in [-0.5, 0.5], x in [-12, 12]: z=0.9 is 0.4 from the wall face, so radius 0.6 cannot stand there but radius 0.4 just fits
        return { m: { radius: m.radius, height: m.height, step: m.stepHeight }, player: engine.player.radius, step: engine.player.stepHeight,
          nav: engine.nav.agent, frozen: Object.isFrozen(m), w: engine.collision.walkable({ x: 0, z: 0.9 }), w4: engine.collision.walkable({ x: 0, z: 0.9 }, { radius: 0.4 }) };
      });
      check('engine.movement.radius is the page parameter 0.6', r.m.radius === 0.6, JSON.stringify(r.m));
      check('Player radius and step height read engine.movement', r.player === 0.6 && r.step === r.m.step, JSON.stringify(r));
      check('Nav agent radius / height / step read engine.movement', r.nav.radius === 0.6 && r.nav.height === r.m.height && r.nav.maxClimb === r.m.step, JSON.stringify(r.nav));
      check('Light collision walkable default radius is 0.6 (0.4 from the wall is not standable, explicit 0.4 is)', r.w === false && r.w4 === true, JSON.stringify(r));
      check('engine.movement is read-only', r.frozen);
    },
  },
  {
    name: 'S1 movement params: Rapier capsule follows engine.movement (open world)',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => ({ cap: engine.rigid?.playerCapsule, m: engine.movement }));
      const total = r.cap && 2 * r.cap.halfHeight + 2 * r.cap.radius;
      check('Capsule radius = movement.radius, total height = movement.height', r.cap && r.cap.radius === r.m.radius && Math.abs(total - r.m.height) < 1e-6, JSON.stringify(r));
    },
  },
];
