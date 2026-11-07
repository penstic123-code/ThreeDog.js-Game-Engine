// Async A* on a level with storeys: ground under a deck is ground like any other. The worker has no ground to ask, so its snapshot must hold every floor of a cell,
// and it must answer as the synchronous search does: that is what this file holds it to, on threads 0 and 2.
const PAGE = '/tests/threads/';

/**
 * Ground at 0; a deck at 5 m over x -6..6; under it a ridge too steep to climb across the road from z -20 to 4, with a way round at z > 4; over x 14..24 a roof too steep to walk,
 * with the open road under it. The deck says nothing about the ridge under it, and the roof nothing about the road.
 */
const storeys = `(THREE => {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial();
  const part = (geo, name, x, y, z) => { const p = new THREE.Mesh(geo, m); p.name = name; p.position.set(x, y, z); g.add(p); };
  part(new THREE.PlaneGeometry(70, 44).rotateX(-Math.PI / 2), 'floor', 0, 0, 0);
  part(new THREE.PlaneGeometry(12, 44).rotateX(-Math.PI / 2), 'floor_deck', 0, 5, 0);
  const side = Math.hypot(1.5, 1.65), ridge = a => new THREE.PlaneGeometry(side, 24).rotateX(-Math.PI / 2).rotateZ(a);
  part(ridge(Math.atan(1.1)), 'floor_ridge_a', -0.75, 0.825, -8);
  part(ridge(-Math.atan(1.1)), 'floor_ridge_b', 0.75, 0.825, -8);
  part(new THREE.PlaneGeometry(10, 44).rotateX(-Math.PI / 2).rotateZ(Math.atan(1.2)), 'floor_roof', 19, 9, 0);
  return g;
})`;

const run = async ({ scene, threads }) => {
  const { mk } = threedogThreads, T = threedogThreads.all, THREE = threedogThreads.THREE;
  const E = mk(T.createEngine, 'layers' + threads, { threads });
  E.use(T.world(), T.collision(), T.characters({ npcs: false }), T.level({ scene: eval(scene)(THREE) }));
  await E.start(); E.haltLoop();
  const later = async (a, b) => {
    let got = null; E.characters.findPathAsync(a, b, (path, status) => { got = { path, status }; });
    for (let i = 0; i < 400 && !got; i++) { E.step(1 / 60, { render: false, describe: false }); await new Promise(r => setTimeout(r, 1)); }
    return got;
  };
  const size = p => { let d = 0; for (let i = 1; i < (p?.length ?? 0); i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z); return +d.toFixed(1); };
  const out = {};
  const asks = { round: [[-4, 0, -10], [4, 0, -10]], under: [[12, 0, 0], [27, 0, 0]], deck: [[-4, 5, 0], [4, 5, 0]], up: [[-4, 0, 10], [4, 5, 10]] };
  for (const [k, [a, b]] of Object.entries(asks)) {
    const s = E.characters.findPath(a, b, { detailed: true }), l = await later(a, b);
    out[k] = { sync: s.status, async: l.status, syncLen: size(s.path), asyncLen: size(l.path), floors: [...new Set((l.path ?? []).map(p => +p.y.toFixed(1)))], path: JSON.stringify(l.path) };
  }
  E.dispose();
  return out;
};

export const specs = [
  {
    name: 'paths: async A* knows every floor of a level -- what stands under a deck, and what a deck or a roof above says nothing about (threads test page)',
    url: PAGE,
    async run({ check, ev }) {
      const a = await ev(run, { scene: storeys, threads: 0 }), b = await ev(run, { scene: storeys, threads: 2 }), J = k => JSON.stringify({ ...a[k], path: undefined });
      check('a ridge under the deck: the sync search goes round it', a.round.sync === 'ok' && a.round.syncLen > 20, J('round'));
      check('so does the async one', a.round.async === 'ok' && a.round.asyncLen > 20, J('round'));
      check('a roof too steep to walk does not close the road under it', a.under.sync === 'ok' && a.under.async === 'ok' && a.under.asyncLen < 16, J('under'));
      check('the deck itself still walks at its own height', a.deck.async === 'ok' && a.deck.floors.join() === '5', J('deck'));
      check('no way up to the deck: noPath on both', a.up.sync === 'noPath' && a.up.async === 'noPath', J('up'));
      check('same answers from the workers', ['round', 'under', 'deck', 'up'].every(k => a[k].path === b[k].path), JSON.stringify({ a: a.round.path, b: b.round.path }));
    },
  },
];
