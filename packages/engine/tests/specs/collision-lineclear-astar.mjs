// collision.lineClear (3D sight line vs box / circle heights) and the A* fixes: smoothing does not step over a thin fence, the path starts at the real position.
// Uses the nav test page; everything happens at z in -16..-8 (away from its wall at z=0) and is removed at the end.
export const specs = [
  {
    name: 'Collision lineClear heights + A* smoothing respects thin fence and real start',
    url: '/tests/nav/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop(); engine.nav?.dispose();   // force the A* fallback
        const col = engine.collision, hs = [];
        hs.push(col.addBox([0, 0, -10], { halfWidth: 4, halfDepth: 0.1, height: 1, y: 0 }));   // 1 m high thin wall along x
        hs.push(col.addCircle([15, 0, -10], { radius: 0.5, height: 3 }));
        const low = col.lineClear([0, 0.2, -12], [0, 0.2, -8]);       // through the wall near the ground: blocked
        const high = col.lineClear([0, 3, -12], [0, 3, -8]);          // 3 m above the wall: clear
        const slope = col.lineClear([0, 1.5, -12], [0, 0.2, -8]);       // descending into the wall: blocked
        const around = col.lineClear([6, 0.2, -12], [6, 0.2, -8]);    // beyond the wall's end: clear
        const fat = col.lineClear([4.3, 0.2, -12], [4.3, 0.2, -8], { radius: 0.5 });   // 0.3 m from the end: a fat line is blocked
        const pillarLow = col.lineClear([13, 1, -10], [17, 1, -10]), pillarHigh = col.lineClear([13, 4, -10], [17, 4, -10]);
        // A*: start off the cell centre; a fence between start and goal must survive smoothing
        hs.push(col.addSegment([-3, 0, -15], [3, 0, -15], { thickness: 0.2 }));
        const path = engine.characters.findPath([0.37, 0, -16.4], [0.2, 0, -13.5], { radius: 0.4 });
        const startOk = !!path && Math.abs(path[0].x - 0.37) < 1e-6 && Math.abs(path[0].z + 16.4) < 1e-6;
        const straight = !!path && path.length === 2;
        // a target inside a wall is unreachable (noPath), and no leg of a route clips a wall corner (checked every 5 cm)
        hs.push(col.addBox([10, 0, -12], { halfWidth: 2, halfDepth: 2, height: 2, y: 0 }));
        const inWall = engine.characters.findPath([6, 0, -12], [10, 0, -12], { radius: 0.4, detailed: true });
        const around2 = engine.characters.findPath([7.3, 0, -9.1], [12.7, 0, -14.9], { radius: 0.4 });
        let clip = 0;
        for (let i = 0; around2 && i + 1 < around2.length; i++) { const a = around2[i], b = around2[i + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.05); for (let k = 0; k <= n; k++) if (!col.walkableAt(a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n, 0.4)) clip++; }
        hs.forEach(h => h.remove());
        return { inWall: String(inWall.path), routed: !!around2, clip, low, high, slope, around, fat, pillarLow, pillarHigh, startOk, straight, path };
      });
      check('low sight line through 1 m wall is blocked', r.low === false);
      check('sight line 3 m above the wall is clear', r.high === true);
      check('descending line into the wall is blocked', r.slope === false);
      check('line beside the wall end is clear', r.around === true);
      check('fat line near the wall end is blocked', r.fat === false);
      check('circle blocks at 1 m, not at 4 m', r.pillarLow === false && r.pillarHigh === true);
      check('A* path starts at the real position', r.startOk === true, JSON.stringify(r.path));
      check('A* did not smooth straight through the fence', r.straight === false, JSON.stringify(r.path));
      check('a target inside a wall is noPath', r.inWall === "null", r.inWall);
      check('a route around a box has no leg inside a wall', r.routed && r.clip === 0, 'samples in wall: ' + r.clip);
    },
  },
];
