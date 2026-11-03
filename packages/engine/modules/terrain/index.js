// Terrain module: chunked, streamed ground built from a height function (or a height map), with edits, workers and ground types.
// After install: engine.terrain is the data part (chunk manager: heights, chunks, edits, collision); engine.terrainLook draws it (slot 'terrain-look').
// engine.surface()/slope()/groundType() come from the data part.
//
// The engine ships no landform and no ground types: terrain() alone is flat gray ground at y = 0 (a placeholder, with a dev warning).
// A game passes a generator: its own pure functions, or a preset such as terrainPreset() from @threedog/terrain-noise:
//   engine.use(terrain({ seed: 7, ...terrainPreset(), flatten: [{ x: 0, z: 0, radius: 20 }] }));
//   engine.use(terrain({ height: (x, z, n) => 10 * n.fbm(x * 0.01, z * 0.01), groundType: (x, z, h) => h > 8 ? 'rock' : 'grass' }));
//   Both run in workers, so they are pure (threads.pure rules: only parameters and globals like Math; an outside variable throws here, naming it).
//   Settings a function needs travel as params (plain data, read as n.params). The engine still does chunks, streaming, collision, flatten and edits on top.
// Height map: terrain({ heightmap: { url: '/textures/height.png', size: [1024, 1024], min: -5, max: 60 } }), a grayscale image, whiter is higher, read at startup.
// Colors come from the style.terrain (colors palette, biomeColors per ground type, steep); a type without a color is neutral gray.
// Shading: 'smooth' | 'flat' | 'texture' (per-chunk color map, colors independent of the mesh; see recipes/37-terrain-look-hooks.md).
// Material: terrain({ material }) or style.terrain.material, a Material or (engine) => Material; chunks carry position, normal, color
//   and uv (world xz / chunk size, continuous across chunks). Cloud shadows and season tint are added to it; terrain({ material, effects: false })
//   draws it exactly as given (the same switch as look.ground.replace(m, { effects: false })), so a game's own shader is never patched.
// Edits: engine.terrain.edit(pos, { radius: 2, lower: 1 }) digs; { paint: 'tilled' } paints a ground type (its color: style.terrain.biomeColors). Saved, see terrainEdit.js.

// Outline: terrain({ shape: { mask: (x, z, n) => 40 - Math.hypot(x, z), side: { depth: 2 } } }) keeps ground only where mask > 0 (an island
//   with cliff sides); off it engine.surface is -Infinity, engine.ground.has false, and a fall emits terrain:void. See recipes/42-terrain-shape.md.

import { ChunkManager } from './ChunkManager.js';
import { DEFAULT_TERRAIN } from './terrainGen.js';

import { readParams, keysSchema } from '../../core/params.js';
import { compilePure } from '../../core/threadPure.js';
import { warnOnce } from '../../core/validate.js';
import { loadGray } from '../../core/grayMap.js';
import { prepareShape, voidWatcher } from './terrainShapeMain.js';
import { defineGroundLook } from './lookGround.js';
import { TerrainLook } from './look.js';
import { codedError } from '../../core/errorHints.js';

const NO_HEIGHT = 'terrain(): no height function or height map was given, so the ground is flat gray at y = 0 (a placeholder, not a look). '
  + 'Pass terrain({ height, groundType }) or a preset, e.g. terrain({ ...terrainPreset() }) with terrainPreset from @threedog/terrain-noise';

export { createTerrain, DEFAULT_TERRAIN } from './terrainGen.js';

const TERRAIN_PARAMS = keysSchema(['viewChunks', 'density', 'material', 'effects', 'viewFog', ...Object.keys(DEFAULT_TERRAIN)], { ...DEFAULT_TERRAIN, viewChunks: 4, density: 1, viewFog: false });   // defaults shown in the catalog; createTerrain applies the real ones

