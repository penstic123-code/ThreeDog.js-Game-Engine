// character.walkTo (modules/characters/walkTo.js) and new Character(engine, { rig }). Page: tests/nav (maze: wall across z = 0, gaps beyond x = +-12).
export const specs = [
  {
    name: 'walkTo: a hand-built Character with its own rig walks around the wall and arrives; a blocked target reports noPath; remove() cancels',
    url: '/tests/nav/index.html',
    async run({ check, ev }) {
      await ev(() => __t.until(() => engine.nav.ready, 10000).catch(() => {}));
      const r = await ev(async () => {
        const Character = window.Character, T = __threedogThree;
        engine.haltLoop();
        const body = new T.Group(); body.add(new T.Mesh(new T.BoxGeometry(0.5, 1, 0.5), new T.MeshBasicMaterial()));
        const guard = new Character(engine, { rig: { root: body } }); engine.add(guard.root);
        guard.placeAt({ x: -4, z: -6 });
        const out = { ownRig: guard._rig.root === body && body.parent === guard.root };
        let minX = 99;
        const drive = async (h, n) => {   // fixed steps until the walk settles (the engine is paused, so nothing else steps)
          let st = null; h.then(x => { st = x.status; });
          for (let i = 0; i < n && !st; i++) { engine.step(1 / 60, { render: false, describe: false }); await Promise.resolve(); minX = Math.min(minX, guard.position.x); }
          return st;
        };
        out.status = await drive(guard.walkTo({ x: -4, z: 6 }, { arrive: 0.6 }), 1500);
        out.end = [guard.position.x, guard.position.z]; out.detourX = minX;
        // a target far off the floor: nothing to walk to
        out.blocked = await drive(guard.walkTo({ x: 300, z: 300 }), 30);
        // cancel mid-walk
        const h2 = guard.walkTo({ x: 16, z: -10 }); engine.step(1 / 60, { render: false, describe: false }); h2.remove();
        out.cancelled = (await h2).status;
        return out;
      });
      check('the rig passed in is the body', r.ownRig, JSON.stringify(r));
      check('arrived near the goal after detouring around the wall', r.status === 'arrived' && Math.hypot(r.end[0] + 4, r.end[1] - 6) < 1 && r.detourX < -11, JSON.stringify(r));
      check('target inside a wall: status noPath', r.blocked === 'noPath', JSON.stringify(r));
      check('remove() resolves cancelled', r.cancelled === 'cancelled', JSON.stringify(r));
    },
  },
  {
    name: '[guard] walkTo: a path of many long legs arrives without a replan: passing a point is progress, not a stuck clock',
    url: '/tests/nav/index.html',
    async run({ check, ev }) {
      await ev(() => __t.until(() => engine.nav.ready, 10000).catch(() => {}));
      const r = await ev(async () => {
        engine.haltLoop();
        const Character = window.Character, T = __threedogThree, C = engine.characters;
        const body = new T.Group(); body.add(new T.Mesh(new T.BoxGeometry(0.5, 1, 0.5), new T.MeshBasicMaterial()));
        const guard = new Character(engine, { rig: { root: body } }); engine.add(guard.root);
        guard.placeAt({ x: -10, z: -9 });
        const legs = [[-10, -9], [-2, -9], [-2, -2], [-10, -2], [-10, -9], [-2, -9], [-2, -2], [-9, -3]].map(([x, z]) => ({ x, z }));   // round a square: no point is skipped as closer
        const real = C.findPath; let asked = 0;
        C.findPath = () => { asked++; return legs.map(p => ({ ...p })); };   // six corners, every leg longer than the 1.5 s stuck window
        let st = null; guard.walkTo(legs[7]).then(x => { st = x.status; });
        for (let i = 0; i < 2400 && !st; i++) { engine.step(1 / 60, { render: false, describe: false }); await Promise.resolve(); }
        C.findPath = real;
        return { st, asked };
      });
      check('arrived on the first plan', r.st === 'arrived' && r.asked === 1, JSON.stringify(r));
    },
  },
];
