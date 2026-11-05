// Swarm module (recipes/65-swarm.md). A guard: objects spawn, die and are reused without a stale handle ever naming a new object; a full swarm says so;
// near agrees with brute force; a walk that removes and spawns misses nobody; freeze and channels stop it; a save brings the same handles back; and it
// draws on the WebGL renderer and on WebGPURenderer (the WebGL2 backend here; `node packages/tools/real-webgpu.mjs swarm` runs the same page on real WebGPU).
const J = JSON.stringify;
export const specs = [
  {
    name: '[guard] swarm: spawn / free / reuse, handle rule, capacity, near, walks, freeze and channels, save round trip, dispose, drawing on both renderers',
    url: '/tests/swarm/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.swarmCases());
      const L = r.life;
      check('spawn and free: counts follow, a second free is false', L.count3 === 3 && L.freed === true && L.freedAgain === false && L.count2 === 2, J(L));
      check('handles survive the swap-remove; the freed one reads -1', L.staleRow === -1 && L.movedHandleFollows, J(L));
      check('a reused slot gets a new handle, so the old one stays dead, and fields start from their defaults', L.reuseSlot && L.reuseNewHandle && L.reuseDefaults, J(L));
      check('a row passed to free throws [swarm-handle]; -1 from a full spawn is just false', L.rowToFree === 'swarm-handle' && L.minusOne === false, J(L));
      check('a misspelt spawn key throws [swarm-field]; color without { color: true } too', L.badField === 'swarm-field' && L.noColor === 'swarm-field', J(L));
      check('clear empties it and kills the handles', L.cleared[0] === 0 && L.cleared[1] === -1, J(L));
      check('20000 random spawns and frees: every handle still reads its own data', L.churn === true);
      check('a handle past 2^24 kept in a field still finds its object', L.keptInField[0] && L.keptInField[1] && L.keptInField[2], J(L.keptInField));
      const C = r.capacity;
      check('capacity: the spawn is refused with -1, dropped counts it, one [swarm-full] warning per swarm', C.count === 3 && C.dropped === 2 && C.warns === 1 && C.minus === -1 && /\[swarm-full\]/.test(C.text), J(C));
      check('describe, explain and counts show count and capacity', C.describe.count === 3 && C.describe.capacity === 3 && C.describe.dropped === 3 && C.explain.capacity === 3 && C.counts.alive === 3, J(C));
      check('bad setups are named: duplicate name, taken field, geometry alone, unknown channel', C.duplicate === 'swarm-name' && C.badField === 'module-params' && C.half === 'module-params' && C.badChannel === 'unknown-name', J(C));
      check('spawn after dispose returns -1 with a warning, no throw; the name is free again', C.after === -1 && C.again === 'no error', J(C));
      const N = r.near;
      check('near equals brute force on fresh, churned and partly removed grids, any radius', N.wrong === 0 && N.nonEmpty > 100, J(N));
      check('free inside near: the walk goes on, the next query does not see them', N.removedInQuery[0] === true && N.removedInQuery[1] === 0, J(N));
      check('near stops when cb returns false; a negative radius is refused', N.stop[0] === 1 && N.stop[1] === 1 && N.badR === 'module-params', J(N));
      check('no object twice, however the cells hash', N.tiny[0] === 8 && N.tiny[1] === 1, J(N));
      const K = r.walk;
      check('onStep: false removes, no return keeps, each row runs once', K.halfLeft === 5 && K.eachOnce, J(K));
      check('a second onStep function throws [swarm-step]', K.twice === 'swarm-step', J(K));
      check('free and spawn during the walk: nobody skipped or run twice, the freed count at once, the newborn waits a step',
        K.after[0] === 5 && K.after[1] === -1 && K.after[2] === -1 && K.midCount === 5 && K.seen[1] === 1 && K.seen[2] === 1 && K.seen[3] === 1 && K.seen[5] === 1 && K.seen[100] === 0, J(K));
      const T = r.time;
      check('onStep runs each fixed step with the channel dt', T.normal[0] === 30 && Math.abs(T.normal[1] - 0.5) < 0.01, J(T));
      check('a slowed channel halves dt, a stopped one runs nothing', T.slowDt === 0.5 && T.stopped === 0, J(T));
      check('frozen: no onStep, nothing moves, stepBlend holds', T.frozen[0] === 0 && T.frozen[1] === true && T.blendHeld === 0.25, J(T));
      const S = r.save;
      check('save round trip: the same rows, fields and handles come back', S.saved && S.loaded && S.same && S.rows[0] === 2 && S.rows[1] && S.rows[2] === 5 && S.rows[3] === 3.25 && S.rows[4] === 7 && S.rows[5] === 1, J(S));
      check('a new game empties a swarm not in saves', S.newGameCleared === 0, J(S));
      check('after a load: a dead handle stays dead, a swarm not in saves is empty, new handles are new', S.staleDead === -1 && S.shotsCleared === 0 && S.newHandle, J(S));
      check('a saved swarm made after the load picks its data up; a new field starts at its default', S.late[0] === 2 && S.late[1] === 7 && S.late[2] === 0, J(S));
      for (const k of ['webgl', 'webgpu']) {
        const D = r[k];
        check(`${k} (${D.backend}): one InstancedMesh in the scene, nothing drawn while empty`, D.inScene && D.empty[0] === 0 && D.empty[1] === 0, J(D));
        check(`${k}: instance matrices interpolate between fixed steps; step() draws the latest`, D.lerp === 0.25 && D.latest === 2, J(D));
        check(`${k}: a game's own move interpolates, whatever the hook order`, D.lerpOwn === 0.25, J(D));
        check(`${k}: yaw, pitch, roll and scale match three's Matrix4.compose`, D.matrixDiff < 1e-5, J(D));
        check(`${k}: a reused row does not streak from the old object`, D.noStreak === 1000, J(D));
        check(`${k}: bounds follow the swarm: seen 1 km from the origin, in its colour; culled facing away`, D.sphere[0] === 1000 && D.farLit > 8 && D.farGreen === 0 && D.culledLit === 0, J(D));
        check(`${k}: 2000 objects in one mesh, per-object colour reaches the picture`, D.crowd[0] === 2000 && D.crowd[1] > 500 && D.crowd[2] === 0, J(D));
        check(`${k}: a small capacity draws and moves too (WebGPU picks another buffer kind for it)`, D.few[0] >= 0 && D.few[1] > D.few[0] + 10, J(D));
      }
      const X = r.dispose;
      check('swarm.dispose: mesh out of the scene and disposed, once, name gone from describe', X.one[0] === null && X.one[1] === 1 && X.one[2] === 'two', J(X));
      check('unuse: the rest go with the module', X.unuse[0] === null && X.unuse[1] === 2 && X.unuse[2] === false, J(X));
      check("engine.dispose: gone too, and the game's geometry stays the game's", X.engine[0] === null && X.engine[1] === 1 && X.engine[2] === 0, J(X));
    },
  },
];