export function terrain(opts = {}) {
  readParams('terrain', TERRAIN_PARAMS, opts);
  const { viewChunks = 4, density = 1, material, effects, viewFog = false, ...cfg } = opts;
  // effects only says how the game's own material is used: without one it would silently do nothing
  if (effects !== undefined && (material == null || typeof effects !== 'boolean'))
    throw codedError('terrain-option', 'terrain({ effects }): goes with your own material, terrain({ material: myMaterial, effects: false }) = drawn as given (no cloud shadow / season / detail patch); got ' + JSON.stringify({ effects, material: material == null ? material : typeof material }));
  let w = null, watchVoid = null, sideMat = null;
  // the config the chunks are generated from now (a loaded height map, look.ground colors): shared by both halves
  const state = { cfg: null };
  // Two modules from one call: 'terrain' (data: heights, chunks, edits, collision, queries) and 'terrainLook' (meshes, materials, look.ground).
  // Why two: collision, paths and vegetation read only the data, so engine.use(myGround, { replaces: 'terrain-look' }) swaps every pixel of the
  // ground and keeps all of play. The look reads chunk data and never changes it.
  const data = {
    name: 'terrain', type: 'world', provides: ['terrain'], label: 'Terrain', params: TERRAIN_PARAMS, options: opts, noSkip: 'void-fall watch only; nothing accumulates over time', optional: ['vegetation'], stage: 'ground',
    install(e, ctx) {
      e.i18n.add({ 'zh-CN': { 'module.terrain': '地形' }, en: { 'module.terrain': 'terrain' } });
      for (const k in cfg) if (cfg[k] === undefined) delete cfg[k];
      // the shape of the ground only: the look keys (colors, shading...) are added by the look half (lookConfig), so a replaced look leaves them out
      const terrainCfg = Object.fromEntries(Object.entries(cfg).filter(([k]) => !LOOK_KEYS.includes(k)));
      // a game's generator functions go to the workers as source text: checked here (outside variables name themselves) so the error points at this call
      for (const k of ['height', 'groundType']) if (typeof terrainCfg[k] === 'function') terrainCfg[k] = compilePure(terrainCfg[k], `terrain({ ${k} })`).src;
      if (!terrainCfg.height && !terrainCfg.heightmap) warnOnce(NO_HEIGHT);
      sideMat = terrainCfg.shape ? prepareShape(terrainCfg) : null;
      w = new ChunkManager(e, terrainCfg);
      if (terrainCfg.shape) watchVoid = voidWatcher(e, w);
      w.density = density;
      w.viewFog = viewFog;   // opt-in: the look half puts the view distance on the fog (hides the edge); otherwise the style's / the game's look.fog far stays
      state.cfg = terrainCfg;
      e.setGround({
        height: (x, z) => w.T.surface(x, z),
        slope: (x, z) => w.T.slope(x, z),
        type: (x, z) => w.T.biomeAt(x, z, w.T.surface(x, z), w.T.slope(x, z)),   // 'void' outside terrain({ shape })
        waterLevel: w.T.waterLevel,
        // public collision API: the collision and physics modules read terrain only through these, never chunk internals
        forEachCollider: (x, z, range, fn) => w.forEachCollider(x, z, range, fn),
        chunkSize: w.T.CHUNK,
        viewRange: () => w.viewChunks * w.T.CHUNK,   // stream entries build within the terrain view by default
        chunkCollision: (cx, cz) => w.chunkCollision(cx, cz),
        has: (x, z) => w.T.has(x, z),
        voidY: () => w.voidY,   // the physics module reports its own bodies falling below it (terrain:void)
      });
      w.setViewChunks(viewChunks);
      // a source is ready when the ring around it is generated, and for a physics source its collision has taken effect (chunkCollision non-null)
      e.stream.readyCheck('terrain', s => w.isReadyAround(s, { rings: 1 }) && (!s.physics || w.isReadyAround(s, { rings: 1, solid: true })));
      ctx.track(e.events.on('settings:shadows', () => w.refreshLevels()));
      e.budget.metric('chunkApplyMs', () => w.stats.applyMs);   // chunk upload ms per frame (the limit comes from the game's budget)
      return w;
    },
    frame(dt, e) { w.update(e.stream.sources(), e.camera); },   // chunks load around every engine.stream source
    fixed() { watchVoid?.(); },   // terrain({ shape }) only: falls below voidY are gameplay, so they are seen on the fixed step
    describe(e, ctx) { ctx.out.perf.chunks = { loaded: w.stats.loaded ?? 0, visible: w.stats.visible ?? 0, queued: w.stats.queued, failed: w.stats.failed }; },
    // height map / mask image wait for the image: after it loads, rebuild terrain with the new config (both the main-thread copy and the workers)
    critical: true,   // a missing height map would start the game on flat ground: stop start() with the reason instead
    async init() {
      const hm = state.cfg.heightmap, mk = state.cfg.shape?.mask;
      const needH = hm?.url && !hm.data, needM = mk?.url && !mk.data;
      if (!needH && !needM) return;
      const cfg2 = state.cfg = { ...state.cfg };   // look.ground rebuilds from the current config
      if (needH) cfg2.heightmap = { ...hm, ...await loadGray(hm.url), url: undefined };
      if (needM) cfg2.shape = { ...cfg2.shape, mask: { ...mk, ...await loadGray(mk.url), url: undefined } };
      w.reinit(cfg2, speciesRules(w));
    },
    isReady(e) { return e.stream.sources().every(s => w.isReadyAround(s)); },
    dispose() { w.dispose(); },
  };
  let look = null, fog = null;
  const lookModule = {
    // the same terrain({...}) call: material / effects are read here, the rest by the data part
    name: 'terrainLook', type: 'look', label: 'Terrain look', params: TERRAIN_PARAMS, options: opts, requires: ['terrain'], provides: ['terrain-look'], stage: 'effects',
    install(e, ctx) {
      e.i18n.add({ 'zh-CN': { 'module.terrainLook': '地形外观' }, en: { 'module.terrainLook': 'terrain look' } });
      const style = e.style.terrain || {};
      // the colors the workers bake into each chunk: no chunk is generated before the first frame, so this reinit only swaps the config
      const lc = lookConfig(e, style, cfg);
      state.cfg = { ...state.cfg, ...lc };
      w.reinit(state.cfg, speciesRules(w));
      const given = { colors: cfg.colors && lc.colors, biomeColors: cfg.biomeColors && lc.biomeColors, steep: cfg.steep, shading: cfg.shading, material, effects };
      fog = viewFogSync(e, ctx);
      // effects false (terrain({ material, effects: false })): the game's material is drawn untouched, as look.ground.replace(m, { effects: false })
      look = new TerrainLook(e, w, { material: material ?? style.material, effects: material == null || effects !== false, sideMat });
      // look.ground: what terrain({...}) itself was given goes on the game layer (owner 'terrain()'); the style's values are the style layer
      defineGroundLook(e, look, w, { cfg: () => state.cfg, setCfg: c => { state.cfg = c; }, species: () => speciesRules(w), game: given });
      return look;
    },
    frame() { fog(w.viewFogFar); },
    describe() { return { chunks: look?.meshes.size ?? 0 }; },
    dispose() { look?.dispose(); look = null; },
  };
  return [data, lookModule];
}

