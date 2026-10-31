// Terrain module: procedural infinite terrain (biomes, rivers, flattened plots), chunk streaming.
// After install: engine.terrain is the chunk manager; engine.surface()/slope()/groundType() come from it.
//
// engine.use(terrain({ seed: 7, viewDistance: 4, flatten: [{ x: 0, z: 0, radius: 20 }] }));
// Biome colors come from the style pack style.terrain.colors and can be overridden here via colors.
// Shape: terrain({ shape: 'island' }); height map: terrain({ shape: 'heightmap', heightmap: { url: '/textures/height.png', size: [1024, 1024], min: -5, max: 60 } })
//   The height map is a grayscale image, whiter is higher, read automatically at startup.
// Material: terrain({ material }) or style.terrain.material, a Material or (engine) => Material; chunks carry position, normal, color (biome
//   palette) and uv (world xz / chunk size, continuous across chunks). Cloud shadows and season tint are added to it.
// Own generator: terrain({ height: (x, z, n) => 10 * n.fbm(x * 0.01, z * 0.01), groundType: (x, z, h) => h > 8 ? 'rock' : null }).
//   Both run in workers, so they are pure (threads.pure rules: only parameters and globals like Math; an outside variable throws here, naming it).
//   The engine still does chunks, streaming, collision, rivers / flatten (turn off with rivers: false) and edits on top.
// Edits: engine.terrain.edit(pos, { radius: 2, lower: 1 }) digs; { paint: 'tilled' } paints the ground type. Saved, see terrainEdit.js.

/** Read a grayscale image into a 0-1 height array */
async function loadHeightmap(url) {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data, data = new Float32Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4] / 255;
  return { data, width: c.width, height: c.height };
}
import { ChunkManager } from './ChunkManager.js';
import { DEFAULT_TERRAIN } from './terrainGen.js';
import { checkOptions } from '../../core/validate.js';
import { compilePure } from '../../core/threadPure.js';

// Display names of ground types (biomes): used by describe() player.groundName, footstep hints, etc. If a game changes the biome rules, add i18n 'ground.<name>' itself
const STRINGS = {
  'zh-CN': { 'ground.meadow': '草地', 'ground.forest': '森林', 'ground.beach': '沙滩', 'ground.rock': '岩石', 'ground.snow': '雪地',
    'ground.wetland': '湿地', 'ground.riverbank': '河岸', 'ground.savanna': '草原', 'ground.highland': '高地', 'ground.tilled': '耕地', 'ground.wet': '湿土' },
  en: { 'ground.meadow': 'meadow', 'ground.forest': 'forest', 'ground.beach': 'beach', 'ground.rock': 'rock', 'ground.snow': 'snow',
    'ground.wetland': 'wetland', 'ground.riverbank': 'riverbank', 'ground.savanna': 'savanna', 'ground.highland': 'highland', 'ground.tilled': 'tilled soil', 'ground.wet': 'wet soil' },
};
export { createTerrain, DEFAULT_TERRAIN, BIOMES, DEFAULT_BIOMES, DEFAULT_BIOME_COLORS } from './terrainGen.js';

export function terrain(opts = {}) {
  const { viewDistance = 4, density = 1, material, ...cfg } = opts;
  let w = null;
  return {
    name: 'terrain', label: 'Terrain', optional: ['vegetation'], stage: 'world',
    install(e) {
      checkOptions('terrain()', opts, ['viewDistance', 'density', 'material', ...Object.keys(DEFAULT_TERRAIN)]);
      e.i18n.add(STRINGS);
      const style = e.style.terrain || {};
      for (const k in cfg) if (cfg[k] === undefined) delete cfg[k];
      // a game's generator functions go to the workers as source text: checked here (outside variables name themselves) so the error points at this call
      for (const k of ['height', 'groundType']) if (typeof cfg[k] === 'function') cfg[k] = compilePure(cfg[k], `terrain({ ${k} })`).src;
      const terrainCfg = { ...(style.config || {}), ...cfg, colors: { ...(style.colors || {}), ...(cfg.colors || {}) } };
      if (style.biomeColors) terrainCfg.biomeColors = { ...style.biomeColors, ...(cfg.biomeColors || {}) };
      if (style.steep && !cfg.steep) terrainCfg.steep = style.steep;
      w = new ChunkManager(e, terrainCfg, material ?? style.material);
      w.density = density;
      this._cfg = terrainCfg;
      e.setGround({
        height: (x, z) => w.T.surface(x, z),
        slope: (x, z) => w.T.slope(x, z),
        type: (x, z) => w.T.biomeAt(x, z, w.T.surface(x, z), w.T.slope(x, z)),
        waterLevel: w.T.waterLevel,
        // public collision API: the collision and physics modules read terrain only through these, never chunk internals
        forEachCollider: (x, z, range, fn) => w.forEachCollider(x, z, range, fn),
        chunkSize: w.T.CHUNK,
        viewRange: () => w.viewDistance * w.T.CHUNK,   // stream entries build within the terrain view by default
        chunkCollision: (cx, cz) => w.chunkCollision(cx, cz),
      });
      w.setViewDistance(viewDistance);
      // a source is ready when the ring around it is generated, and for a physics source its collision has taken effect (chunkCollision non-null)
      e.load.readyCheck('terrain', s => w.isReadyAround(s, { rings: 1 }) && (!s.physics || w.isReadyAround(s, { rings: 1, solid: true })));
      e.events.on('settings:shadows', () => w.refreshLevels());
      e.budget.metric('chunkApplyMs', () => w.stats.applyMs);   // chunk upload ms per frame (the limit comes from the game's budget)
      return w;
    },
    frame(dt, e) { w.update(e.load.list(), e.camera); },   // chunks load around every engine.load source
    describe(e, ctx) { ctx.out.perf.chunks = { loaded: w.stats.loaded ?? 0, visible: w.stats.visible ?? 0, queued: w.stats.queued }; },
    // height map waits for the image: after it loads, rebuild terrain with the new config (both the main-thread copy and the workers)
    async init(e) {
      const hm = this._cfg.heightmap;
      if (!hm?.url || hm.data) return;
      const img = await loadHeightmap(hm.url);
      const cfg2 = { ...this._cfg, heightmap: { ...hm, ...img, url: undefined } };
      const species = {}; for (const sp of e.vegetation?.list() || []) species[sp.name] = sp.rule;
      w.reinit(cfg2, species);
    },
    isReady(e) { return e.load.list().every(s => w.isReadyAround(s)); },
    dispose() { w.dispose(); },
  };
}
