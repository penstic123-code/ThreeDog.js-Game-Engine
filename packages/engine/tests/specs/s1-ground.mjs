// Stage 1.8 multi-layer ground queries: the same (x, z) gives different heights on and under a bridge.
export const specs = [
  {
    name: 'S1 multi-layer ground: the same (x, z) gives different heights on and under a bridge (city)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const T = engine.THREE;
        // level built in code: ground + a bridge deck 3 m above it (only names containing ground / road are treated as walkable by level)
        engine.assets.manifest({ models: { 's1-bridge': () => {
          const g = new T.Group();
          const floor = new T.Mesh(new T.BoxGeometry(40, 1, 40), new T.MeshBasicMaterial());
          floor.name = 'ground'; floor.position.y = -0.5; g.add(floor);
          const bridge = new T.Mesh(new T.BoxGeometry(6, 0.4, 6), new T.MeshBasicMaterial());
          bridge.name = 'road_bridge'; bridge.position.set(0, 2.8, 0); g.add(bridge);   // the deck top is at 3.0
          return g;
        } } });
        await engine.level.load('s1-bridge');
        const a = engine.surface(0, 0, 0), b = engine.surface(0, 0, 3.2), c = engine.surface(0, 0), side = engine.surface(10, 0, 3.2);
        const lo = new T.Object3D(); lo.position.set(0, 0.1, 0); engine.snapToGround(lo);
        const hi = new T.Object3D(); hi.position.set(0, 3.1, 0); engine.snapToGround(hi);
        return { a, b, c, side, lo: lo.position.y, hi: hi.position.y };
      });
      const near = (v, t) => Math.abs(v - t) < 0.05;
      check('under the bridge surface(x,z,0) is the ground', near(r.a, 0), JSON.stringify(r));
      check('on the bridge surface(x,z,3.2) is the deck', near(r.b, 3), JSON.stringify(r));
      check('without refY the highest layer is used', near(r.c, 3), JSON.stringify(r));
      check('beside the bridge there is one layer, refY makes no difference', near(r.side, 0), JSON.stringify(r));
      check('snapToGround: y=0.1 lands on the ground, y=3.1 lands on the deck', near(r.lo, 0) && near(r.hi, 3), JSON.stringify(r));
    },
  },
];