/** Look keys of terrain({...}) and style.terrain: baked into the chunk colors by the workers, but only the look half reads them */
const LOOK_KEYS = ['colors', 'biomeColors', 'steep', 'variation', 'shading', 'colorResolution', 'normals', 'normalFn'];

/** The look half's part of the worker config: the style's colors / variation / config looks, with what terrain({...}) itself gave on top */
function lookConfig(e, style, cfg) {
  const pick = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => LOOK_KEYS.includes(k)));
  const out = { ...pick(style.config), ...pick(cfg) };
  out.colors = { ...(style.colors || {}), ...(cfg.colors || {}) };
  if (style.biomeColors) out.biomeColors = { ...style.biomeColors, ...(cfg.biomeColors || {}) };
  if (style.steep && !cfg.steep) out.steep = style.steep;
  if (style.variation && !cfg.variation) {   // plain data, so it rides along to the workers
    readParams('style.terrain.variation', keysSchema(['blend', 'jitter', 'patches']), style.variation);
    readParams('style.terrain.variation.blend', keysSchema(['size', 'strength']), style.variation.blend || {});
    readParams('style.terrain.variation.jitter', keysSchema(['size', 'min', 'range']), style.variation.jitter || {});
    readParams('style.terrain.variation.patches', keysSchema(['size', 'strength', 'levels', 'tint']), style.variation.patches || {});
    out.variation = style.variation;
  }
  if (typeof out.normalFn === 'function') out.normalFn = compilePure(out.normalFn, 'terrain({ normalFn })').src;   // also a style's normalFn
  // low-tier devices start with a coarser color map (a quarter of the pixels and upload); the game's own colorResolution wins
  if (out.shading === 'texture' && out.colorResolution == null && e.tier === 'low') out.colorResolution = 64;
  return out;
}

/**
 * terrain({ viewFog: true }): the view distance is the engine layer of look.fog.far, written by the look half through ctx.mod, so it leaves with
 * the module (a replaced look, an unloaded terrain). Checked each frame: the view distance changes (settings), and a sky installed or swapped
 * later brings a new fog point. Returns fn(far or null).
 */
function viewFogSync(e, ctx) {
  let h = null, at = null, stack = null;
  return far => {
    const st = e.stacks.has('look.fog.far') ? e.stacks.get('look.fog.far') : null;
    if (far === at && st === stack) return;
    h?.remove(); h = null; at = far; stack = st;
    if (far != null && st) h = ctx.mod('look.fog.far', { layer: 'engine', set: far });
  };
}

/** Every species' placement rule (the workers get the full table when the terrain config is replaced) */
function speciesRules(w) { const out = {}; for (const sp of w.plants.list()) out[sp.name] = sp.rule; return out; }
