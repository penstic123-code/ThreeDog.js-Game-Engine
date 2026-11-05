// Light pool: many sources, a few real lights.
// Sources: torches, street lamps, campfires, muzzle flashes, neon signs; the real lights are a fixed handful of three.js lights.
//   engine.use(lightPool({ point: 8 }));                                     // 8 real PointLights, created now, never added / removed / hidden
//   const torch = engine.lightPool.add(torchMesh, { color: 0xffa040, intensity: 4, distance: 8 });
//   torch.set({ intensity: 0 });  torch.remove();
// Why: three.js builds one shader program per material for each light setup (how many point / spot / directional... lights the scene has).
// Adding, removing or hiding a light mid-play changes the setup and compiles new programs, so one frame freezes for hundreds of milliseconds
// (seen in a first-person dungeon: torches switched lights by distance, programs 27 -> 30, a 450 ms frame). The pool's lights exist from install,
// so engine.start() compiles every material for them behind the loading screen; afterwards they only move to the sources that matter most
// and fade with intensity (0 = dark but still counted: no recompile). core/inspect/lightWatch.js warns in dev when a game changes its lights anyway.
// Choosing: every `every` seconds each source scores priority x intensity / (1 + (d / range)^2), d = distance to the focus (default the camera);
// a source that already holds a light gets a small bonus so two equal torches do not swap back and forth. A slot fades its old source out
// before taking the next one, so lights never pop. Sources without a light can drive a stand-in (`glow`: a halo sprite or emissive material).
// Shadows: none by default; lightPool({ shadows: k }) makes k of the point lights cast, used by sources added with castShadow: true.
// An idle shadow light (no source, or faded to 0) stops re-rendering its cube shadow map (shadow.autoUpdate = false): six shadow passes a frame for a dark light.
// When every point light casts (shadows >= point) there are no plain ones, so sources without castShadow also take the shadow lights (they cast then) instead of never lighting.
// Day / night: a source added with `dusk` (street lamps, shop lights) is scaled by the daylight curve of engine.uniforms.uNight (render/daylight.js,
// shared code, not a copy), so its real light, its stand-in and the game's window glow switch on together. Off by default: a torch in a cave, a
// muzzle flash or a lamp the game wants lit at noon keeps its intensity. Its scaled intensity is what the choice scores, so lamps that are off by
// day give their lights to sources that are lit.
import * as THREE from 'three';
import { warnOnce, fmt } from '../../core/base/validate.js';
import { readParams, keysSchema } from '../../core/base/params.js';
import { coded } from '../../core/base/errorHints.js';
import { daylightOf } from '../../render/daylight.js';
import { addSource } from './sources.js';
import { makeGroup, assign, update } from './slots.js';
/** @import { ModuleDef } from '../../types/core' */
/** @import { LightPool, LightPoolOptions } from '../../types/world' */

const OPT_KEYS = ['point', 'spot', 'shadows', 'every', 'fade', 'focus'];
const STRINGS = {
  late: 'lightPool() was installed after engine.start(): its lights were added to a running scene, so every material compiles once more (one long frame). Install it with the other modules, before engine.start() [light-recompile]',
  allShadow: 'lightPool({ point: {n}, shadows: {k} }): every point light casts shadows, so sources added without castShadow use shadow lights too (and cast). For plain lights next to the shadow ones give point more than shadows, e.g. lightPool({ point: {m}, shadows: {k} })',
  noDay: 'lightPool: a source follows daylight (dusk) but nothing tells day from night, so it stays at its day value (off). Install calendar() (or sky())',
};

const LIGHT_POOL_PARAMS = keysSchema(OPT_KEYS);

/**
 * Light pool (many light sources, a fixed number of real lights) -> engine.lightPool
 * @param {LightPoolOptions} [opts]
 * @returns {ModuleDef<LightPool>}
 * @example
 * engine.use(lightPool({ point: 8 }));   // before engine.start(), so the startup compile covers these lights
 * for (const t of torchMeshes) engine.lightPool.add(t, { color: 0xffa040, intensity: 4, distance: 8, flicker: (time, i) => 0.85 + 0.15 * Math.sin(time * 13 + i) });
 */
