// Rigid trunk cylinders only near the player and moving bodies (rigid({ treeRadius })): few resident colliders, bodies still stop at trunks everywhere,
// cylinders leave with distance and come back, and the creation budget is a count per fixed step (never wall-clock). Same format as the other files here; open world page.
export const specs = [
  {
    // A racing rival went enabled: false 80 m from the player, mid race, without a word; the freeze stays, the silence does not
    name: '[guard] rigid: a moving body that leaves the terrain colliders freezes and says so once, naming the body and terrainRing',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const R = engine.rigid, P = engine.player, T = __threedogThree, CH = engine.ground.chunkSize ?? 64, warns = [], w0 = console.warn;
        for (let i = 0; i < 600 && (R._srcPending || !R.terrain.size); i++) { engine.step(1 / 30); await new Promise(res => setTimeout(res, 0)); }
        console.warn = (...a) => { warns.push(a.join(' ')); };
        const ball = id => R.addBall(new T.Mesh(new T.SphereGeometry(0.3, 8, 6), new T.MeshBasicMaterial()), { radius: 0.3, id });
        const far = (R.terrainRing + 3) * CH, a = ball('rival'), b = ball('rival2');
        for (const [e, dz] of [[a, 0], [b, 4]]) { R.setPosition(e, [P.position.x + far, 40, P.position.z + dz]); e.body.setLinvel({ x: 5, y: 0, z: 0 }, true); }
        engine.step(1 / 60, { render: false });
        console.warn = w0;
        return { enabled: [a.enabled, b.enabled], frozen: engine.describe().rigid.frozen, warns: warns.filter(w => w.includes('froze')) };
      });
      check('the body is frozen, and describe counts it', r.enabled[0] === false && r.frozen >= 2, JSON.stringify(r));
      check('one warning, naming the body and terrainRing', r.warns.length === 1 && /'rival2?'/.test(r.warns[0]) && r.warns[0].includes('terrainRing'), JSON.stringify(r));
    },
  },
  {
    name: 'rigid trees: cylinders only for chunks near the player (budgeted by count); a body thrown at a trunk stops, also after a teleport into a far chunk; they leave and come back',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const pump = async (cond, max = 900) => { for (let i = 0; i < max && !cond(); i++) { engine.step(1 / 30); await new Promise(res => setTimeout(res, 0)); } return cond(); };
        engine.haltLoop();
        const R = engine.rigid, P = engine.player, G = engine.ground, CH = G.chunkSize ?? 64, T = __threedogThree, home = P.position.clone(), out = {};
        const chunkOf = (x, z) => Math.floor(x / CH) + ',' + Math.floor(z / CH);
        const trunkCount = () => { let n = 0; for (const t of R.trees.values()) n += t.colliders.length; return n; };
        // the 9 terrain chunks around the player and the trunks in them (what every one of them used to hold as a cylinder)
        const pcx = Math.floor(home.x / CH), pcz = Math.floor(home.z / CH), ring = [];
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const d = G.chunkCollision(pcx + dx, pcz + dz); if (!d) continue;
          for (const k of d.circles) for (let i = 0; i < k.length; i += 3) ring.push({ x: k[i], z: k[i + 1], r: k[i + 2], key: (pcx + dx) + ',' + (pcz + dz) });
        }
        await pump(() => R.terrain.size >= 9 && [...R.terrain.values()].every(t => t.ready) && !R._srcPending, 600);
        out.ringTrunks = ring.length; out.resident = trunkCount(); out.chunks = R.trees.size; out.colliders = R.stats.colliders;
        out.nearOnly = [...R.trees.keys()].every(key => { const [cx, cz] = key.split(',').map(Number); return Math.max(cx * CH - home.x, home.x - (cx + 1) * CH, 0, cz * CH - home.z, home.z - (cz + 1) * CH) <= R.treeRadius; });
        // throw a ball at a trunk: a near one, and one in a ring chunk far from the player (its cylinders were not there before the body was)
        const d2 = t => Math.max(Math.abs(t.x - home.x), Math.abs(t.z - home.z));
        const throwAt = async (tree, label) => {
          const ball = R.addBall(new T.Mesh(new T.SphereGeometry(0.3, 8, 6), new T.MeshBasicMaterial()), { radius: 0.3 });
          const x0 = tree.x - tree.r - 3, y = engine.surface(x0, tree.z) + 0.5;
          R.setPosition(ball, [x0, y, tree.z]);
          engine.step(1 / 60, { render: false });
          out[label + 'Chunk'] = R.trees.has(tree.key);   // cylinders of the trunk's chunk exist after one step with the body there
          R.impulse(ball, [10, 0, 0]);
          let minD = Infinity;   // closest the ball's centre gets to the trunk axis; a blocked ball stays about tree.r + 0.3 away (it may slide around)
          for (let i = 0; i < 90; i++) { engine.step(1 / 60, { render: false }); const t = ball.body.translation(); minD = Math.min(minD, Math.hypot(t.x - tree.x, t.z - tree.z)); }
          out[label + 'Gap'] = minD - (tree.r + 0.3);
          out[label + 'Passed'] = minD < tree.r;
          return ball;
        };
        const rectDist = key => { const [cx, cz] = key.split(',').map(Number); return Math.max(cx * CH - home.x, home.x - (cx + 1) * CH, 0, cz * CH - home.z, home.z - (cz + 1) * CH); };
        const near = ring.filter(t => R.trees.has(t.key) && t.r > 0.3).sort((a, b) => d2(a) - d2(b))[0];
        const far = ring.filter(t => rectDist(t.key) > R.treeRadius + 12 && t.r > 0.3)[0];   // beyond treeRadius + the keep margin: no cylinders yet
        out.haveNear = !!near; out.haveFar = !!far;
        if (near) (await throwAt(near, 'near')).remove();
        out.farBefore = far ? R.trees.has(far.key) : null;
        if (far) {
          const ball = await throwAt(far, 'far');
          out.farResident = trunkCount();
          ball.remove();
          engine.step(0.8, { render: false });   // the periodic sync lets go of the chunk no body needs any more
          out.farAfter = R.trees.has(far.key);
        }
        // far away: nothing left of the old surroundings; back: the same cylinders again
        const before = new Set(R.trees.keys());
        const dest = { x: home.x + 1500, z: home.z + 300 };
        let done = false; engine.stream.teleport(dest).then(() => { done = true; });
        await pump(() => done);
        await pump(() => !R._srcPending && [...R.terrain.values()].every(t => t.ready), 300);
        out.awayKept = [...before].filter(k => R.trees.has(k)).length;
        out.awayChunks = R.trees.size;
        done = false; engine.stream.teleport(home).then(() => { done = true; });
        await pump(() => done);
        await pump(() => !R._srcPending && [...R.terrain.values()].every(t => t.ready), 300);
        out.backSame = before.size === R.trees.size && [...before].every(k => R.trees.has(k));
        out.backColliders = trunkCount();
        return out;
      });
      console.log(`  rigid trees: ${r.ringTrunks} trunks in the 9 ring chunks, resident ${r.resident} in ${r.chunks} chunks, rapier colliders ${r.colliders}`);
      check('test is meaningful: trunks around, a near and a far one', r.ringTrunks > 20 && r.haveNear && r.haveFar, JSON.stringify(r));
      check('only a few chunks hold trunk cylinders, all within treeRadius of the player', r.chunks >= 1 && r.chunks <= 4 && r.nearOnly && r.resident < r.ringTrunks, JSON.stringify(r));
      check('ball thrown at a near trunk does not pass it', r.nearChunk && !r.nearPassed && r.nearGap > -0.1, JSON.stringify(r));
      check('far chunk had no cylinders before the body went there', r.farBefore === false, JSON.stringify(r));
      check('body teleported into a far chunk gets its cylinders before the next step; the ball does not pass the trunk', r.farChunk && !r.farPassed && r.farGap > -0.1, JSON.stringify(r));
      check('the far chunk is let go once no body is near', r.farAfter === false, JSON.stringify(r));
      check('after a teleport away the old surroundings hold no cylinders, and coming back restores the same chunks', r.awayKept === 0 && r.backSame, JSON.stringify(r));
    },
  },
];
