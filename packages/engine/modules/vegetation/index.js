// Vegetation module factory: engine.use(vegetation(...)). The class and its chunk plumbing are in Vegetation.js.
import { readParams, keysSchema } from '../../core/params.js';
import { Vegetation } from './Vegetation.js';
import { defineWindLook } from './lookWind.js';
import { codedError } from '../../core/errorHints.js';

const OPTS = ['chunkSize', 'viewChunks', 'density', 'area', 'seed'];
const VEG_PARAMS = keysSchema(OPTS, { chunkSize: 32, viewChunks: 3, density: 1, seed: 1 });   // defaults of the own-chunks mode (without terrain)
/**
 * Vegetation module. Provides engine.vegetation.define(name, {...}) once installed.
 * With terrain() installed first it grows on the terrain chunks and takes no options (density and view distance are terrain options).
 * Without terrain it grows on its own chunks over whatever provides the ground: a level model (engine.level), a code-built ground
 * (engine.setGround), or the flat default. Rules read engine.surface / slope / groundType, so a level's named surfaces are picked with
 * rule.biomes (a level's ground type is the mesh's groundType property or its material name).
 * Where a species grows is one add() call with up to three parts: rule (random scatter), positions (the game's own spots, instead of the
 * scatter) and densityMap (thins either by a function or a gray image). A game that wants full control still builds its own InstancedMesh.
 * @param {{ chunkSize?: number, viewChunks?: number, density?: number, area?: { min: number[], max: number[] }, seed?: number }} [opts]
 *   only without terrain: chunkSize meters (default 32), viewChunks rings drawn around each stream source (default 3), density multiplier (default 1),
 * area { min: [x, z], max: [x, z] } where it may grow (default: a level's walkable bounds when a level provides the ground, else anywhere), seed placement seed
 * (default 1)
 * @example
 * engine.use(level({ url: '/levels/town.glb' }), vegetation({ area: { min: [-80, -80], max: [80, 80] } }));
 * engine.vegetation.define('grass', { geometry, nearOnly: true, rule: { perChunk: 400, biomes: { lawn: 1 } } });   // only on 'lawn' surfaces
 * engine.vegetation.define('lamp-shrub', { geometry, positions: [[4, -2], [8, -2, 1.2, 0]] });              // exactly where the level designer put them
 * engine.vegetation.define('weed', { geometry, rule: { perChunk: 300 }, densityMap: (x, z) => zoning.wild(x, z) });   // 0..1 per spot, game data
 */
export function vegetation(opts = {}) {
  readParams('vegetation', VEG_PARAMS, opts);
  let v = null, own = null, cols = null, ready = null;
  return { name: 'vegetation', label: 'Vegetation', params: VEG_PARAMS, options: opts, stage: 'world', after: ['terrain', 'level'], optional: ['terrain', 'level'],
    install(e) {
      defineWindLook(e);   // look.wind
      v = new Vegetation(e, opts);
      if (v.host !== e.terrain) {
        own = v.host;
        cols = e.addGroundColliders((x, z, range, fn) => own.forEachCollider(x, z, range, fn));   // collision and path planning see the trees
        ready = e.stream.readyCheck('vegetation', s => own.isReadyAround(s));
      }
      return v;
    },
    // terrain installed after vegetation would leave two chunk tables: say where to put it
    // a wrong install order is a setup error, not something to play on with; a densityMap image that fails to load would start on bare ground
    critical: true,
    async init(e) {
      if (own && e.terrain) throw codedError('module-requires', 'vegetation() was installed before terrain(): put terrain() first, vegetation then grows on its chunks');
      await v.whenLoaded();   // densityMap.url images of species added before start
    },
    frame(dt, e) { v.updateFade(); own?.update(e.stream.sources(), e.camera); },
    fixed(dt) { v.tick(dt); }, skip(dt, e, done) { if (done) v.tick(1); },
    describe(e, ctx) { if (own) ctx.out.perf.vegetation = { loaded: own.stats.loaded, visible: own.stats.visible, queued: own.stats.queued }; },
    dispose() { own?.dispose(); cols?.remove(); ready?.remove(); } };
}
