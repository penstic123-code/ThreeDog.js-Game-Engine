// addSegment (fence) and addBlocked (river): a walker is stopped by the fence and the water, passes through the gate / bridge, remove() frees them.
// Uses the nav test page (floor + one wall at z=0 spanning x -12..12); everything here happens at |x| >= 18 or z <= 0 away from that wall.
export const specs = [
  {
    name: 'Collision addSegment / addBlocked: stopped by fence and river, gate and bridge let through, remove() frees',
    url: '/tests/nav/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        const p = engine.player, col = engine.collision;
        const h = engine.control.take(p, { owner: 'test', layer: 'script' });   // the test drives the player (its keys pause): core/ops/control.js
        const walk = (x, z, dx, dz, n = 60) => { p.placeAt([x, 0, z]); for (let i = 0; i < n; i++) h.move(dx, dz, false, 0.05); return [p.position.x, p.position.z]; };
        // fence along x=-18 for z in -12..-4; z=2 is the gate (no segment there)
        const fence = col.addSegment([-18, 0, -12], [-18, 0, -4], { thickness: 0.4 });
        const beforeFence = walk(-19, -8, 1, 0), through = walk(-19, 2, 1, 0);
        fence.remove();
        const afterRemove = walk(-19, -8, 1, 0);
        // river x in 5..9 with a bridge at z in -9..-7, clear of the wall
        const river = col.addBlocked((x, z) => x > 5 && x < 9 && !(z > -9 && z < -7));
        const stopped = walk(0, -4, 1, 0), bridged = walk(0, -8, 1, 0);
        const walkable = [!col.blockedAt(7, -4, 0.3), !col.blockedAt(7, -8, 0.3)];
        river.remove();
        const freed = walk(0, -4, 1, 0);
        h.remove();
        return { beforeFence, through, afterRemove, stopped, bridged, walkable, freed };
      });
      check('fence stops walker (x < -18)', r.beforeFence[0] < -18, JSON.stringify(r.beforeFence));
      check('gate lets walker through', r.through[0] > -17, JSON.stringify(r.through));
      check('after remove() fence no longer blocks', r.afterRemove[0] > -17, JSON.stringify(r.afterRemove));
      check('river stops walker before x=5', r.stopped[0] < 5, JSON.stringify(r.stopped));
      check('bridge lets walker cross', r.bridged[0] > 9, JSON.stringify(r.bridged));
      check('walkableAt reports water blocked, bridge open', r.walkable[0] === false && r.walkable[1] === true, JSON.stringify(r.walkable));
      check('after remove() river no longer blocks', r.freed[0] > 9, JSON.stringify(r.freed));
    },
  },
  {
    name: '[guard] collision: standing at the exact centre of a circle or box is pushed out the same way every time (+x); nav lands a given height on a floor',
    url: '/tests/nav/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        const col = engine.collision, out = {}, hc = col.addCircle([-30, 0, 30], { radius: 1 }), hb = col.addBox([-40, 0, 30], { halfWidth: 2, halfDepth: 1 });
        for (const [k, x] of [['circle', -30], ['box', -40]]) {
          const runs = [0, 1].map(() => { const p = { x, y: 0, z: 30 }; const hit = col.resolve(p, 0.3); return [hit, p.x, p.z]; });
          out[k] = runs;
        }
        hc.remove(); hb.remove();
        const roof = engine.surface, ground = engine.nav.point([3, undefined, 4]);
        out.kept = engine.nav.point([1, 7.5, 2]).y; out.ground = ground.y === engine.surface(3, 4);
        out.asyncKept = engine.nav.point({ x: 1, y: -2, z: 2 }).y;
        return out;
      });
      for (const k of ['circle', 'box']) {
        const [a, b] = r[k];
        check(k + ' centre: pushed out of the shape', a[0] === true && Math.hypot(a[1] - (k === 'circle' ? -30 : -40), a[2] - 30) > 0.5, JSON.stringify(a));
        check(k + ' centre: same exit every time', a[1] === b[1] && a[2] === b[2], JSON.stringify(r[k]));
      }
      check('nav.point lands a height on the nearest surface, also a negative one; without a height the ground answers', Math.abs(r.kept) < 0.5 && Math.abs(r.asyncKept) < 0.5 && r.ground, JSON.stringify(r));
    },
  },
];