export function lightPool(opts = {}) {
  readParams('lightPool', LIGHT_POOL_PARAMS, opts);
  const { point = 8, spot = 0, shadows = 0, every = 0.1, fade = 0.3 } = opts;
  // what sources.js and slots.js share. timer: seconds since the last choice (Infinity: choose on the next frame); time: presentation seconds for flicker
  const pool = { e: null, api: null, sources: [], groups: [], tmp: new THREE.Vector3(), at: new THREE.Vector3(), timer: Infinity, time: 0, seq: 0, daylight: null, point, fade };
  let cut = false, offCut = null;

  const api = pool.api = {
    /** The real lights, created once at install: plain three.js lights in the scene (read them; the pool sets their position, color and intensity) */
    lights: /** @type {any[]} */ ([]),
    /** Distance is measured from this Object3D / position; null (default) = the camera */
    focus: opts.focus ?? null,
    /** Register a light source at a position (Object3D: it follows that object) and return its handle { set(patch), remove(), light, weight } */
    add(position, o = {}) { return addSource(pool, position, o); },
    /** @internal How the pool is used now: lights per kind, how many are lighting something, and which source each holds; describe().lightPool is the public read */
    get stats() {
      const out = { sources: pool.sources.length, lit: 0, slots: [] };
      for (const g of pool.groups) for (const s of g.slots) {
        if (s.src && s.w > 0) out.lit++;
        out.slots.push({ type: g.type, shadow: g.shadow, source: s.src ? (s.src.name ?? s.src.index) : null, weight: Math.round(s.w * 100) / 100 });
      }
      return out;
    },
  };

  return {
    name: 'lightPool', type: 'picture', params: LIGHT_POOL_PARAMS, options: opts, label: 'Light pool', stage: 'late',
    install(engine) { engine.i18n.add({ 'zh-CN': { 'module.lightPool': '光源池' }, en: { 'module.lightPool': 'light pool' } });
      const e = pool.e = engine;
      const k = Math.max(0, Math.min(shadows, point));
      if (k > 0 && k >= point) warnOnce(fmt(STRINGS.allShadow, { n: String(point), m: String(k + 2), k: String(k) }));
      makeGroup(pool, 'point', true, k);
      makeGroup(pool, 'point', false, point - k);
      makeGroup(pool, 'spot', false, spot);
      if (e.ready) warnOnce(STRINGS.late);
      offCut = e.events.on('camera:shot', () => { cut = true; });
      return api;
    },
    frame(dt) {
      pool.time += dt;   // presentation seconds for flicker: keeps running while gameplay is frozen, like the picture
      pool.daylight = daylightOf(pool.e);
      if (pool.daylight === null && pool.sources.some(s => s.dusk !== null)) warnOnce(coded('lightpool-dusk', STRINGS.noDay));
      // a camera cut (a view, a fixed shot): no fade, the picture is new anyway. Twice: the first pass frees the slots of sources left behind, the
      // second hands them over. Without it `shot --view` drew the lamps of the old spot, 1/30 s after the cut and 0.3 s before any fade would end
      if (cut) { cut = false; pool.timer = 0; for (let i = 0; i < 2; i++) { assign(pool); update(pool, fade); } return; }
      if ((pool.timer += dt) >= every) { pool.timer = 0; assign(pool); }
      update(pool, dt);
    },
    dispose() { offCut?.remove(); for (const L of api.lights) { L.removeFromParent(); L.target?.removeFromParent(); L.dispose(); } },
    describe() {
      const u = api.stats;
      return { lights: api.lights.length, lit: u.lit, sources: u.sources, shadows: Math.max(0, Math.min(shadows, point)) };
    },
  };
}
