// addSegment (fence) and addBlocked (river): a walker is stopped by the fence and the water, passes through the gate / bridge, remove() frees them.
// Uses the nav test page (floor + one wall at z=0 spanning x -12..12); everything here happens at |x| >= 18 or z <= 0 away from that wall.
export const specs = [
  {
    name: 'Collision addSegment / addBlocked: stopped by fence and river, gate and bridge let through, remove() frees',
    url: '/tests/nav/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const p = engine.player, col = engine.collision;
        const walk = (x, z, dx, dz, n = 60) => { p.placeAt([x, 0, z]); for (let i = 0; i < n; i++) p.move(dx, dz, false, 0.05); return [p.position.x, p.position.z]; };
        // fence along x=-18 for z in -12..-4; z=2 is the gate (no segment there)
        const fence = col.addSegment([-18, 0, -12], [-18, 0, -4], { thickness: 0.4 });
        const beforeFence = walk(-19, -8, 1, 0), through = walk(-19, 2, 1, 0);
        fence.remove();
        const afterRemove = walk(-19, -8, 1, 0);
        // river x in 5..9 with a bridge at z in -1..1
        const river = col.addBlocked((x, z) => x > 5 && x < 9 && !(z > -1 && z < 1));
        const stopped = walk(0, -8, 1, 0), bridged = walk(0, 0, 1, 0);
        const walkable = [!col.blockedAt(7, -8, 0.3), !col.blockedAt(7, 0, 0.3)];
        river.remove();
        const freed = walk(0, -8, 1, 0);
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
];
