// Terrain module: chunked, streamed ground built from a height function (or a height map), with edits, workers and ground types.
// After install: engine.terrain is the chunk manager; engine.surface()/slope()/groundType() come from it.
//
// The engine ships no landform and no ground types: terrain() alone is flat gray ground at y = 0 (a placeholder, with a dev warning).
// A game passes a generator: its own pure functions, or a preset such as terrainPreset() from @threedog/terrain-noise:
//   engine.use(terrain({ seed: 7, ...terrainPreset(), flatten: [{ x: 0, z: 0, radius: 20 }] }));
//   engine.use(terrain({ height: (x, z, n) => 10 * n.fbm(x * 0.01, z * 0.01), groundType: (x, z, h) => h > 8 ? 'rock' : 'grass' }));
//   Both run in workers, so they are pure (threads.pure rules: only parameters and globals like Math; an outside variable throws here, naming it).
//   Settings a function needs travel as params (plain data, read as n.params). The engine still does chunks, streaming, collision, flatten and edits on top.
// Height map: terrain({ heightmap: { url: '/textures/height.png', size: [1024, 1024], min: -5, max: 60 } }), a grayscale image, whiter is higher, read at startup.
// Colors come from the style pack style.terrain (colors palette, biomeColors per ground type, steep); a type without a color is neutral gray.
// Shading: 'smooth' | 'flat' | 'texture' (per-chunk color map, colors independent of the mesh; see recipes/37-terrain-look-hooks.md).
// Material: terrain({ material }) or style.terrain.material, a Material or (engine) => Material; chunks carry position, normal, color
//   and uv (world xz / chunk size, continuous across chunks). Cloud shadows and season tint are added to it.
// Edits: engine.terrain.edit(pos, { radius: 2, lower: 1 }) digs; { paint: 'tilled' } paints a ground type (its color: style.terrain.biomeColors). Saved, see terrainEdit.js.

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
import { warnOnce } from '../../core/validate.js';

const NO_HEIGHT = 'terrain(): no height function or height map was given, so the ground is flat gray at y = 0 (a placeholder, not a look). '
  + 'Pass terrain({ height, groundType }) or a preset, e.g. terrain({ ...terrainPreset() }) with terrainPreset from @threedog/terrain-noise';

export { createTerrain, DEFAULT_TERRAIN } from './terrainGen.js';

export function terrain(opts = {}) {
  const { viewChunks = 4, density = 1, material, viewFog = false, ...cfg } = opts;
  let w = null;
  return {
    name: 'terrain', label: 'Terrain', optional: ['vegetation'], stage: 'world',
    install(e) {
      checkOptions('terrain()', opts, ['viewChunks', 'density', 'material', 'viewFog', ...Object.keys(DEFAULT_TERRAIN)]);
      const style = e.style.terrain || {};
      for (const k in cfg) if (cfg[k] === undefined) delete cfg[k];
      // a game's generator functions go to the workers as source text: checked here (outside variables name themselves) so the error points at this call
      const terrainCfg = { ...(style.config || {}), ...cfg, colors: { ...(style.colors || {}), ...(cfg.colors || {}) } };
      for (const k of ['height', 'groundType', 'normalFn']) if (typeof terrainCfg[k] === 'function') terrainCfg[k] = compilePure(terrainCfg[k], `terrain({ ${k} })`).src;   // also a style's normalFn
      // low-tier devices start with a coarser color map (a quarter of the pixels and upload); the game's own colorResolution wins
      if (terrainCfg.shading === 'texture' && terrainCfg.colorResolution == null && e.tier === 'low') terrainCfg.colorResolution = 64;
      if (style.biomeColors) terrainCfg.biomeColors = { ...style.biomeColors, ...(cfg.biomeColors || {}) };
      if (style.steep && !cfg.steep) terrainCfg.steep = style.steep;
      if (style.variation) {   // look only (plain data), so it rides along to the workers
        checkOptions('style.terrain.variation', style.variation, ['blend', 'jitter', 'patches']);
        checkOptions('style.terrain.variation.blend', style.variation.blend || {}, ['size', 'strength']);
        checkOptions('style.terrain.variation.jitter', style.variation.jitter || {}, ['size', 'min', 'range']);
        checkOptions('style.terrain.variation.patches', style.variation.patches || {}, ['size', 'strength', 'levels', 'tint']);
        terrainCfg.variation = style.variation;
      }
      if (!terrainCfg.height && !terrainCfg.heightmap) warnOnce(NO_HEIGHT);
      w = new ChunkManager(e, terrainCfg, material ?? style.material);
      w.density = density;
      w.viewFog = viewFog;   // opt-in: the fog ends where the chunks end (hides the edge); otherwise createEngine({ fogFar }) / the game's fog stays
      this._cfg = terrainCfg;
      e.setGround({
        height: (x, z) => w.T.surface(x, z),
        slope: (x, z) => w.T.slope(x, z),
        type: (x, z) => w.T.biomeAt(x, z, w.T.surface(x, z), w.T.slope(x, z)),
        waterLevel: w.T.waterLevel,
        // public collision API: the collision and physics modules read terrain only through these, never chunk internals
        forEachCollider: (x, z, range, fn) => w.forEachCollider(x, z, range, fn),
        chunkSize: w.T.CHUNK,
        viewRange: () => w.viewChunks * w.T.CHUNK,   // stream entries build within the terrain view by default
        chunkCollision: (cx, cz) => w.chunkCollision(cx, cz),
      });
      w.setViewChunks(viewChunks);
      // a source is ready when the ring around it is generated, and for a physics source its collision has taken effect (chunkCollision non-null)
      e.stream.readyCheck('terrain', s => w.isReadyAround(s, { rings: 1 }) && (!s.physics || w.isReadyAround(s, { rings: 1, solid: true })));
      e.events.on('settings:shadows', () => w.refreshLevels());
      e.budget.metric('chunkApplyMs', () => w.stats.applyMs);   // chunk upload ms per frame (the limit comes from the game's budget)
      return w;
    },
    frame(dt, e) { w.update(e.stream.sources(), e.camera); },   // chunks load around every engine.stream source
    describe(e, ctx) { ctx.out.perf.chunks = { loaded: w.stats.loaded ?? 0, visible: w.stats.visible ?? 0, queued: w.stats.queued }; },
    // height map waits for the image: after it loads, rebuild terrain with the new config (both the main-thread copy and the workers)
    critical: true,   // a missing height map would start the game on flat ground: stop start() with the reason instead
    async init(e) {
      const hm = this._cfg.heightmap;
      if (!hm?.url || hm.data) return;
      const img = await loadHeightmap(hm.url);
      const cfg2 = { ...this._cfg, heightmap: { ...hm, ...img, url: undefined } };
      const species = {}; for (const sp of e.vegetation?.list() || []) species[sp.name] = sp.rule;
      w.reinit(cfg2, species);
    },
    isReady(e) { return e.stream.sources().every(s => w.isReadyAround(s)); },
    dispose() { w.dispose(); },
  };
}
